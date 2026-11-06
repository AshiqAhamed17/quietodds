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
// The batch story (`node gen-fixtures.mjs batch`) starts from a fresh pool whose
// BatchSwapper opened batch 1 (USDC->WETH) and batch 2 (WETH->USDC):
//
//   leaf 0  Priya deposits 100 USDC
//   leaf 1  Priya joins batch 1 with 50  -> change 49.5        (join_priya)
//   leaf 2                                -> ticket 50
//   leaf 3  Rahul deposits 100 USDC
//   leaf 4  Rahul joins batch 1 with 30  -> change 69.5        (join_rahul)
//   leaf 5                                -> ticket 30
//   leaf 6  Arjun deposits 0.02 WETH
//   leaf 7  Arjun joins batch 2 with 0.02, no fee -> change 0  (join_arjun_weth)
//   leaf 8                                -> ticket 0.02
//   -- both batches execute in one block (BatchSwapper.t.sol setup):
//      batch 1: 80 USDC -> BATCH1_OUT wei, batch 2: 0.02 WETH -> BATCH2_OUT USDC --
//   leaf 9  Priya redeems her ticket: 50/80 of BATCH1_OUT WETH  (redeem_ticket_priya)
//   leaf 10 Rahul redeems his ticket: 30/80 of BATCH1_OUT WETH  (redeem_ticket_rahul)
//   leaf 11 Arjun redeems his ticket: all of BATCH2_OUT USDC    (redeem_ticket_arjun)
//   -- alternative branch: batch 1 cancelled after leaf 8 --
//           Priya's ticket refunds 50 USDC 1:1                 (redeem_ticket_priya_refund)
//
// BATCH1_OUT/BATCH2_OUT are what the test pool returns. If the test pool or
// the hook changes, BatchSwapper.t.sol fails loudly; re-measure and regenerate.
// Output: contracts/test/fixtures/<name>.json  { proof, publicInputs, ctx }
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { merklePath } from "./lib/merkle.mjs";
import {
  ACTION, ASSET, TAG_POSITION, TAG_TICKET, balanceLeaf, nullifierHash, positionLeaf, precommitment, ticketLeaf,
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

function spendProof(name, leaves, { asset = ASSET.USDC, index, amount, owner, change, changeNote, publicAmount, action, p1, p2, outPc, fee, recipient }) {
  const path = merklePath(leaves, index);
  const witness = {
    amount, nullifier: owner.nullifier, secret: owner.secret,
    path_indices: path.indices, path_siblings: path.siblings,
    change, change_precommitment: changeNote.pc,
    root: path.root,
    nullifier_hash: nullifierHash(owner.nullifier),
    asset,
    change_commitment: balanceLeaf(asset, change, changeNote.pc),
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

function coreStory() {
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
}

const BATCH1_OUT = 39864101712921613n;
const BATCH2_OUT = 39903855n;

function ticketRedeemProof(name, leaves, { index, batch, amountIn, owner, num, den, assetOut, outNote, fee }) {
  const path = merklePath(leaves, index);
  const payout = (amountIn * num) / den;
  const outCommitment = balanceLeaf(assetOut, payout - fee, outNote.pc);
  const witness = {
    x: amountIn, side: 0n, nullifier: owner.nullifier, secret: owner.secret,
    path_indices: path.indices, path_siblings: path.siblings,
    payout, out_precommitment: outNote.pc,
    root: path.root,
    nullifier_hash: nullifierHash(owner.nullifier),
    kind: TAG_TICKET, id: batch,
    required_side: 0n, any_side: 1n, // tickets carry no side
    num, den,
    asset_out: assetOut,
    out_commitment: outCommitment,
    relayer: RELAYER, fee,
  };
  save(name, prove("redeem", witness, name), { payout, outCommitment });
  return outCommitment;
}

function batchStory() {
  const BATCH_USDC = 1n; // USDC -> WETH
  const BATCH_WETH = 2n; // WETH -> USDC
  const priya = note(501n, 602n), priyaChange = note(511n, 612n), priyaTicket = note(521n, 622n);
  const rahul = note(701n, 802n), rahulChange = note(711n, 812n), rahulTicket = note(721n, 822n);
  const arjun = note(901n, 1002n), arjunChange = note(911n, 1012n), arjunTicket = note(921n, 1022n);
  const WETH = 2n * 10n ** 16n; // 0.02
  const leaves = [];

  leaves.push(balanceLeaf(ASSET.USDC, USDC(100), priya.pc));
  leaves.push(spendProof("join_priya", leaves, {
    index: 0, amount: USDC(100), owner: priya, change: USDC(49.5), changeNote: priyaChange,
    publicAmount: USDC(50), action: ACTION.BATCH_JOIN, p1: BATCH_USDC, p2: 0n, outPc: priyaTicket.pc,
    fee: USDC(0.5), recipient: 0n,
  }));
  leaves.push(ticketLeaf(BATCH_USDC, USDC(50), priyaTicket.pc));

  leaves.push(balanceLeaf(ASSET.USDC, USDC(100), rahul.pc));
  leaves.push(spendProof("join_rahul", leaves, {
    index: 3, amount: USDC(100), owner: rahul, change: USDC(69.5), changeNote: rahulChange,
    publicAmount: USDC(30), action: ACTION.BATCH_JOIN, p1: BATCH_USDC, p2: 0n, outPc: rahulTicket.pc,
    fee: USDC(0.5), recipient: 0n,
  }));
  leaves.push(ticketLeaf(BATCH_USDC, USDC(30), rahulTicket.pc));

  leaves.push(balanceLeaf(ASSET.WETH, WETH, arjun.pc));
  leaves.push(spendProof("join_arjun_weth", leaves, {
    asset: ASSET.WETH, index: 6, amount: WETH, owner: arjun, change: 0n, changeNote: arjunChange,
    publicAmount: WETH, action: ACTION.BATCH_JOIN, p1: BATCH_WETH, p2: 0n, outPc: arjunTicket.pc,
    fee: 0n, recipient: 0n,
  }));
  leaves.push(ticketLeaf(BATCH_WETH, WETH, arjunTicket.pc));

  // Branch B (batch 1 cancelled) from the 9-leaf tree: Priya's refund.
  ticketRedeemProof("redeem_ticket_priya_refund", leaves, {
    index: 2, batch: BATCH_USDC, amountIn: USDC(50), owner: priyaTicket,
    num: 1n, den: 1n, assetOut: ASSET.USDC, outNote: note(531n, 632n), fee: USDC(0.5),
  });

  // Branch A: both batches executed.
  leaves.push(ticketRedeemProof("redeem_ticket_priya", leaves, {
    index: 2, batch: BATCH_USDC, amountIn: USDC(50), owner: priyaTicket,
    num: BATCH1_OUT, den: USDC(80), assetOut: ASSET.WETH, outNote: note(541n, 642n), fee: 10n ** 13n,
  }));
  leaves.push(ticketRedeemProof("redeem_ticket_rahul", leaves, {
    index: 5, batch: BATCH_USDC, amountIn: USDC(30), owner: rahulTicket,
    num: BATCH1_OUT, den: USDC(80), assetOut: ASSET.WETH, outNote: note(741n, 842n), fee: 0n,
  }));
  leaves.push(ticketRedeemProof("redeem_ticket_arjun", leaves, {
    index: 8, batch: BATCH_WETH, amountIn: WETH, owner: arjunTicket,
    num: BATCH2_OUT, den: WETH, assetOut: ASSET.USDC, outNote: note(941n, 1042n), fee: USDC(0.05),
  }));

  writeFileSync(join(OUT, "batch_story.json"), JSON.stringify({
    batch1Out: hex(BATCH1_OUT),
    batch2Out: hex(BATCH2_OUT),
    priyaDepositPrecommitment: hex(priya.pc),
    rahulDepositPrecommitment: hex(rahul.pc),
    arjunDepositPrecommitment: hex(arjun.pc),
    leaves: leaves.map(hex),
  }, null, 2) + "\n");
  console.log("wrote batch_story.json");
}

const story = process.argv[2] ?? "core";
if (story === "core") coreStory();
else if (story === "batch") batchStory();
else throw new Error(`unknown story ${story}`);
