// Rebuilds a user's notes from pool events: decrypt the backups that are
// ours, check each against its on-chain leaf, and mark the spent ones.
import type { Hex } from "viem";
import { decryptNote, viewingCryptoKey, type NoteData } from "./backup.ts";
import { deriveNote, type Keys, type NoteSecrets } from "./keys.ts";
import { balanceLeaf, positionLeaf, ticketLeaf } from "./notes.ts";

export interface PoolLeaf {
  index: number;
  leaf: bigint;
  ciphertext: Hex;
}

export interface OwnedNote {
  data: NoteData;
  secrets: NoteSecrets;
  leafIndex: number;
  leaf: bigint;
  spent: boolean;
}

export function noteLeaf(data: NoteData, pc: bigint): bigint {
  switch (data.kind) {
    case "balance":
      return balanceLeaf(data.asset, data.amount, pc);
    case "position":
      return positionLeaf(data.market, data.side, data.stake, pc);
    case "ticket":
      return ticketLeaf(data.batch, data.amountIn, pc);
  }
}

/**
 * Our notes among `leaves`. A ciphertext only counts if the leaf it claims
 * to describe is really the one on chain, so a forged backup is ignored.
 */
export async function scanNotes(
  keys: Keys,
  leaves: readonly PoolLeaf[],
  isSpent: (nullifierHash: bigint) => boolean,
): Promise<OwnedNote[]> {
  const key = await viewingCryptoKey(keys.viewingKey);
  const owned: OwnedNote[] = [];
  for (const l of leaves) {
    if (l.ciphertext === "0x") continue;
    const data = await decryptNote(keys.viewingKey, l.ciphertext, key);
    if (!data) continue;
    const secrets = deriveNote(keys, data.index);
    if (noteLeaf(data, secrets.precommitment) !== l.leaf) continue;
    owned.push({ data, secrets, leafIndex: l.index, leaf: l.leaf, spent: isSpent(secrets.nullifierHash) });
  }
  return owned;
}

/** First note index this user has never used. */
export const nextNoteIndex = (notes: readonly OwnedNote[]) =>
  notes.reduce((max, n) => Math.max(max, n.data.index + 1), 0);

/** Unspent, non-empty balance notes of `asset`, largest first. */
export const spendableNotes = (notes: readonly OwnedNote[], asset: bigint) =>
  notes
    .filter((n) => !n.spent && n.data.kind === "balance" && n.data.asset === asset && n.data.amount > 0n)
    .sort((a, b) => (a.data.kind === "balance" && b.data.kind === "balance" ? Number(b.data.amount - a.data.amount) : 0));

export const unspentPositions = (notes: readonly OwnedNote[]) =>
  notes.filter((n) => !n.spent && n.data.kind === "position");

export const unspentTickets = (notes: readonly OwnedNote[]) =>
  notes.filter((n) => !n.spent && n.data.kind === "ticket");

export function shieldedBalance(notes: readonly OwnedNote[], asset: bigint): bigint {
  let total = 0n;
  for (const n of notes) if (!n.spent && n.data.kind === "balance" && n.data.asset === asset) total += n.data.amount;
  return total;
}
