//! Notes: every private holding in QuietOdds is a leaf in one on-chain
//! Poseidon Merkle tree. Leaves are domain-tagged so a balance can never be
//! passed off as a position or a batch ticket.
//!
//!   precommitment = H(nullifier, secret)
//!   balance leaf  = H(TAG_BALANCE,  asset,   amount,   precommitment)
//!   position leaf = H(TAG_POSITION, market,  side,     stake, precommitment)
//!   ticket leaf   = H(TAG_TICKET,   batch,   amountIn, precommitment)
//!   nullifierHash = H(nullifier, TAG_NULLIFIER)
//!
//! The contract builds leaves itself from public values plus a user-supplied
//! precommitment, so it never has to trust a client-built leaf.

use poseidon::poseidon::bn254;

pub global TAG_BALANCE: Field = 1;
pub global TAG_POSITION: Field = 2;
pub global TAG_TICKET: Field = 3;
pub global TAG_NULLIFIER: Field = 9;

/// The two secrets behind every note. Derived deterministically from the
/// user's spending key in the app, so notes can be recovered.
pub struct NoteSecrets {
    pub nullifier: Field,
    pub secret: Field,
}

impl NoteSecrets {
    pub fn precommitment(self) -> Field {
        bn254::hash_2([self.nullifier, self.secret])
    }

    /// Revealed when the note is spent. Unlinkable to the leaf without the
    /// nullifier itself.
    pub fn nullifier_hash(self) -> Field {
        bn254::hash_2([self.nullifier, TAG_NULLIFIER])
    }
}

pub fn balance_leaf(asset: Field, amount: Field, precommitment: Field) -> Field {
    bn254::hash_4([TAG_BALANCE, asset, amount, precommitment])
}

pub fn position_leaf(market: Field, side: Field, stake: Field, precommitment: Field) -> Field {
    bn254::hash_5([TAG_POSITION, market, side, stake, precommitment])
}

pub fn ticket_leaf(batch: Field, amount_in: Field, precommitment: Field) -> Field {
    bn254::hash_4([TAG_TICKET, batch, amount_in, precommitment])
}

/// Every amount is range-checked to 128 bits so sums and products can never
/// wrap around the field.
pub fn assert_u128(x: Field) {
    x.assert_max_bit_size::<128>();
}

/// Amounts and ratio terms in `redeem` are capped at 96 bits, so products
/// like `stake * num` stay far below the field modulus (< 2^192).
pub fn assert_u96(x: Field) {
    x.assert_max_bit_size::<96>();
}

// --- tests -----------------------------------------------------------------

#[test]
fn leaves_are_domain_separated() {
    // Same fields, different tag -> different leaf.
    let b = balance_leaf(1, 50, 7);
    let t = ticket_leaf(1, 50, 7);
    assert(b != t);
}

#[test]
fn balance_leaf_binds_every_field() {
    let base = balance_leaf(1, 50, 7);
    assert(base != balance_leaf(2, 50, 7));
    assert(base != balance_leaf(1, 51, 7));
    assert(base != balance_leaf(1, 50, 8));
}

#[test]
fn position_leaf_binds_every_field() {
    let base = position_leaf(1, 0, 50, 7);
    assert(base != position_leaf(2, 0, 50, 7));
    assert(base != position_leaf(1, 1, 50, 7));
    assert(base != position_leaf(1, 0, 51, 7));
    assert(base != position_leaf(1, 0, 50, 8));
}

#[test]
fn nullifier_hash_is_not_the_precommitment() {
    let s = NoteSecrets { nullifier: 11, secret: 22 };
    assert(s.nullifier_hash() != s.precommitment());
}

#[test]
fn nullifier_hash_ignores_secret() {
    // Two notes sharing a nullifier collide, so a nullifier can only be spent once.
    let a = NoteSecrets { nullifier: 11, secret: 22 };
    let b = NoteSecrets { nullifier: 11, secret: 33 };
    assert(a.nullifier_hash() == b.nullifier_hash());
}

#[test]
fn u128_accepts_max() {
    assert_u128(0xffffffffffffffffffffffffffffffff);
}

#[test(should_fail)]
fn u128_rejects_overflow() {
    assert_u128(0x100000000000000000000000000000000);
}
