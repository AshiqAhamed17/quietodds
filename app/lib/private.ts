"use client";

/// Private actions: every bet, withdrawal, batch join, claim and ticket redeem
/// is the same three steps.
///   1. sync   - read the pool fresh (through Anon-RPC) and pick a note
///   2. prove  - build the witness and prove it in this browser (bb.js)
///   3. relay  - send proof + public inputs to the relayer, which pays the gas
/// The proof binds the relayer's address and fee, so the relayer can only
/// submit exactly what the user built, or refuse.
import { formatUnits, type PublicClient } from "viem";
import {
  ASSET,
  buildRedeem,
  buildSpend,
  marketsAbi,
  batchSwapperAbi,
  redeemBody,
  relayerApi,
  spendBody,
  spendableNotes,
  ticketTerms,
  TAG,
  type Keys,
  type MerkleTree,
  type OwnedNote,
  type RedeemTerms,
  type RelayQuote,
  type RelayResult,
  type SpendAction,
} from "@quietodds/lib";
import type { Prover } from "@quietodds/lib/prover";
import { DEPLOYMENT, RELAYER_URL } from "./contract";

export const relayer = relayerApi(RELAYER_URL);

let prover: Promise<Prover> | null = null;
/// One Barretenberg instance per tab, created on first use (~1–2s).
export function getProver(): Promise<Prover> {
  prover ??= import("@quietodds/lib/prover").then(({ Prover }) =>
    Prover.create({
      // Multi-threaded proving needs cross-origin isolation (COOP/COEP headers).
      threads: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1,
    }),
  );
  return prover;
}

export type Step = "sync" | "prove" | "relay" | "done";
export const STEP_LABEL: Record<Step, string> = {
  sync: "Reading the pool through Anon-RPC",
  prove: "Proving in your browser",
  relay: "Relayer is submitting",
  done: "Done",
};

export interface Account {
  keys: Keys | null;
  sync: () => Promise<{ notes: OwnedNote[]; tree: MerkleTree }>;
  reserveIndices: (notes: readonly OwnedNote[], count: number) => number;
  rescan: () => Promise<void>;
}

export interface Done extends RelayResult {
  fee: bigint;
  amount: bigint;
}

const fmtAsset = (asset: bigint) => (asset === ASSET.USDC ? "USDC" : "WETH");

/** The relayer's minimum fee for a spend of this kind and asset. */
export function spendFee(q: RelayQuote, action: SpendAction["type"], asset: bigint): bigint {
  const usdc = asset === ASSET.USDC;
  if (action === "bet") return BigInt(q.fees.bet.usdc);
  if (action === "batchJoin") return BigInt(usdc ? q.fees.batchJoin.usdc : q.fees.batchJoin.weth);
  return BigInt(usdc ? q.fees.withdraw.usdc : q.fees.withdraw.weth);
}

/**
 * One relayed spend from a single private note. `amount: "max"` spends the
 * whole largest note (less the fee), e.g. for a full withdrawal.
 */
export async function relayedSpend(p: {
  account: Account;
  asset: bigint;
  amount: bigint | "max";
  action: SpendAction;
  onStep?: (s: Step) => void;
}): Promise<Done> {
  const { account } = p;
  if (!account.keys) throw new Error("Unlock your private account first");
  p.onStep?.("sync");
  const [q, fresh] = await Promise.all([relayer.quote(), account.sync()]);
  const fee = spendFee(q, p.action.type, p.asset);
  const notes = spendableNotes(fresh.notes, p.asset);
  if (notes.length === 0) throw new Error(`No private ${fmtAsset(p.asset)}. Deposit first.`);
  const largest = notes[0].data.kind === "balance" ? notes[0].data.amount : 0n;
  const amount = p.amount === "max" ? largest - fee : p.amount;
  if (amount <= 0n) throw new Error("Amount must be more than the relayer fee");
  const note = notes.find((n) => n.data.kind === "balance" && n.data.amount >= amount + fee);
  if (!note) {
    const dec = p.asset === ASSET.USDC ? 6 : 18;
    const sym = fmtAsset(p.asset);
    throw new Error(
      `Each private action spends one note. Your biggest ${sym} note is ${formatUnits(largest, dec)} ${sym}, so the most you can use is ${formatUnits(largest > fee ? largest - fee : 0n, dec)} ${sym} after the ${formatUnits(fee, dec)} ${sym} relayer fee. Deposit a larger amount (it arrives as one note) or lower the amount.`,
    );
  }
  const withOutput = p.action.type !== "withdraw";
  const changeIndex = account.reserveIndices(fresh.notes, withOutput ? 2 : 1);
  const plan = await buildSpend({
    keys: account.keys,
    note,
    tree: fresh.tree,
    publicAmount: amount,
    fee,
    relayer: q.relayer,
    action: p.action,
    changeIndex,
  });

  p.onStep?.("prove");
  const { proof } = await (await getProver()).prove("spend", plan.inputs);

  p.onStep?.("relay");
  const res = await relayer.spend(spendBody(plan, proof));
  if (res.status !== "success") throw new Error(`Transaction reverted: ${res.txHash}`);
  p.onStep?.("done");
  void account.rescan();
  return { ...res, fee, amount };
}

/** What the contract will plug into a redeem proof for this note, or null if not redeemable yet. */
export async function redeemTermsFor(client: PublicClient, note: OwnedNote): Promise<RedeemTerms | null> {
  try {
    if (note.data.kind === "position") {
      const [num, den, requiredSide, anySide] = await client.readContract({
        address: DEPLOYMENT.markets,
        abi: marketsAbi,
        functionName: "redeemTerms",
        args: [note.data.market],
      });
      return { num, den, requiredSide: BigInt(requiredSide), anySide };
    }
    if (note.data.kind === "ticket") {
      const [num, den, assetOut] = await client.readContract({
        address: DEPLOYMENT.batches,
        abi: batchSwapperAbi,
        functionName: "redeemTerms",
        args: [note.data.batch],
      });
      return ticketTerms(num, den, assetOut);
    }
  } catch {
    // NotFinal: the market or batch hasn't settled yet
  }
  return null;
}

/** Can this position/ticket be redeemed under these terms, and for how much? */
export function redeemPreview(note: OwnedNote, t: RedeemTerms): { ok: boolean; payout: bigint; asset: bigint } {
  const asset = t.assetOut ?? ASSET.USDC;
  if (note.data.kind === "position") {
    const ok = t.anySide || note.data.side === t.requiredSide;
    return { ok, payout: ok ? (note.data.stake * t.num) / t.den : 0n, asset };
  }
  if (note.data.kind === "ticket") return { ok: true, payout: (note.data.amountIn * t.num) / t.den, asset };
  return { ok: false, payout: 0n, asset };
}

/** Claims a winning/refunded position or redeems a batch ticket, via the relayer. */
export async function relayedRedeem(p: {
  account: Account;
  client: PublicClient;
  leafIndex: number;
  onStep?: (s: Step) => void;
}): Promise<Done> {
  const { account } = p;
  if (!account.keys) throw new Error("Unlock your private account first");
  p.onStep?.("sync");
  const [q, fresh] = await Promise.all([relayer.quote(), account.sync()]);
  const note = fresh.notes.find((n) => n.leafIndex === p.leafIndex && !n.spent);
  if (!note) throw new Error("That note is already spent");
  const terms = await redeemTermsFor(p.client, note);
  if (!terms) throw new Error("Not settled yet");
  const { ok, payout, asset } = redeemPreview(note, terms);
  if (!ok) throw new Error("This position is on the losing side");
  const fee = BigInt(asset === ASSET.USDC ? q.fees.redeem.usdc : q.fees.redeem.weth);
  if (payout <= fee) throw new Error("Payout is smaller than the relayer fee");
  const plan = await buildRedeem({
    keys: account.keys,
    note,
    tree: fresh.tree,
    terms,
    fee,
    relayer: q.relayer,
    outIndex: account.reserveIndices(fresh.notes, 1),
  });

  p.onStep?.("prove");
  const { proof } = await (await getProver()).prove("redeem", plan.inputs);

  p.onStep?.("relay");
  const res = await relayer.redeem(redeemBody(plan, proof));
  if (res.status !== "success") throw new Error(`Transaction reverted: ${res.txHash}`);
  p.onStep?.("done");
  void account.rescan();
  return { ...res, fee, amount: payout - fee };
}

export { TAG };
