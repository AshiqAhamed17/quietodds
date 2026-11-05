// QuietOdds end to end on Sepolia (milestone M2):
//
//   1. the owner opens a short market replaying a finished match
//   2. Priya and Rahul deposit USDC from their wallets (public)
//   3. each bets privately through the relayer (their wallets never appear)
//   4. after close, the CRE workflow resolves it from ESPN (cre simulate --broadcast)
//   5. Rahul, the winner, claims privately through the relayer
//   6. Rahul withdraws the winnings to a brand-new address
//
// Every transaction hash lands in deployments/e2e-sepolia.json.
//   npm run e2e -w scripts        (relayer running at RELAYER_URL, default :8787)
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, formatUnits, http, parseAbi, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import {
  ASSET, KEY_MESSAGE, MerkleTree, buildRedeem, buildSpend, deriveNote, encryptNote, fetchPoolState, keysFromSignature,
  marketsAbi, nextNoteIndex, redeemBody, relayerApi, scanNotes, sepolia, shieldedBalance, shieldedPoolAbi,
  spendBody, spendableNotes, unspentPositions, type Keys,
} from "@quietodds/lib";
import { Prover } from "@quietodds/lib/prover";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const RELAYER_URL = process.env.RELAYER_URL ?? "http://localhost:8787";
const CLOSE_MINUTES = Number(process.env.E2E_CLOSE_MINUTES ?? 8);
const DEPOSIT = 10_000_000n; // 10 USDC each
// Liverpool 0-1 Arsenal, Premier League, 1 Nov 2026 (ESPN event 401879246).
const MATCH = { question: "[E2E replay] Liverpool vs Arsenal (played 1 Nov)", outcomes: "Liverpool|Draw|Arsenal", ref: "espn:soccer/eng.1:401879246" };

const transport = http(env("SEPOLIA_RPC_URL"));
// Note scanning needs wide eth_getLogs ranges, which some free RPC tiers cap (Alchemy: 10 blocks).
const pub = createPublicClient({ chain, transport: http(process.env.LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const wallet = (key: string) => createWalletClient({ chain, transport, account: privateKeyToAccount(key as Hex) });
const deployer = wallet(env("DEPLOYER_PRIVATE_KEY"));
const priya = wallet(env("USER1_PRIVATE_KEY"));
const rahul = wallet(env("USER2_PRIVATE_KEY"));
const api = relayerApi(RELAYER_URL);

// Sepolia's base fee is a few wei: a tiny tip is plenty, and gas limits come from the node.
const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;

const record: { steps: { step: string; tx: Hex; gasUsed: string }[]; [k: string]: unknown } = {
  network: "sepolia", pool: sepolia.pool, markets: sepolia.markets, relayer: RELAYER_URL, steps: [],
};
function save() {
  writeFileSync(`${ROOT}deployments/e2e-sepolia.json`, JSON.stringify(record, null, 2) + "\n");
}
async function step(name: string, hash: Hex, gasUsed?: string) {
  const gas = gasUsed ?? (await pub.waitForTransactionReceipt({ hash })).gasUsed.toString();
  record.steps.push({ step: name, tx: hash, gasUsed: gas });
  save();
  console.log(`  ✓ ${name}  ${hash}  gas ${gas}`);
}
async function send(name: string, w: ReturnType<typeof wallet>, req: Parameters<typeof w.writeContract>[0]) {
  const hash = await w.writeContract({ ...req, ...fees } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${name} reverted: ${hash}`);
  await step(name, hash, r.gasUsed.toString());
  return r;
}

async function notesOf(keys: Keys) {
  const state = await fetchPoolState(pub, sepolia.pool, sepolia.deployBlock);
  const notes = await scanNotes(keys, state.leaves, (h) => state.nullifiers.has(h));
  return { tree: new MerkleTree(state.leaves.map((l) => l.leaf)), notes };
}

async function main() {
  const quote = await api.quote();
  const relayer = quote.relayer;
  console.log(`relayer ${relayer} at ${RELAYER_URL}`);
  const prover = await Prover.create();

  // Keys come from each user's wallet signature, exactly as in the app.
  const keys = {
    priya: keysFromSignature(await priya.signMessage({ message: KEY_MESSAGE })),
    rahul: keysFromSignature(await rahul.signMessage({ message: KEY_MESSAGE })),
  };

  console.log("1. open the market");
  const now = (await pub.getBlock()).timestamp;
  const closeTime = now + BigInt(CLOSE_MINUTES * 60);
  const created = await send("createMarket", deployer, {
    address: sepolia.markets, abi: marketsAbi, functionName: "createMarket",
    args: [MATCH.question, MATCH.outcomes, 3, closeTime, 1, MATCH.ref, "0x0000000000000000000000000000000000000000", 0n],
  });
  const marketId = (await pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "marketCount", blockNumber: created.blockNumber }));
  record.marketId = marketId.toString();
  record.closeTime = closeTime.toString();
  console.log(`  market ${marketId}, closes at ${new Date(Number(closeTime) * 1000).toISOString()}`);

  console.log("2. public deposits");
  for (const [name, w, k] of [["priya", priya, keys.priya], ["rahul", rahul, keys.rahul]] as const) {
    const { notes } = await notesOf(k);
    const index = nextNoteIndex(notes);
    const pc = deriveNote(k, index).precommitment;
    const ct = await encryptNote(k.viewingKey, { kind: "balance", index, asset: ASSET.USDC, amount: DEPOSIT });
    await send(`${name}: approve`, w, { address: sepolia.usdc, abi: erc20, functionName: "approve", args: [sepolia.pool, DEPOSIT] });
    await send(`${name}: deposit 10 USDC`, w, {
      address: sepolia.pool, abi: shieldedPoolAbi, functionName: "deposit", args: [ASSET.USDC, DEPOSIT, pc, ct],
    });
  }

  console.log("3. private bets through the relayer");
  const betFee = BigInt(quote.fees.bet.usdc);
  for (const [name, k, side, stake] of [["priya", keys.priya, 0n, 4_000_000n], ["rahul", keys.rahul, 2n, 6_000_000n]] as const) {
    const { tree, notes } = await notesOf(k);
    const plan = await buildSpend({
      keys: k, note: spendableNotes(notes, ASSET.USDC)[0], tree, publicAmount: stake, fee: betFee, relayer,
      action: { type: "bet", market: marketId, side }, changeIndex: nextNoteIndex(notes),
    });
    const { proof } = await prover.prove("spend", plan.inputs);
    const res = await api.spend(spendBody(plan, proof));
    await step(`${name}: private bet ${usdc(stake)} on side ${side} (relayed)`, res.txHash, res.gasUsed);
  }
  const totals = await pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "getSideTotals", args: [marketId] });
  console.log(`  public side totals: ${totals.map(usdc).join(" | ")}`);

  console.log("4. CRE resolves after close");
  for (;;) {
    const t = (await pub.getBlock({ blockTag: "latest" })).timestamp;
    if (t >= closeTime) break;
    process.stdout.write(`  waiting ${closeTime - t}s for close...\r`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const out = execFileSync(
    "cre",
    ["workflow", "simulate", "resolver", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0", "-e", "../.env", "--broadcast"],
    { cwd: `${ROOT}cre`, encoding: "utf8" },
  );
  const creTx = /tx (0x[0-9a-fA-F]{64})/.exec(out)?.[1] as Hex | undefined;
  if (!creTx) throw new Error(`CRE did not report:\n${out.slice(-1500)}`);
  await step("CRE resolver report -> ResolverReceiver", creTx);
  const m = await pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "getMarket", args: [marketId] });
  if (m.status !== 2) throw new Error(`market not resolved (status ${m.status})`);
  console.log(`  resolved: winning side ${m.winningSide} (Arsenal), pot ${usdc(m.pot)}`);

  console.log("5. Rahul claims privately");
  let { tree, notes } = await notesOf(keys.rahul);
  const [num, den, requiredSide, anySide] = await pub.readContract({
    address: sepolia.markets, abi: marketsAbi, functionName: "redeemTerms", args: [marketId],
  });
  const terms = { num, den, requiredSide: BigInt(requiredSide), anySide };
  const position = unspentPositions(notes).find((n) => n.data.kind === "position" && n.data.market === marketId)!;
  const redeem = await buildRedeem({
    keys: keys.rahul, note: position, tree, terms, fee: BigInt((await api.quote()).fees.redeem.usdc), relayer,
    outIndex: nextNoteIndex(notes),
  });
  const rp = await prover.prove("redeem", redeem.inputs);
  const rres = await api.redeem(redeemBody(redeem, rp.proof));
  await step(`rahul: private claim of ${usdc(redeem.payout)} (relayed)`, rres.txHash, rres.gasUsed);

  // Priya's position lost: no valid proof exists for it.
  const pn = await notesOf(keys.priya);
  const lost = unspentPositions(pn.notes).find((n) => n.data.kind === "position" && n.data.market === marketId)!;
  await buildRedeem({ keys: keys.priya, note: lost, tree: pn.tree, terms, fee: 0n, relayer, outIndex: 999 }).then(
    () => { throw new Error("losing position produced a claim"); },
    (e: Error) => console.log(`  priya's losing position cannot be claimed: ${e.message}`),
  );

  console.log("6. Rahul withdraws to a fresh address");
  ({ tree, notes } = await notesOf(keys.rahul));
  const winnings = spendableNotes(notes, ASSET.USDC).find((n) => n.leaf === redeem.args.outCommitment)!;
  const fresh = privateKeyToAccount(generatePrivateKey()).address as Address;
  const wFee = BigInt((await api.quote()).fees.withdraw.usdc);
  const amount = winnings.data.kind === "balance" ? winnings.data.amount - wFee : 0n;
  const withdraw = await buildSpend({
    keys: keys.rahul, note: winnings, tree, publicAmount: amount, fee: wFee, relayer,
    action: { type: "withdraw", recipient: fresh }, changeIndex: nextNoteIndex(notes),
  });
  const wp = await prover.prove("spend", withdraw.inputs);
  const wres = await api.spend(spendBody(withdraw, wp.proof));
  await step(`rahul: withdraw ${usdc(amount)} to fresh ${fresh} (relayed)`, wres.txHash, wres.gasUsed);
  const got = await pub.readContract({ address: sepolia.usdc, abi: erc20, functionName: "balanceOf", args: [fresh] });
  record.freshAddress = fresh;
  record.freshBalance = got.toString();
  console.log(`  fresh address holds ${usdc(got)}`);

  ({ notes } = await notesOf(keys.rahul));
  console.log(`  rahul's remaining shielded balance: ${usdc(shieldedBalance(notes, ASSET.USDC))}`);
  record.completedAt = new Date().toISOString();
  save();
  await prover.destroy();
  console.log("done: deployments/e2e-sepolia.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
