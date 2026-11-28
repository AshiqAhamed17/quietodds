import { decodeAbiParameters, encodeAbiParameters, zeroAddress, type Address, type Hex } from "viem";

/**
 * What a funding source's proof commits to for PrivacyPoolsDepositor.fund
 * (and later GloamDepositor): the new QuietOdds note, its backup, and who
 * may submit it for which fee. Privacy Pools binds these bytes into the proof's
 * context, so a relayer can't change any of them.
 */
export interface FundingData {
  precommitment: bigint;
  ciphertext: Hex;
  /** The relayer allowed to submit, or the zero address for self-submit (fee must be 0). */
  relayer: Address;
  /** USDC (6 decimals) paid to the relayer out of the withdrawn amount. */
  fee: bigint;
}

const FUNDING_DATA = [
  { name: "precommitment", type: "uint256" },
  { name: "ciphertext", type: "bytes" },
  { name: "relayer", type: "address" },
  { name: "fee", type: "uint256" },
] as const;

export function encodeFundingData(d: FundingData): Hex {
  if (d.relayer === zeroAddress && d.fee !== 0n) throw new Error("Self-submit can't pay a fee");
  return encodeAbiParameters(FUNDING_DATA, [d.precommitment, d.ciphertext, d.relayer, d.fee]);
}

export function decodeFundingData(data: Hex): FundingData {
  const [precommitment, ciphertext, relayer, fee] = decodeAbiParameters(FUNDING_DATA, data);
  return { precommitment, ciphertext, relayer, fee };
}
