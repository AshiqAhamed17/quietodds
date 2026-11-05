//! Poseidon parity vectors. The same values are produced by poseidon-lite
//! (`scripts/poseidon-parity.mjs`) and asserted in Solidity
//! (`contracts/test/PoseidonParity.t.sol`). If any of the three drift, leaves
//! built on-chain will not match the circuits.

use poseidon::poseidon::bn254;

#[test]
fn hash_2_matches_js_and_solidity() {
    assert(bn254::hash_2([1, 2]) == 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a);
}

#[test]
fn hash_4_matches_js_and_solidity() {
    assert(bn254::hash_4([1, 2, 3, 4]) == 0x299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465);
}

#[test]
fn hash_5_matches_js_and_solidity() {
    assert(bn254::hash_5([1, 2, 3, 4, 5]) == 0x0dab9449e4a1398a15224c0b15a49d598b2174d305a316c918125f8feeb123c0);
}
