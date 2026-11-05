import { FIELD } from "./constants.ts";

export type Hex = `0x${string}`;

/** A field element as a 32-byte hex word, the form public inputs take. */
export const toBytes32 = (v: bigint): Hex => `0x${v.toString(16).padStart(64, "0")}`;

/** Uniformly random field element (the 2^-128 bias from 48 bytes is negligible). */
export function randomField(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD;
}

export const isField = (v: bigint) => v >= 0n && v < FIELD;
