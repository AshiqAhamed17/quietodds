//! spend: consume one private balance note and split it into
//!   - a hidden change note (same asset),
//!   - a public amount that the contract routes by `action_type`
//!     (WITHDRAW to `recipient`, BET on a market side, BATCH_JOIN a batch),
//!   - a fee paid to `relayer`.
//!
//! The contract builds the action's output leaf (position / ticket) itself
//! from the public values and `out_precommitment`, so the circuit only has to
//! prove ownership and conservation of value. `action_*`, `out_precommitment`,
//! `relayer`, `fee` and `recipient` are public inputs, so a relayer cannot
//! alter any of them without invalidating the proof.

use quietodds::merkle::{MERKLE_DEPTH, MerkleProof};
use quietodds::note::{assert_u128, balance_leaf, NoteSecrets};

fn main(
    // --- private: the note being spent ---
    amount: Field,
    nullifier: Field,
    secret: Field,
    path_indices: [Field; MERKLE_DEPTH],
    path_siblings: [Field; MERKLE_DEPTH],
    // --- private: the change note ---
    change: Field,
    change_precommitment: Field,
    // --- public ---
    root: pub Field,
    nullifier_hash: pub Field,
    asset: pub Field,
    change_commitment: pub Field,
    public_amount: pub Field,
    action_type: pub Field,
    action_param1: pub Field,
    action_param2: pub Field,
    out_precommitment: pub Field,
    relayer: pub Field,
    fee: pub Field,
    recipient: pub Field,
) {
    let secrets = NoteSecrets { nullifier, secret };

    // 1. The note exists in the tree.
    let leaf = balance_leaf(asset, amount, secrets.precommitment());
    MerkleProof { indices: path_indices, siblings: path_siblings }.assert_member(leaf, root);

    // 2. Its nullifier is the one being burned.
    assert(secrets.nullifier_hash() == nullifier_hash, "bad nullifier hash");

    // 3. Value is conserved, with no field wraparound.
    assert_u128(amount);
    assert_u128(change);
    assert_u128(public_amount);
    assert_u128(fee);
    assert(amount == change + public_amount + fee, "value not conserved");

    // 4. The change note is well formed.
    assert(balance_leaf(asset, change, change_precommitment) == change_commitment, "bad change commitment");

    // Bound as public inputs only; the contract interprets them.
    let _ = (action_type, action_param1, action_param2, out_precommitment, relayer, recipient);
}

// --- tests -----------------------------------------------------------------

global ASSET: Field = 1;
global AMOUNT: Field = 100_000_000; // 100 USDC (6 decimals)
global NULLIFIER: Field = 11;
global SECRET: Field = 22;

fn path() -> ([Field; MERKLE_DEPTH], [Field; MERKLE_DEPTH]) {
    let mut siblings = [0; MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        siblings[i] = (i as Field) + 1000;
    }
    let mut indices = [0; MERKLE_DEPTH];
    indices[0] = 1;
    indices[3] = 1;
    (indices, siblings)
}

fn root_for(amount: Field) -> Field {
    let (indices, siblings) = path();
    let s = NoteSecrets { nullifier: NULLIFIER, secret: SECRET };
    MerkleProof { indices, siblings }.compute_root(balance_leaf(ASSET, amount, s.precommitment()))
}

fn nullifier_hash() -> Field {
    NoteSecrets { nullifier: NULLIFIER, secret: SECRET }.nullifier_hash()
}

/// Bet 50 USDC, pay a 1 USDC fee, keep 49 USDC as change.
fn run(amount_claimed: Field, change: Field, public_amount: Field, fee: Field, root: Field, nh: Field, change_pc: Field) {
    let (indices, siblings) = path();
    main(
        amount_claimed,
        NULLIFIER,
        SECRET,
        indices,
        siblings,
        change,
        change_pc,
        root,
        nh,
        ASSET,
        balance_leaf(ASSET, change, 77),
        public_amount,
        2, // BET
        1, // market 1
        0, // side 0
        88,
        0xabc,
        fee,
        0,
    );
}

#[test]
fn valid_bet_spend() {
    run(AMOUNT, 49_000_000, 50_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash(), 77);
}

#[test]
fn full_withdraw_zero_change() {
    run(AMOUNT, 0, 99_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash(), 77);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn rejects_note_not_in_tree() {
    run(AMOUNT, 49_000_000, 50_000_000, 1_000_000, root_for(AMOUNT) + 1, nullifier_hash(), 77);
}

#[test(should_fail_with = "merkle membership proof failed")]
fn rejects_inflated_note_amount() {
    // Claiming the note holds more than it does changes the leaf.
    run(AMOUNT * 2, 149_000_000, 50_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash(), 77);
}

#[test(should_fail_with = "bad nullifier hash")]
fn rejects_wrong_nullifier_hash() {
    run(AMOUNT, 49_000_000, 50_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash() + 1, 77);
}

#[test(should_fail_with = "value not conserved")]
fn rejects_value_creation() {
    run(AMOUNT, 50_000_000, 50_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash(), 77);
}

#[test(should_fail)]
fn rejects_negative_change_wraparound() {
    // change = -1 in the field would "balance" a too-large public amount.
    run(AMOUNT, -1, 100_000_001, 0, root_for(AMOUNT), nullifier_hash(), 77);
}

#[test(should_fail_with = "bad change commitment")]
fn rejects_mismatched_change_commitment() {
    run(AMOUNT, 49_000_000, 50_000_000, 1_000_000, root_for(AMOUNT), nullifier_hash(), 78);
}
