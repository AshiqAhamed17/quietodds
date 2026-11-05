// Builds circuit inputs together with the matching contract arguments, so a
// proof and the call that carries it can never disagree.
import { zeroAddress, type Address, type Hex } from "viem";
import { ACTION, ASSET, MAX_AMOUNT, TAG } from "./constants.ts";
import { encryptNote, type NoteData } from "./backup.ts";
import { toBytes32 } from "./field.ts";
import { deriveNote, type Keys } from "./keys.ts";
import type { MerkleTree } from "./merkle.ts";
import { balanceLeaf } from "./notes.ts";
import type { OwnedNote } from "./wallet.ts";

export type InputMap = Record<string, string | string[]>;

/** ShieldedPool.SpendArgs */
export interface SpendArgs {
  root: bigint;
  nullifierHash: bigint;
  asset: bigint;
  changeCommitment: bigint;
  publicAmount: bigint;
  actionType: bigint;
  actionParam1: bigint;
  actionParam2: bigint;
  outPrecommitment: bigint;
  relayer: Address;
  fee: bigint;
  recipient: Address;
}

/** ShieldedPool.RedeemArgs */
export interface RedeemArgs {
  root: bigint;
  nullifierHash: bigint;
  kind: bigint;
  id: bigint;
  outCommitment: bigint;
  relayer: Address;
  fee: bigint;
}

/** Markets.redeemTerms, the ratio the contract plugs into the redeem proof. */
export interface RedeemTerms {
  num: bigint;
  den: bigint;
  requiredSide: bigint;
  anySide: boolean;
}

export type SpendAction =
  | { type: "withdraw"; recipient: Address }
  | { type: "bet"; market: bigint; side: bigint };

export interface SpendPlan {
  inputs: InputMap;
  args: SpendArgs;
  changeCiphertext: Hex;
  outCiphertext: Hex;
  /** New notes this spend creates; their indices are now used. */
  created: NoteData[];
}

export interface RedeemPlan {
  inputs: InputMap;
  args: RedeemArgs;
  outCiphertext: Hex;
  payout: bigint;
  created: NoteData[];
}

const dec = (v: bigint) => v.toString();
const addr = (a: Address) => BigInt(a);

function pathInputs(tree: MerkleTree, note: OwnedNote) {
  if (tree.leaves[note.leafIndex] !== note.leaf) throw new Error("note not in this tree");
  const path = tree.path(note.leafIndex);
  return {
    root: path.root,
    path_indices: path.indices.map(dec),
    path_siblings: path.siblings.map(dec),
  };
}

/**
 * Spends one balance note: `publicAmount` goes to the action, `fee` to the
 * relayer, and the rest returns as a hidden change note at `changeIndex`.
 * A bet also creates a position note at `changeIndex + 1`.
 */
export async function buildSpend(p: {
  keys: Keys;
  note: OwnedNote;
  tree: MerkleTree;
  publicAmount: bigint;
  fee: bigint;
  relayer: Address;
  action: SpendAction;
  changeIndex: number;
}): Promise<SpendPlan> {
  const { keys, note, tree, publicAmount, fee, action } = p;
  if (note.spent) throw new Error("note already spent");
  if (note.data.kind !== "balance") throw new Error("only balance notes can be spent");
  const { asset, amount } = note.data;
  if (publicAmount < 0n || fee < 0n || publicAmount + fee > amount) throw new Error("amount exceeds note");
  if (publicAmount > MAX_AMOUNT || fee > MAX_AMOUNT) throw new Error("amount too large");
  const change = amount - publicAmount - fee;

  const changeSecrets = deriveNote(keys, p.changeIndex);
  const changeData: NoteData = { kind: "balance", index: p.changeIndex, asset, amount: change };
  const changeCommitment = balanceLeaf(asset, change, changeSecrets.precommitment);
  const created: NoteData[] = [changeData];

  let actionType: bigint, param1 = 0n, param2 = 0n, outPrecommitment = 0n;
  let recipient: Address = zeroAddress;
  let outCiphertext: Hex = "0x";
  if (action.type === "withdraw") {
    if (action.recipient === zeroAddress) throw new Error("withdraw needs a recipient");
    actionType = ACTION.WITHDRAW;
    recipient = action.recipient;
  } else {
    if (asset !== ASSET.USDC) throw new Error("bets are USDC only");
    if (publicAmount === 0n) throw new Error("empty bet");
    actionType = ACTION.BET;
    param1 = action.market;
    param2 = action.side;
    const out = deriveNote(keys, p.changeIndex + 1);
    outPrecommitment = out.precommitment;
    const position: NoteData = {
      kind: "position",
      index: p.changeIndex + 1,
      market: action.market,
      side: action.side,
      stake: publicAmount,
    };
    created.push(position);
    outCiphertext = await encryptNote(keys.viewingKey, position);
  }

  const { root, ...path } = pathInputs(tree, note);
  const args: SpendArgs = {
    root,
    nullifierHash: note.secrets.nullifierHash,
    asset,
    changeCommitment,
    publicAmount,
    actionType,
    actionParam1: param1,
    actionParam2: param2,
    outPrecommitment,
    relayer: p.relayer,
    fee,
    recipient,
  };
  const inputs: InputMap = {
    amount: dec(amount),
    nullifier: dec(note.secrets.nullifier),
    secret: dec(note.secrets.secret),
    ...path,
    change: dec(change),
    change_precommitment: dec(changeSecrets.precommitment),
    ...publicInputMap(SPEND_PUBLIC, spendPublicValues(args)),
  };
  return {
    inputs,
    args,
    changeCiphertext: await encryptNote(keys.viewingKey, changeData),
    outCiphertext,
    created,
  };
}

/**
 * Redeems a position under `terms`: payout = floor(stake * num / den), minus
 * `fee` for the relayer, lands in a hidden USDC note at `outIndex`.
 */
export async function buildRedeem(p: {
  keys: Keys;
  note: OwnedNote;
  tree: MerkleTree;
  terms: RedeemTerms;
  fee: bigint;
  relayer: Address;
  outIndex: number;
}): Promise<RedeemPlan> {
  const { keys, note, tree, terms, fee } = p;
  if (note.spent) throw new Error("note already spent");
  if (note.data.kind !== "position") throw new Error("only positions are redeemable here");
  const { market, side, stake } = note.data;
  if (!terms.anySide && side !== terms.requiredSide) throw new Error("losing side");
  const payout = (stake * terms.num) / terms.den;
  if (fee < 0n || fee > payout) throw new Error("fee exceeds payout");

  const out = deriveNote(keys, p.outIndex);
  const outData: NoteData = { kind: "balance", index: p.outIndex, asset: ASSET.USDC, amount: payout - fee };
  const { root, ...path } = pathInputs(tree, note);
  const args: RedeemArgs = {
    root,
    nullifierHash: note.secrets.nullifierHash,
    kind: TAG.POSITION,
    id: market,
    outCommitment: balanceLeaf(ASSET.USDC, payout - fee, out.precommitment),
    relayer: p.relayer,
    fee,
  };
  const inputs: InputMap = {
    x: dec(stake),
    side: dec(side),
    nullifier: dec(note.secrets.nullifier),
    secret: dec(note.secrets.secret),
    ...path,
    payout: dec(payout),
    out_precommitment: dec(out.precommitment),
    ...publicInputMap(REDEEM_PUBLIC, redeemPublicValues(args, terms, ASSET.USDC)),
  };
  return { inputs, args, outCiphertext: await encryptNote(keys.viewingKey, outData), payout, created: [outData] };
}

// --- public inputs, in circuit order (mirrors ShieldedPool) ----------------

export const SPEND_PUBLIC = [
  "root", "nullifier_hash", "asset", "change_commitment", "public_amount", "action_type",
  "action_param1", "action_param2", "out_precommitment", "relayer", "fee", "recipient",
] as const;

export const REDEEM_PUBLIC = [
  "root", "nullifier_hash", "kind", "id", "required_side", "any_side",
  "num", "den", "asset_out", "out_commitment", "relayer", "fee",
] as const;

export const spendPublicValues = (a: SpendArgs): bigint[] => [
  a.root, a.nullifierHash, a.asset, a.changeCommitment, a.publicAmount, a.actionType,
  a.actionParam1, a.actionParam2, a.outPrecommitment, addr(a.relayer), a.fee, addr(a.recipient),
];

export const redeemPublicValues = (a: RedeemArgs, t: RedeemTerms, assetOut: bigint): bigint[] => [
  a.root, a.nullifierHash, a.kind, a.id, t.requiredSide, t.anySide ? 1n : 0n,
  t.num, t.den, assetOut, a.outCommitment, addr(a.relayer), a.fee,
];

/** The public inputs a verifier checks, as the 32-byte words bb emits. */
export const spendPublicInputs = (a: SpendArgs): Hex[] => spendPublicValues(a).map(toBytes32);
export const redeemPublicInputs = (a: RedeemArgs, t: RedeemTerms, assetOut = ASSET.USDC): Hex[] =>
  redeemPublicValues(a, t, assetOut).map(toBytes32);

function publicInputMap(names: readonly string[], values: bigint[]): InputMap {
  return Object.fromEntries(names.map((n, i) => [n, dec(values[i])]));
}
