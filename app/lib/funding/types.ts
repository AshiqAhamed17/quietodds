import type { Hex } from "viem";
import type { Step } from "@/lib/private";

/**
 * A new QuietOdds balance note, ready to be created by whatever pays for it.
 * The funding source only ever sees the precommitment and the encrypted backup.
 */
export interface ShieldNote {
  /** The note index under the user's keys (reserved, so it's not reused). */
  index: number;
  asset: bigint;
  amount: bigint;
  precommitment: bigint;
  ciphertext: Hex;
}

export interface SourceBalance {
  /** Can be moved into QuietOdds now. */
  available: bigint;
  /** Waiting on the source (e.g. Privacy Pools' ASP approval). */
  pending: bigint;
}

/**
 * Somewhere private funds come from: Privacy Pools v2 now, Gloam later.
 * One shape for all of them, so the "Add funds" UI and `fundFrom` don't care
 * which. `prepare` gets the amount that should land in QuietOdds after fees.
 */
export interface FundingSource<Prepared = unknown> {
  id: "privacyPools" | "gloam";
  label: string;
  /** Only USDC for now: the depositor contracts shield into ASSET_USDC. */
  asset: bigint;
  balance(): Promise<SourceBalance>;
  /** The source's fee on top of `amount` (relayer, vetting…), for the UI. */
  quoteFee(amount: bigint): Promise<bigint>;
  /** Builds the source's transaction around the new note, without proving. */
  prepare(note: ShieldNote): Promise<Prepared>;
  /** Proves in the browser. */
  prove(prepared: Prepared): Promise<Prepared>;
  /** Sends it (through our relayer, or the user's wallet) and waits for it. */
  submit(prepared: Prepared): Promise<Hex>;
}

export type OnStep = (s: Step) => void;
