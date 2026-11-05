//! redeem: consume a position note (market bet) or a ticket note (batch swap)
//! and mint a hidden balance note worth `floor(x * num / den) - fee`, where `x`
//! is the stake or the amount put into the batch.
//!
//! The contract supplies `num`, `den`, `required_side`, `any_side` and
//! `asset_out` from its own state and rejects anything else:
//!   win    : num = pot - protocolFee, den = winning side total, required_side = winner
//!   refund : num = den = 1, any_side = 1
//!   batch  : num = amountOut, den = totalIn, asset_out = the batch's output asset
//! So a losing position can never produce a valid proof, and the payout
//! amount stays hidden inside `out_commitment`.

use quietodds::merkle::{MERKLE_DEPTH, MerkleProof};
use quietodds::note::{
    assert_u128, assert_u96, balance_leaf, NoteSecrets, position_leaf, TAG_POSITION, TAG_TICKET,
    ticket_leaf,
};

fn main(
    // --- private: the note being redeemed ---
    x: Field, // stake (position) or amountIn (ticket)
    side: Field, // ignored for tickets
    nullifier: Field,
    secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
    // --- private: the payout ---
    payout: Field,
    out_precommitment: Field,
    // --- public ---
    root: pub Field,
    nullifier_hash: pub Field,
    kind: pub Field, // TAG_POSITION or TAG_TICKET
    id: pub Field, // market id or batch id
    required_side: pub Field,
    any_side: pub Field,
    num: pub Field,
    den: pub Field,
    asset_out: pub Field,
    out_commitment: pub Field,
    relayer: pub Field,
    fee: pub Field,
) {
    let secrets = NoteSecrets { nullifier, secret };
    let precommitment = secrets.precommitment();

    // 1. The note exists in the tree, with the claimed kind and id.
    let is_position = kind == TAG_POSITION;
    assert(is_position | (kind == TAG_TICKET), "bad kind");
    let leaf = if is_position {
        position_leaf(id, side, x, precommitment)
    } else {
        ticket_leaf(id, x, precommitment)
    };
    MerkleProof { indices: path_indices, siblings: path_siblings }.assert_member(leaf, root);

    // 2. Its nullifier is the one being burned.
    assert(secrets.nullifier_hash() == nullifier_hash, "bad nullifier hash");

    // 3. Only the winning side can redeem a resolved market.
    assert((any_side == 0) | (any_side == 1), "any_side must be a bit");
    if is_position & (any_side == 0) {
        assert(side == required_side, "losing side");
    }

    // 4. payout = floor(x * num / den), i.e. 0 <= x*num - payout*den < den.
    assert_u96(x);
    assert_u96(num);
    assert_u96(den);
    assert_u96(payout);
    assert(den != 0, "zero denominator");
    let remainder = x * num - payout * den;
    assert_u96(remainder); // >= 0
    assert_u96(den - remainder - 1); // < den

    // 5. The fee comes out of the payout; the rest becomes a hidden balance note.
    let out_amount = payout - fee;
    assert_u128(fee);
    assert_u128(out_amount);
    assert(balance_leaf(asset_out, out_amount, out_precommitment) == out_commitment, "bad out commitment");

    // Bound as a public input only; the contract checks it against msg.sender.
    let _ = relayer;
}

// --- tests -----------------------------------------------------------------
// Worked example from user-flows.md: INDIA 70 vs AUSTRALIA 130, pot 200,
// 1% fee -> 198 distributable. Priya staked 50 on INDIA (side 0).

global USDC: Field = 1;
global STAKE: Field = 50_000_000;
global NUM: Field = 198_000_000;
global DEN: Field = 70_000_000;
global PAYOUT: Field = 141_428_571; // floor(50 * 198 / 70) USDC, 6 decimals
global NULLIFIER: Field = 11;
global SECRET: Field = 22;

fn path() -> ([Field; MERKLE_DEPTH], [Field; MERKLE_DEPTH]) {
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 500;
    }
    let mut indices = [0; MERKLE_DEPTH];
    indices[1] = 1;
    (indices, siblings)
}

fn secrets() -> NoteSecrets {
    NoteSecrets { nullifier: NULLIFIER, secret: SECRET }
}

fn position_root(side: Field) -> Field {
    let (indices, siblings) = path();
    MerkleProof { indices, siblings }.compute_root(position_leaf(1, side, STAKE, secrets().precommitment()))
}

fn ticket_root(amount_in: Field) -> Field {
    let (indices, siblings) = path();
    MerkleProof { indices, siblings }.compute_root(ticket_leaf(12, amount_in, secrets().precommitment()))
}

fn redeem_position(side: Field, required_side: Field, any_side: Field, num: Field, den: Field, payout: Field, fee: Field) {
    let (indices, siblings) = path();
    main(
        STAKE,
        side,
        NULLIFIER,
        SECRET,
        indices,
        siblings,
        payout,
        99,
        position_root(side),
        secrets().nullifier_hash(),
        TAG_POSITION,
        1,
        required_side,
        any_side,
        num,
        den,
        USDC,
        balance_leaf(USDC, payout - fee, 99),
        0xabc,
        fee,
    );
}

#[test]
fn winner_claims_exact_floor_payout() {
    redeem_position(0, 0, 0, NUM, DEN, PAYOUT, 500_000);
}

#[test]
fn refund_any_side_one_to_one() {
    redeem_position(1, 0, 1, 1, 1, STAKE, 0);
}

#[test(should_fail_with = "losing side")]
fn loser_cannot_claim() {
    redeem_position(1, 0, 0, NUM, DEN, PAYOUT, 0);
}

#[test(should_fail)]
fn rejects_inflated_payout() {
    redeem_position(0, 0, 0, NUM, DEN, PAYOUT + 1, 0);
}

#[test(should_fail)]
fn rejects_understated_payout() {
    // payout - 1 leaves a remainder >= den.
    redeem_position(0, 0, 0, NUM, DEN, PAYOUT - 1, 0);
}

#[test(should_fail)]
fn rejects_fee_above_payout() {
    redeem_position(0, 0, 0, NUM, DEN, PAYOUT, PAYOUT + 1);
}

#[test(should_fail_with = "zero denominator")]
fn rejects_zero_denominator() {
    redeem_position(0, 0, 0, 0, 0, 0, 0);
}

#[test]
fn batch_ticket_redeems_pro_rata() {
    // Batch 12: 100 USDC in -> 0.025 WETH out. Ticket of 50 USDC -> 0.0125 WETH.
    let amount_in = 50_000_000;
    let num = 25_000_000_000_000_000;
    let den = 100_000_000;
    let payout = 12_500_000_000_000_000;
    let (indices, siblings) = path();
    main(
        amount_in,
        0,
        NULLIFIER,
        SECRET,
        indices,
        siblings,
        payout,
        99,
        ticket_root(amount_in),
        secrets().nullifier_hash(),
        TAG_TICKET,
        12,
        0,
        0,
        num,
        den,
        2, // WETH
        balance_leaf(2, payout, 99),
        0xabc,
        0,
    );
}

#[test(should_fail_with = "merkle membership proof failed")]
fn ticket_cannot_pose_as_position() {
    // A ticket leaf proven with kind = POSITION hashes to a different leaf.
    let amount_in = STAKE;
    let (indices, siblings) = path();
    main(
        amount_in,
        0,
        NULLIFIER,
        SECRET,
        indices,
        siblings,
        STAKE,
        99,
        ticket_root(amount_in),
        secrets().nullifier_hash(),
        TAG_POSITION,
        12,
        0,
        1,
        1,
        1,
        USDC,
        balance_leaf(USDC, STAKE, 99),
        0xabc,
        0,
    );
}

#[test(should_fail_with = "bad kind")]
fn rejects_unknown_kind() {
    let (indices, siblings) = path();
    main(STAKE, 0, NULLIFIER, SECRET, indices, siblings, STAKE, 99, 0, 0, 1, 1, 0, 1, 1, 1, USDC, 0, 0, 0);
}
