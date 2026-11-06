// QuietOdds private batch swap + LP donation on Sepolia (milestone M4):
//
//   1. the owner opens a short market replaying a finished match
//   2. Priya, Rahul and Arjun deposit USDC from their wallets (public)
//   3. each bets privately, then joins the USDC->WETH batch privately (relayed)
//   4. one CRE report (cre simulate --broadcast) resolves the market, executes
//      the batch as ONE swap through the hooked v4 pool, and donates the
//      market's 1% fee to the pool's LPs
//   5. each redeems their batch ticket privately for a hidden WETH note
//   6. Priya withdraws her WETH to a brand-new address
//
// Every transaction hash lands in deployments/batch-e2e-sepolia.json.
//   npm run batch-e2e -w scripts        (relayer running at RELAYER_URL, default :8787)
//   RESUME=1 picks up after the CRE report from the saved record.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, decodeEventLog, formatEther, formatUnits, http, parseAbi,
  type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import {
  ASSET, KEY_MESSAGE, MerkleTree, batchSwapperAbi, buildRedeem, buildSpend, deriveNote, encryptNote,
  fetchPoolState, keysFromSignature, marketsAbi, nextNoteIndex, redeemBody, relayerApi, scanNotes, sepolia,
  shieldedPoolAbi, spendBody, spendableNotes, ticketTerms, unspentTickets, type Keys,
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
const CLOSE_MINUTES = Number(process.env.E2E_CLOSE_MINUTES ?? 7);
const DEPOSIT = 4_000_000n; // 4 USDC each
const BET = 1_000_000n;
// Liverpool 0-1 Arsenal, Premier League, 1 Nov 2026 (ESPN event 401879246).
const MATCH = { question: "[M4 replay] Liverpool vs Arsenal (played 1 Nov)", outcomes: "Liverpool|Draw|Arsenal", ref: "espn:soccer/eng.1:401879246" };

const transport = http(env("SEPOLIA_RPC_URL"));
// Note scanning needs wide eth_getLogs ranges, which some free RPC tiers cap (Alchemy: 10 blocks).
const pub = createPublicClient({ chain, transport: http(process.env.LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
const wallet = (key: string) => createWalletClient({ chain, transport, account: privateKeyToAccount(key as Hex) });
const deployer = wallet(env("DEPLOYER_PRIVATE_KEY"));
const users = [
  { name: "priya", w: wallet(env("USER1_PRIVATE_KEY")), side: 0n, join: 1_200_000n },
  { name: "rahul", w: wallet(env("USER2_PRIVATE_KEY")), side: 2n, join: 1_000_000n },
  { name: "arjun", w: wallet(env("USER3_PRIVATE_KEY")), side: 1n, join: 1_000_000n },
];
const api = relayerApi(RELAYER_URL);

const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const weth = (v: bigint) => `${formatEther(v)} WETH`;

const OUT = `${ROOT}deployments/batch-e2e-sepolia.json`;
const RESUME = process.env.RESUME === "1";
const record: { steps: { step: string; tx: Hex; gasUsed: string }[]; [k: string]: unknown } = RESUME
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : { network: "sepolia", pool: sepolia.pool, batches: sepolia.batches, hook: sepolia.hook, relayer: RELAYER_URL, steps: [] };
const save = () => writeFileSync(OUT, JSON.stringify(record, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
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
/** Load-balanced RPC nodes can lag a block behind a receipt we just saw: retry reads. */
async function retry<T>(f: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 4_000));
    }
  }
}

/** What the CRE report did, from its BatchSwapper events. */
async function recordCreReport(creTx: Hex) {
  const receipt = await pub.getTransactionReceipt({ hash: creTx });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== sepolia.batches.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: batchSwapperAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "BatchExecuted") {
        record.batchExecuted = { totalIn: ev.args.totalIn, amountOut: ev.args.amountOut, minOut: ev.args.minOut };
        console.log(`  batch swapped ${usdc(ev.args.totalIn)} -> ${weth(ev.args.amountOut)} (oracle floor ${weth(ev.args.minOut)})`);
      }
      if (ev.eventName === "FeesDonated") {
        record.feesDonated = ev.args.amount;
        console.log(`  donated ${usdc(ev.args.amount)} of market fees to the pool's LPs`);
      }
    } catch {
      // not a BatchSwapper event we track
    }
  }
  save();
}

async function waitUntil(t: bigint, what: string) {
  for (;;) {
    const now = (await pub.getBlock({ blockTag: "latest" })).timestamp;
    if (now >= t) return;
    process.stdout.write(`  waiting ${t - now}s for ${what}...   \r`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function main() {
  const quote = await api.quote();
  const relayer = quote.relayer;
  console.log(`relayer ${relayer} at ${RELAYER_URL}`);
  const prover = await Prover.create();
  const keys: Record<string, Keys> = {};
  for (const u of users) keys[u.name] = keysFromSignature(await u.w.signMessage({ message: KEY_MESSAGE }));

  let marketId: bigint, batchId: bigint;
  if (RESUME) {
    marketId = BigInt(record.marketId as string);
    batchId = BigInt(record.batchId as string);
    const creTx = record.steps.find((st) => st.step.startsWith("CRE report"))!.tx;
    console.log(`resuming after CRE report ${creTx}`);
    await recordCreReport(creTx);
  } else {
    console.log("1. open the market");
    const closeTime = (await pub.getBlock()).timestamp + BigInt(CLOSE_MINUTES * 60);
    const created = await send("createMarket", deployer, {
      address: sepolia.markets, abi: marketsAbi, functionName: "createMarket",
      args: [MATCH.question, MATCH.outcomes, 3, closeTime, 1, MATCH.ref, "0x0000000000000000000000000000000000000000", 0n],
    });
    marketId = await pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "marketCount", blockNumber: created.blockNumber });
    batchId = await pub.readContract({ address: sepolia.batches, abi: batchSwapperAbi, functionName: "currentBatch", args: [0] });
    Object.assign(record, { marketId, batchId, closeTime });
    console.log(`  market ${marketId} closes ${new Date(Number(closeTime) * 1000).toISOString()}; USDC->WETH batch is #${batchId}`);

    console.log("2. public deposits");
    for (const u of users) {
      const k = keys[u.name];
      const { notes } = await notesOf(k);
      const index = nextNoteIndex(notes);
      const ct = await encryptNote(k.viewingKey, { kind: "balance", index, asset: ASSET.USDC, amount: DEPOSIT });
      await send(`${u.name}: approve`, u.w, { address: sepolia.usdc, abi: erc20, functionName: "approve", args: [sepolia.pool, DEPOSIT] });
      await send(`${u.name}: deposit ${usdc(DEPOSIT)}`, u.w, {
        address: sepolia.pool, abi: shieldedPoolAbi, functionName: "deposit",
        args: [ASSET.USDC, DEPOSIT, deriveNote(k, index).precommitment, ct],
      });
    }

    console.log("3. private bets and batch joins through the relayer");
    for (const u of users) {
      const k = keys[u.name];
      for (const action of [
        { type: "bet", market: marketId, side: u.side } as const,
        { type: "batchJoin", batch: batchId } as const,
      ]) {
        const q = await api.quote();
        const { tree, notes } = await notesOf(k);
        const amount = action.type === "bet" ? BET : u.join;
        const plan = await buildSpend({
          keys: k, note: spendableNotes(notes, ASSET.USDC)[0], tree, publicAmount: amount,
          fee: BigInt(action.type === "bet" ? q.fees.bet.usdc : q.fees.batchJoin.usdc), relayer, action,
          changeIndex: nextNoteIndex(notes),
        });
        const { proof } = await prover.prove("spend", plan.inputs);
        const res = await api.spend(spendBody(plan, proof));
        const label = action.type === "bet" ? `private bet ${usdc(amount)} on side ${u.side}` : `private join of batch #${batchId} with ${usdc(amount)}`;
        await step(`${u.name}: ${label} (relayed)`, res.txHash, res.gasUsed);
      }
    }
    const batch = await pub.readContract({ address: sepolia.batches, abi: batchSwapperAbi, functionName: "getBatch", args: [batchId] });
    console.log(`  batch #${batchId}: ${usdc(batch.totalIn)} from 3 anonymous joins`);

    console.log("4. one CRE report: resolve + execute the batch + donate fees to LPs");
    const interval = await pub.readContract({ address: sepolia.batches, abi: batchSwapperAbi, functionName: "BATCH_INTERVAL" });
    await waitUntil(closeTime > batch.firstJoinAt + interval ? closeTime : batch.firstJoinAt + interval, "market close and batch interval");
    const minOut = await pub.readContract({ address: sepolia.batches, abi: batchSwapperAbi, functionName: "minOutFor", args: [0, batch.totalIn] });
    const out = execFileSync(
      "cre",
      ["workflow", "simulate", "resolver", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0", "-e", "../.env", "--broadcast"],
      { cwd: `${ROOT}cre`, encoding: "utf8" },
    );
    const creTx = /tx (0x[0-9a-fA-F]{64})/.exec(out)?.[1] as Hex | undefined;
    if (!creTx) throw new Error(`CRE did not report:\n${out.slice(-1500)}`);
    await step("CRE report -> ResolverReceiver (resolve, executeBatch, donateFees)", creTx);
    await recordCreReport(creTx);
    if (!record.batchExecuted) throw new Error(`batch not executed (oracle floor was ${weth(minOut)}); see the CRE tx logs`);
    if (!record.feesDonated) throw new Error("fees not donated; see the CRE tx logs");
  }
  const m = await retry(() => pub.readContract({ address: sepolia.markets, abi: marketsAbi, functionName: "getMarket", args: [marketId] }));
  console.log(`  market resolved: side ${m.winningSide}, pot ${usdc(m.pot)}, fee ${usdc(m.protocolFee)}`);

  console.log("5. private ticket redeems (uniform price, pro rata)");
  const [num, den, assetOut] = await retry(() =>
    pub.readContract({ address: sepolia.batches, abi: batchSwapperAbi, functionName: "redeemTerms", args: [batchId] }),
  );
  const terms = ticketTerms(num, den, assetOut);
  const redeemed: Record<string, string> = {};
  for (const u of users) {
    const k = keys[u.name];
    const { tree, notes } = await notesOf(k);
    const ticket = unspentTickets(notes).find((n) => n.data.kind === "ticket" && n.data.batch === batchId)!;
    const plan = await buildRedeem({
      keys: k, note: ticket, tree, terms, fee: BigInt((await api.quote()).fees.redeem.weth), relayer, outIndex: nextNoteIndex(notes),
    });
    const { proof } = await prover.prove("redeem", plan.inputs);
    const res = await api.redeem(redeemBody(plan, proof));
    redeemed[u.name] = plan.args.outCommitment.toString();
    await step(`${u.name}: redeem ticket for ${weth(plan.payout)} (relayed)`, res.txHash, res.gasUsed);
  }

  console.log("6. Priya withdraws her WETH to a fresh address");
  const { tree, notes } = await notesOf(keys.priya);
  const note = spendableNotes(notes, ASSET.WETH).find((n) => n.leaf.toString() === redeemed.priya)!;
  const wFee = BigInt((await api.quote()).fees.withdraw.weth);
  const amount = note.data.kind === "balance" ? note.data.amount - wFee : 0n;
  const fresh = privateKeyToAccount(generatePrivateKey()).address as Address;
  const plan = await buildSpend({
    keys: keys.priya, note, tree, publicAmount: amount, fee: wFee, relayer,
    action: { type: "withdraw", recipient: fresh }, changeIndex: nextNoteIndex(notes),
  });
  const { proof } = await prover.prove("spend", plan.inputs);
  const res = await api.spend(spendBody(plan, proof));
  await step(`priya: withdraw ${weth(amount)} to fresh ${fresh} (relayed)`, res.txHash, res.gasUsed);
  const got = await pub.readContract({ address: sepolia.weth, abi: erc20, functionName: "balanceOf", args: [fresh] });
  Object.assign(record, { freshAddress: fresh, freshWeth: got, completedAt: new Date().toISOString() });
  save();
  console.log(`  fresh address holds ${weth(got)}`);
  await prover.destroy();
  console.log(`done: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
