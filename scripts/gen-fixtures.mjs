// Generates real proof fixtures for the Foundry tests. The fixtures follow one
// story, in the exact order ShieldedPool inserts leaves, so every proof's root
// is a root the on-chain tree really reaches in the test:
//
//   leaf 0  Priya deposits 100 USDC
//   leaf 1  Priya bets 50 on market 1 side 0  -> change 49   (bet_priya)
//   leaf 2                                      -> position 50
//   leaf 3  Arjun deposits 100 USDC
//   leaf 4  Arjun bets 80 on market 1 side 1  -> change 19   (bet_arjun)
//   leaf 5                                      -> position 80
//   -- market 1 resolves to side 0: pot 130, fee 1.3, num 128.7, den 50 --
//   leaf 6  Priya redeems her position -> 128.7 - 0.5 fee    (redeem_priya_win)
//   leaf 7  Priya withdraws 48 of her change to 0xcafe       (withdraw_priya)
//   -- alternative branch: market 1 cancelled after leaf 5 --
//           Arjun redeems his position 1:1 as a refund       (redeem_arjun_refund)
//
// Output: contracts/test/fixtures/<name>.json  { proof, publicInputs, ctx }
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { merklePath } from "./lib/merkle.mjs";
import {
  ACTION, ASSET, TAG_POSITION, balanceLeaf, nullifierHash, positionLeaf, precommitment,
} from "./lib/notes.mjs";
import { prove } from "./lib/prove.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../contracts/test/fixtures");
mkdirSync(OUT, { recursive: true });

const hex = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
const USDC = (n) => BigInt(Math.round(n * 1e6));
export const RELAYER = 0xbeefn;
export const RECIPIENT = 0xcafen;
const MARKET = 1n;

function save(name, result, ctx) {
  const ctxHex = Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, hex(v)]));
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ ...result, ctx: ctxHex }, null, 2) + "\n");
  console.log(`wrote ${name}.json`);
}

const note = (nullifier, secret) => ({ nullifier, secret, pc: precommitment(nullifier, secret) });

function spendProof(name, leaves, { index, amount, owner, change, changeNote, publicAmount, action, p1, p2, outPc, fee, recipient }) {
  const path = merklePath(leaves, index);
  const witness = {
    amount, nullifier: owner.nullifier, secret: owner.secret,
    path_indices: path.indices, path_siblings: path.siblings,
    change, change_precommitment: changeNote.pc,
    root: path.root,
    nullifier_hash: nullifierHash(owner.nullifier),
    asset: ASSET.USDC,
    change_commitment: balanceLeaf(ASSET.USDC, change, changeNote.pc),
    public_amount: publicAmount,
    action_type: action, action_param1: p1, action_param2: p2,
    out_precommitment: outPc,
    relayer: RELAYER, fee, recipient,
  };
  save(name, prove("spend", witness, name), {
    changeCommitment: witness.change_commitment,
    outPrecommitment: outPc,
  });
  return witness.change_commitment;
}

function redeemProof(name, leaves, { index, stake, side, owner, num, den, anySide, requiredSide, outNote, fee }) {
  const path = merklePath(leaves, index);
  const payout = (stake * num) / den;
  const outCommitment = balanceLeaf(ASSET.USDC, payout - fee, outNote.pc);
  const witness = {
    x: stake, side, nullifier: owner.nullifier, secret: owner.secret,
    path_indices: path.indices, path_siblings: path.siblings,
    payout, out_precommitment: outNote.pc,
    root: path.root,
    nullifier_hash: nullifierHash(owner.nullifier),
    kind: TAG_POSITION, id: MARKET,
    required_side: requiredSide, any_side: anySide,
    num, den,
    asset_out: ASSET.USDC,
    out_commitment: outCommitment,
    relayer: RELAYER, fee,
  };
  save(name, prove("redeem", witness, name), { payout, outCommitment });
  return outCommitment;
}

// Notes (nullifier, secret). In the app these come from the user's spending key.
const priyaDeposit = note(101n, 202n);
const priyaChange = note(111n, 222n);
const priyaPosition = note(121n, 232n);
const priyaWinnings = note(131n, 242n);
const priyaChange2 = note(141n, 252n);
const arjunDeposit = note(301n, 402n);
const arjunChange = note(311n, 422n);
const arjunPosition = note(321n, 432n);
const arjunRefund = note(331n, 442n);

const leaves = [];

// leaf 0: Priya deposits 100
leaves.push(balanceLeaf(ASSET.USDC, USDC(100), priyaDeposit.pc));

// leaves 1-2: Priya bets 50 on side 0
leaves.push(spendProof("bet_priya", leaves, {
  index: 0, amount: USDC(100), owner: priyaDeposit,
  change: USDC(49), changeNote: priyaChange,
  publicAmount: USDC(50), action: ACTION.BET, p1: MARKET, p2: 0n, outPc: priyaPosition.pc,
  fee: USDC(1), recipient: 0n,
}));
leaves.push(positionLeaf(MARKET, 0n, USDC(50), priyaPosition.pc));

// leaf 3: Arjun deposits 100
leaves.push(balanceLeaf(ASSET.USDC, USDC(100), arjunDeposit.pc));

// leaves 4-5: Arjun bets 80 on side 1
leaves.push(spendProof("bet_arjun", leaves, {
  index: 3, amount: USDC(100), owner: arjunDeposit,
  change: USDC(19), changeNote: arjunChange,
  publicAmount: USDC(80), action: ACTION.BET, p1: MARKET, p2: 1n, outPc: arjunPosition.pc,
  fee: USDC(1), recipient: 0n,
}));
leaves.push(positionLeaf(MARKET, 1n, USDC(80), arjunPosition.pc));

// Branch B (cancelled market) from the 6-leaf tree: Arjun's refund.
redeemProof("redeem_arjun_refund", leaves, {
  index: 5, stake: USDC(80), side: 1n, owner: arjunPosition,
  num: 1n, den: 1n, anySide: 1n, requiredSide: 0n, outNote: arjunRefund, fee: USDC(0.5),
});

// Branch A: side 0 wins. pot 130, fee 1% = 1.3 -> num 128.7, den 50.
leaves.push(redeemProof("redeem_priya_win", leaves, {
  index: 2, stake: USDC(50), side: 0n, owner: priyaPosition,
  num: USDC(128.7), den: USDC(50), anySide: 0n, requiredSide: 0n, outNote: priyaWinnings, fee: USDC(0.5),
}));

// leaf 7: Priya withdraws 48 of her 49 change to RECIPIENT, 1 USDC fee.
leaves.push(spendProof("withdraw_priya", leaves, {
  index: 1, amount: USDC(49), owner: priyaChange,
  change: 0n, changeNote: priyaChange2,
  publicAmount: USDC(48), action: ACTION.WITHDRAW, p1: 0n, p2: 0n, outPc: 0n,
  fee: USDC(1), recipient: RECIPIENT,
}));

// Deposit precommitments the tests need to rebuild leaves 0 and 3.
writeFileSync(join(OUT, "story.json"), JSON.stringify({
  priyaDepositPrecommitment: hex(priyaDeposit.pc),
  arjunDepositPrecommitment: hex(arjunDeposit.pc),
  leaves: leaves.map(hex),
}, null, 2) + "\n");
console.log("wrote story.json");
