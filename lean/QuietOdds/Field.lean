module

public import Mathlib

/-!
# The BN254 scalar field

Noir's `Field` type is arithmetic modulo the BN254 scalar-field prime `p`.
We model it as `ZMod p`. None of the theorems in this project need `p` to be
prime: only its *size* matters (it is far above `2^194`).

`assert_uN(v)` in the circuits (`x.assert_max_bit_size::<N>()`) checks that the
canonical representative of `v` in `[0, p)` is below `2^N`. In Lean that is
`v.val < 2^N`.
-/

@[expose] public section

namespace QuietOdds

/-- The BN254 scalar field modulus: Noir's `Field`. -/
def p : ℕ :=
  21888242871839275222246405745257275088548364400416034343698204186575808495617

lemma one_lt_p : 1 < p := by norm_num [p]

instance : Fact (1 < p) := ⟨one_lt_p⟩

instance : NeZero p := ⟨by norm_num [p]⟩

/-- `p` is comfortably larger than every intermediate quantity we use. -/
lemma two_pow_194_lt_p : 2 ^ 194 < p := by norm_num [p]

lemma two_pow_128_lt_p : 2 ^ 128 < p := by norm_num [p]

lemma three_mul_two_pow_128_lt_p : 3 * 2 ^ 128 < p := by norm_num [p]

/-- Two naturals below `p` that agree in `ZMod p` are equal. -/
lemma eq_of_cast_eq {a b : ℕ} (ha : a < p) (hb : b < p)
    (h : (a : ZMod p) = (b : ZMod p)) : a = b := by
  have := congrArg ZMod.val h
  rwa [ZMod.val_natCast, ZMod.val_natCast, Nat.mod_eq_of_lt ha,
    Nat.mod_eq_of_lt hb] at this

/-- The canonical representative of a field element is below `p`. -/
lemma val_lt_p (a : ZMod p) : a.val < p := ZMod.val_lt a

/-- Every field element is the cast of its canonical representative. -/
lemma cast_val (a : ZMod p) : ((a.val : ℕ) : ZMod p) = a := ZMod.natCast_zmod_val a

end QuietOdds

end
