// Note leaves and nullifiers, identical to circuits/lib/src/note.nr.
import { poseidon2, poseidon4, poseidon5 } from "poseidon-lite";

export const TAG_BALANCE = 1n;
export const TAG_POSITION = 2n;
export const TAG_TICKET = 3n;
export const TAG_NULLIFIER = 9n;

export const ASSET = { USDC: 1n, WETH: 2n };
export const ACTION = { WITHDRAW: 1n, BET: 2n, BATCH_JOIN: 3n };

export const precommitment = (nullifier, secret) => poseidon2([nullifier, secret]);
export const nullifierHash = (nullifier) => poseidon2([nullifier, TAG_NULLIFIER]);
export const balanceLeaf = (asset, amount, pc) => poseidon4([TAG_BALANCE, asset, amount, pc]);
export const positionLeaf = (market, side, stake, pc) => poseidon5([TAG_POSITION, market, side, stake, pc]);
export const ticketLeaf = (batch, amountIn, pc) => poseidon4([TAG_TICKET, batch, amountIn, pc]);
