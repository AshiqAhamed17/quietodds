// Full private flow against a local anvil, through the relayer's HTTP API:
// deposit -> relayed bet -> resolve -> relayed redeem -> relayed withdraw.
// Proofs come from bb.js, so this also checks them against the real verifiers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createTestClient, createWalletClient, http, parseAbi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  ASSET, MerkleTree, RelayerHttpError, buildRedeem, buildSpend, deriveNote, encryptNote, fetchPoolState,
  keysFromSpendingKey, marketsAbi, nextNoteIndex, redeemBody, relayerApi, scanNotes, shieldedBalance,
  shieldedPoolAbi, spendBody, spendableNotes, unspentPositions, type OwnedNote,
} from "@quietodds/lib";
import { Prover } from "@quietodds/lib/prover";
import { defaultFees } from "../src/config.ts";
import { createRelayer } from "../src/relayer.ts";
import { createApp } from "../src/server.ts";

const PORT = 8611;
const RPC = `http://127.0.0.1:${PORT}`;
const CONTRACTS = fileURLToPath(new URL("../../contracts", import.meta.url));
const DEPLOYMENT = fileURLToPath(new URL("../../deployments/quietodds-local.json", import.meta.url));
// anvil dev accounts 0 and 1
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RELAYER_KEY = `0x${"5e".repeat(32)}` as const; // funded in beforeAll

const tokenAbi = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

let anvil: ChildProcess;
let prover: Prover;
let dep: { ShieldedPool: Address; Markets: Address; USDC: Address; deployBlock: number };

const transport = http(RPC);
const pub = createPublicClient({ chain: foundry, transport });
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport });
const deployer = createWalletClient({ chain: foundry, transport, account: privateKeyToAccount(DEPLOYER_KEY) });
const user = createWalletClient({ chain: foundry, transport, account: privateKeyToAccount(USER_KEY) });
const relayerWallet = createWalletClient({ chain: foundry, transport, account: privateKeyToAccount(RELAYER_KEY) });
const RELAYER = relayerWallet.account.address;

const keys = keysFromSpendingKey(0x5eed5eedn);
let api: ReturnType<typeof relayerApi>;

async function wallet() {
  const state = await fetchPoolState(pub, dep.ShieldedPool, BigInt(dep.deployBlock));
  const notes = await scanNotes(keys, state.leaves, (h) => state.nullifiers.has(h));
  return { tree: new MerkleTree(state.leaves.map((l) => l.leaf)), notes };
}

const usdcOf = (a: Address) => pub.readContract({ address: dep.USDC, abi: tokenAbi, functionName: "balanceOf", args: [a] });

beforeAll(async () => {
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  execFileSync("forge", ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast"], {
    cwd: CONTRACTS,
    stdio: "ignore",
    env: { ...process.env, DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY },
  });
  await testClient.setBalance({ address: RELAYER, value: 10n ** 20n });
  dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  prover = await Prover.create();
  const relayer = createRelayer({
    publicClient: pub as never,
    walletClient: relayerWallet,
    prover,
    pool: dep.ShieldedPool,
    markets: dep.Markets,
    fees: { ...defaultFees, spendGas: 1n, redeemGas: 1n }, // fee = the 0.05 USDC floor
    log: () => {},
  });
  const app = createApp(relayer);
  api = relayerApi("http://relayer", (url, init) => Promise.resolve(app.request(url as string, init)));
}, 240_000);

afterAll(async () => {
  await prover?.destroy();
  anvil?.kill();
});

describe("relayer on a local chain", () => {
  let betBody: ReturnType<typeof spendBody>;

  it("serves health and a fee quote", async () => {
    expect((await api.health()).relayer).toBe(RELAYER);
    const q = await api.quote();
    expect(q.relayer).toBe(RELAYER);
    expect(q.fees.bet.usdc).toBe("50000");
  });

  it("relays a private bet from a deposit", async () => {
    const pc = deriveNote(keys, 0).precommitment;
    const ct = await encryptNote(keys.viewingKey, { kind: "balance", index: 0, asset: ASSET.USDC, amount: 100_000_000n });
    await deployer.writeContract({ address: dep.USDC, abi: tokenAbi, functionName: "mint", args: [user.account.address, 100_000_000n] });
    await user.writeContract({ address: dep.USDC, abi: tokenAbi, functionName: "approve", args: [dep.ShieldedPool, 100_000_000n] });
    const dh = await user.writeContract({ address: dep.ShieldedPool, abi: shieldedPoolAbi, functionName: "deposit", args: [ASSET.USDC, 100_000_000n, pc, ct] });
    await pub.waitForTransactionReceipt({ hash: dh });

    const { tree, notes } = await wallet();
    expect(shieldedBalance(notes, ASSET.USDC)).toBe(100_000_000n);
    const plan = await buildSpend({
      keys, note: spendableNotes(notes, ASSET.USDC)[0], tree, publicAmount: 30_000_000n, fee: 50_000n,
      relayer: RELAYER, action: { type: "bet", market: 1n, side: 1n }, changeIndex: nextNoteIndex(notes),
    });
    const { proof } = await prover.prove("spend", plan.inputs);
    betBody = spendBody(plan, proof);

    const res = await api.spend(betBody);
    expect(res.status).toBe("success");
    const totals = await pub.readContract({ address: dep.Markets, abi: marketsAbi, functionName: "getSideTotals", args: [1n] });
    expect(totals).toEqual([0n, 30_000_000n]);
    expect(await usdcOf(RELAYER)).toBe(50_000n);
  }, 120_000);

  it("refuses a replay, a tampered fee and a proof for another relayer", async () => {
    await expect(api.spend(betBody)).rejects.toMatchObject({ status: 409, message: "note already spent" });

    const { tree, notes } = await wallet();
    const change = spendableNotes(notes, ASSET.USDC)[0];
    expect(change.data.kind === "balance" && change.data.amount).toBe(69_950_000n);
    const plan = await buildSpend({
      keys, note: change, tree, publicAmount: 1_000_000n, fee: 50_000n, relayer: RELAYER,
      action: { type: "withdraw", recipient: user.account.address }, changeIndex: nextNoteIndex(notes),
    });
    const { proof } = await prover.prove("spend", plan.inputs);
    const tampered = spendBody({ ...plan, args: { ...plan.args, fee: 60_000n } }, proof);
    await expect(api.spend(tampered)).rejects.toMatchObject({ status: 400, message: "invalid proof" });

    const other = spendBody({ ...plan, args: { ...plan.args, relayer: user.account.address } }, proof);
    await expect(api.spend(other)).rejects.toMatchObject({ status: 400 });

    const cheap = await buildSpend({
      keys, note: change, tree, publicAmount: 1_000_000n, fee: 1n, relayer: RELAYER,
      action: { type: "withdraw", recipient: user.account.address }, changeIndex: nextNoteIndex(notes),
    });
    await expect(api.spend(spendBody(cheap, proof))).rejects.toThrow(RelayerHttpError);
    await expect(api.spend({ ...betBody, proof: "0x1234" as Hex })).rejects.toMatchObject({ status: 409 });
  }, 120_000);

  it("relays the winning redeem, then a withdraw to a fresh address", async () => {
    await testClient.increaseTime({ seconds: 2 * 86_400 });
    await testClient.mine({ blocks: 1 });
    await deployer.writeContract({ address: dep.Markets, abi: marketsAbi, functionName: "resolve", args: [1n, 1] });

    let { tree, notes } = await wallet();
    const [position] = unspentPositions(notes) as OwnedNote[];
    const [num, den, requiredSide, anySide] = await pub.readContract({
      address: dep.Markets, abi: marketsAbi, functionName: "redeemTerms", args: [1n],
    });
    const redeem = await buildRedeem({
      keys, note: position, tree, terms: { num, den, requiredSide: BigInt(requiredSide), anySide },
      fee: 50_000n, relayer: RELAYER, outIndex: nextNoteIndex(notes),
    });
    expect(redeem.payout).toBe(29_700_000n); // sole winner: pot minus the 1% fee
    const { proof } = await prover.prove("redeem", redeem.inputs);
    expect((await api.redeem(redeemBody(redeem, proof))).status).toBe("success");

    ({ tree, notes } = await wallet());
    expect(shieldedBalance(notes, ASSET.USDC)).toBe(69_950_000n + 29_650_000n);
    const winnings = spendableNotes(notes, ASSET.USDC).find((n) => n.data.kind === "balance" && n.data.amount === 29_650_000n)!;
    const fresh = privateKeyToAccount(`0x${"42".repeat(32)}`).address;
    const withdraw = await buildSpend({
      keys, note: winnings, tree, publicAmount: 29_600_000n, fee: 50_000n, relayer: RELAYER,
      action: { type: "withdraw", recipient: fresh }, changeIndex: nextNoteIndex(notes),
    });
    const w = await prover.prove("spend", withdraw.inputs);
    const res = await api.spend(spendBody(withdraw, w.proof));
    expect(res.status).toBe("success");
    expect(await usdcOf(fresh)).toBe(29_600_000n);
    expect(await usdcOf(RELAYER)).toBe(150_000n);
    console.log(`gas used: withdraw ${res.gasUsed}`);
  }, 180_000);
});
