// Milestone M3 on Sepolia, through the QuietOdds v4 pool (ETH/USDC + QuietOddsHook):
//
//   1. swap-and-bet: Priya swaps 3 USDC -> ETH and shields 1 USDC of it in the
//      same swap. After a delay, she bets that 1 USDC privately through the
//      live relayer. The swap names no market or side; the bet names no wallet.
//   2. shield-on-swap: Rahul swaps 0.002 ETH -> USDC and keeps 1 USDC of the
//      output in his private balance instead of his wallet.
//
// Hashes land in deployments/hook-e2e-sepolia.json.
//   npm run swap-and-bet -w scripts     (RELAYER_URL defaults to the live relayer)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import {
  ASSET, KEY_MESSAGE, MAX_PRICE_LIMIT, MIN_PRICE_LIMIT, MerkleTree, buildSpend, deriveNote, encryptNote,
  fetchPoolState, keysFromSignature, marketsAbi, nextNoteIndex, poolSwapTestAbi, relayerApi, scanNotes, sepolia,
  shieldHookData, spendBody, type Keys,
} from "@quietodds/lib";
import { Prover } from "@quietodds/lib/prover";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const RELAYER_URL = process.env.RELAYER_URL ?? "https://quietodds-relayer.vercel.app";
const BET_DELAY_SECONDS = Number(process.env.BET_DELAY_SECONDS ?? 45);
const MARKET = BigInt(process.env.BET_MARKET ?? 6); // "ETH above $2,500 at 12:00 UTC Nov 20?"
const SHIELD = 1_000_000n; // 1 USDC

const transport = http(env("SEPOLIA_RPC_URL"));
const pub = createPublicClient({ chain, transport: http(process.env.LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const wallet = (key: string) => createWalletClient({ chain, transport, account: privateKeyToAccount(key as Hex) });
const priya = wallet(env("USER1_PRIVATE_KEY"));
const rahul = wallet(env("USER2_PRIVATE_KEY"));
const api = relayerApi(RELAYER_URL);
const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const key = sepolia.poolKey;

const record: { steps: { step: string; tx: Hex; gasUsed: string }[]; [k: string]: unknown } = {
  network: "sepolia", hook: sepolia.hook, poolKey: key, relayer: RELAYER_URL, steps: [],
};
// RESUME=1 continues a run whose swap already landed (keeps its recorded steps).
const RESUME = process.env.RESUME === "1";
const OUT = `${ROOT}deployments/hook-e2e-sepolia.json`;
if (RESUME && existsSync(OUT)) Object.assign(record, JSON.parse(readFileSync(OUT, "utf8")));
const save = () => writeFileSync(`${ROOT}deployments/hook-e2e-sepolia.json`, JSON.stringify(record, null, 2) + "\n");
function step(name: string, tx: Hex, gasUsed: bigint | string) {
  record.steps.push({ step: name, tx, gasUsed: gasUsed.toString() });
  save();
  console.log(`  ✓ ${name}  ${tx}  gas ${gasUsed}`);
}

async function notesOf(keys: Keys) {
  const state = await fetchPoolState(pub, sepolia.pool, sepolia.deployBlock);
  const notes = await scanNotes(keys, state.leaves, (h) => state.nullifiers.has(h));
  return { tree: new MerkleTree(state.leaves.map((l) => l.leaf)), notes };
}

/** A swap through the hook that shields SHIELD USDC into a fresh note of `keys`. */
async function shieldedSwap(name: string, w: typeof priya, keys: Keys, zeroForOne: boolean, amountSpecified: bigint, value: bigint) {
  const { notes } = await notesOf(keys);
  const index = nextNoteIndex(notes);
  const pc = deriveNote(keys, index).precommitment;
  const ct = await encryptNote(keys.viewingKey, { kind: "balance", index, asset: ASSET.USDC, amount: SHIELD });
  const before = await pub.readContract({ address: sepolia.usdc, abi: erc20, functionName: "balanceOf", args: [w.account.address] });
  const hash = await w.writeContract({
    address: sepolia.poolSwapTest, abi: poolSwapTestAbi, functionName: "swap", value, ...fees,
    args: [
      key,
      { zeroForOne, amountSpecified, sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT },
      { takeClaims: false, settleUsingBurn: false },
      shieldHookData(SHIELD, pc, ct),
    ],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${name} reverted: ${hash}`);
  step(name, hash, r.gasUsed);
  const after = await pub.readContract({ address: sepolia.usdc, abi: erc20, functionName: "balanceOf", args: [w.account.address] });
  console.log(`  wallet USDC ${usdc(before)} -> ${usdc(after)}; ${usdc(SHIELD)} went to the private balance`);
  return index;
}

async function main() {
  const quote = await api.quote();
  console.log(`relayer ${quote.relayer} at ${RELAYER_URL}`);
  const keys = {
    priya: keysFromSignature(await priya.signMessage({ message: KEY_MESSAGE })),
    rahul: keysFromSignature(await rahul.signMessage({ message: KEY_MESSAGE })),
  };

  console.log("1. swap-and-bet (Priya)");
  const existing = RESUME
    ? (await notesOf(keys.priya)).notes.find((n) => !n.spent && n.data.kind === "balance" && n.data.amount === SHIELD)
    : undefined;
  const shieldedIndex = existing ? existing.data.index : await swapAndShield();
  async function swapAndShield() {
  const approve = await priya.writeContract({
    address: sepolia.usdc, abi: erc20, functionName: "approve", args: [sepolia.poolSwapTest, 3_000_000n], ...fees,
  });
  step("priya: approve USDC to the swap router", approve, (await pub.waitForTransactionReceipt({ hash: approve })).gasUsed);
  // USDC is currency1: USDC -> ETH is one-for-zero. Exact in 3 USDC: 2 swapped, 1 shielded.
  return shieldedSwap("priya: swap 3 USDC -> ETH, shield 1 USDC", priya, keys.priya, false, -3_000_000n, 0n);
  }
  if (existing) console.log(`  resuming: shielded note ${shieldedIndex} already on chain`);

  console.log(`  waiting ${BET_DELAY_SECONDS}s before betting (the app waits 1-10 min, so swap and bet don't line up)`);
  await new Promise((r) => setTimeout(r, BET_DELAY_SECONDS * 1000));

  const { tree, notes } = await notesOf(keys.priya);
  const note = notes.find((n) => n.data.index === shieldedIndex && !n.spent);
  if (!note) throw new Error("shielded note not found");
  const fee = BigInt(quote.fees.bet.usdc);
  const plan = await buildSpend({
    keys: keys.priya, note, tree, publicAmount: SHIELD - fee, fee, relayer: quote.relayer,
    action: { type: "bet", market: MARKET, side: 1n }, changeIndex: nextNoteIndex(notes),
  });
  const prover = await Prover.create();
  const { proof } = await prover.prove("spend", plan.inputs);
  await prover.destroy();
  const res = await api.spend(spendBody(plan, proof));
  step(`priya: private bet ${usdc(SHIELD - fee)} on market ${MARKET} YES (live relayer)`, res.txHash, res.gasUsed);
  const totals = await pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "getSideTotals", args: [MARKET], blockNumber: BigInt(res.blockNumber) });
  console.log(`  market ${MARKET} side totals: ${totals.map(usdc).join(" | ")}`);

  console.log("2. shield-on-swap (Rahul)");
  // ETH -> USDC is zero-for-one. Exact in 0.002 ETH: 1 USDC of the output is shielded.
  const amountIn = parseEther("0.002");
  await shieldedSwap("rahul: swap 0.002 ETH -> USDC, shield 1 USDC", rahul, keys.rahul, true, -amountIn, amountIn);

  record.completedAt = new Date().toISOString();
  save();
  console.log("done: deployments/hook-e2e-sepolia.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
