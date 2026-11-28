import { deriveNote, encryptNote } from "@quietodds/lib";
import type { Account } from "@/lib/private";
import type { FundingSource, OnStep, ShieldNote } from "./types";

export type { FundingSource, ShieldNote, SourceBalance } from "./types";

/**
 * Picks the user's next note index and builds the note a deposit will create:
 * its precommitment plus a backup encrypted to the viewing key. Shared by the
 * wallet deposit and every funding source.
 */
export async function nextShieldNote(account: Account, asset: bigint, amount: bigint): Promise<ShieldNote> {
  if (!account.keys) throw new Error("Unlock your private account first");
  const fresh = await account.sync();
  const index = account.reserveIndices(fresh.notes, 1);
  const { precommitment } = deriveNote(account.keys, index);
  const ciphertext = await encryptNote(account.keys.viewingKey, { kind: "balance", index, asset, amount });
  return { index, asset, amount, precommitment, ciphertext };
}

/** Moves `amount` from a funding source into a new private QuietOdds balance. */
export async function fundFrom<P>(p: {
  source: FundingSource<P>;
  account: Account;
  amount: bigint;
  onStep?: OnStep;
}): Promise<{ txHash: string; summary: string }> {
  const { source, account, amount } = p;
  if (amount <= 0n) throw new Error("Enter an amount");
  p.onStep?.("sync");
  const [{ available }, fee] = await Promise.all([source.balance(), source.quoteFee(amount)]);
  if (amount + fee > available) throw new Error(`Not enough ready in ${source.label}`);
  const note = await nextShieldNote(account, source.asset, amount);
  const prepared = await source.prepare(note);
  p.onStep?.("prove");
  const proved = await source.prove(prepared);
  p.onStep?.("relay");
  const txHash = await source.submit(proved);
  void account.rescan();
  return { txHash, summary: `Moved funds from ${source.label} into your private balance.` };
}
