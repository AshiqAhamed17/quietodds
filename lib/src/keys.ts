// A user's whole private state hangs off one spending key. It is derived from
// a wallet signature, so the same wallet always recovers the same notes on
// any device, and nothing needs to be backed up separately.
import { poseidon3 } from "poseidon-lite";
import { concat, hexToBytes, keccak256, toHex, type Hex } from "viem";
import { FIELD } from "./constants.ts";
import { nullifierHash, precommitment } from "./notes.ts";

/** Signed once per session. Changing it changes every user's keys. */
export const KEY_MESSAGE =
  "QuietOdds private account\n\nSign to unlock your private balance. This costs no gas and does not move funds.\n\nOnly sign this on QuietOdds.";

export interface Keys {
  /** Field element; every note's nullifier and secret come from it. */
  spendingKey: bigint;
  /** AES-256 key for note backups. Lets its holder see, but not spend, notes. */
  viewingKey: Uint8Array;
}

export function keysFromSpendingKey(spendingKey: bigint): Keys {
  if (spendingKey <= 0n || spendingKey >= FIELD) throw new Error("spending key out of range");
  const viewingKey = hexToBytes(keccak256(concat([toHex("quietodds:view"), toHex(spendingKey, { size: 32 })])));
  return { spendingKey, viewingKey };
}

/** Keys from a wallet's signature of KEY_MESSAGE (deterministic for EOAs). */
export function keysFromSignature(signature: Hex): Keys {
  return keysFromSpendingKey(BigInt(keccak256(signature)) % FIELD);
}

/** The secrets of the note at `index` in this user's note sequence. */
export interface NoteSecrets {
  index: number;
  nullifier: bigint;
  secret: bigint;
  precommitment: bigint;
  nullifierHash: bigint;
}

export function deriveNote(keys: Keys, index: number): NoteSecrets {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("bad note index");
  const i = BigInt(index);
  const nullifier = poseidon3([keys.spendingKey, i, 1n]);
  const secret = poseidon3([keys.spendingKey, i, 2n]);
  return {
    index,
    nullifier,
    secret,
    precommitment: precommitment(nullifier, secret),
    nullifierHash: nullifierHash(nullifier),
  };
}
