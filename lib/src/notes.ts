// Note leaves and nullifiers, identical to circuits/lib/src/note.nr.
// poseidon-lite uses the circomlib parameters, which match Noir's bn254
// Poseidon (checked by scripts/poseidon-parity.mjs and PoseidonParity.t.sol).
import { poseidon2, poseidon4, poseidon5 } from "poseidon-lite";
import { TAG } from "./constants.ts";

export const precommitment = (nullifier: bigint, secret: bigint) => poseidon2([nullifier, secret]);
export const nullifierHash = (nullifier: bigint) => poseidon2([nullifier, TAG.NULLIFIER]);

export const balanceLeaf = (asset: bigint, amount: bigint, pc: bigint) =>
  poseidon4([TAG.BALANCE, asset, amount, pc]);
export const positionLeaf = (market: bigint, side: bigint, stake: bigint, pc: bigint) =>
  poseidon5([TAG.POSITION, market, side, stake, pc]);
export const ticketLeaf = (batch: bigint, amountIn: bigint, pc: bigint) =>
  poseidon4([TAG.TICKET, batch, amountIn, pc]);
