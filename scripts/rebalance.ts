// Brings the QuietOdds ETH/USDC pool back to the Chainlink ETH/USD price.
//
// On mainnet, arbitrageurs keep a pool in line with the market. On Sepolia
// nobody does, so every demo swap leaves the thin pool drifting, and private
// batches (which must fill within `slippageBps` of Chainlink) start reverting.
// This plays the arbitrageur: one swap from the deployer, with the swap's price
// limit set to the Chainlink price, so it stops exactly there.
//
//   npm run rebalance -w scripts              (skips if within 0.5%)
//   REBALANCE_THRESHOLD_BPS=20 npm run rebalance -w scripts
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import { poolSwapTestAbi, sepolia } from "@quietodds/lib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");

const external = JSON.parse(readFileSync(`${ROOT}deployments/sepolia.json`, "utf8"));
const hookDeployment = JSON.parse(readFileSync(`${ROOT}deployments/hook-sepolia.json`, "utf8"));
const STATE_VIEW = external.uniswapV4.StateView as Hex;
const POOL_ID = hookDeployment.poolId as Hex;
const THRESHOLD_BPS = BigInt(process.env.REBALANCE_THRESHOLD_BPS ?? 50);

const pub = createPublicClient({ chain, transport: http(process.env.SEPOLIA_RPC_URL) });
const wallet = createWalletClient({ chain, transport: http(process.env.SEPOLIA_RPC_URL), account: privateKeyToAccount(key) });
const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
]);

const Q96 = 2n ** 96n;
const sqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
/** USD per ETH from sqrtPriceX96 of the ETH(0)/USDC(1) pool (base units: 1e6 per 1e18). */
const usdPerEth = (sqrtP: bigint) => Number((sqrtP * sqrtP * 10n ** 12n * 100n) / Q96 / Q96) / 100;

async function main() {
  const [[sqrtP], liquidity, [, answer]] = await Promise.all([
    pub.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [POOL_ID] }),
    pub.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [POOL_ID] }),
    pub.readContract({ address: sepolia.ethUsdFeed, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  // Same formula as CreatePool.s.sol: sqrt(answer * 2^192 / 1e20).
  const target = sqrt((answer << 192n) / 10n ** 20n);
  const deviationBps = ((sqrtP * sqrtP - target * target) * 10_000n) / (target * target);
  console.log(`pool ${usdPerEth(sqrtP)} $/ETH · Chainlink ${Number(answer) / 1e8} $/ETH · off by ${Number(deviationBps) / 100}%`);
  if ((deviationBps < 0n ? -deviationBps : deviationBps) <= THRESHOLD_BPS) {
    console.log(`within ${Number(THRESHOLD_BPS) / 100}%: nothing to do`);
    return;
  }

  const ethTooDear = sqrtP > target;
  // Full-range liquidity: the exact input to move the price to `target`, plus 2%
  // for fees. The price limit stops the swap at `target`; unused ETH is refunded.
  const amountIn = ethTooDear
    ? (((liquidity * Q96 * (sqrtP - target)) / (sqrtP * target)) * 102n) / 100n // ETH in
    : (((liquidity * (target - sqrtP)) / Q96) * 102n) / 100n; // USDC in
  console.log(ethTooDear ? `selling up to ${formatEther(amountIn)} ETH` : `buying ETH with up to ${formatUnits(amountIn, 6)} USDC`);

  if (!ethTooDear) {
    const allowance = await pub.readContract({ address: sepolia.usdc, abi: erc20, functionName: "allowance", args: [wallet.account.address, sepolia.poolSwapTest] });
    if (allowance < amountIn) {
      const h = await wallet.writeContract({ address: sepolia.usdc, abi: erc20, functionName: "approve", args: [sepolia.poolSwapTest, amountIn], ...fees });
      await pub.waitForTransactionReceipt({ hash: h });
    }
  }
  const hash = await wallet.writeContract({
    address: sepolia.poolSwapTest,
    abi: poolSwapTestAbi,
    functionName: "swap",
    args: [
      sepolia.poolKey,
      { zeroForOne: ethTooDear, amountSpecified: -amountIn, sqrtPriceLimitX96: target },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    ],
    value: ethTooDear ? amountIn : 0n,
    ...fees,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`rebalance reverted: ${hash}`);
  const [after] = await pub.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [POOL_ID], blockNumber: r.blockNumber });
  console.log(`rebalanced: ${hash}\npool now ${usdPerEth(after)} $/ETH`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
