module

public import QuietOdds.Field

/-!
# Theorem 2: the redeem payout is exactly the rounded-down share

Models `circuits/redeem/src/main.nr`, lines 66-80:

```rust
// 4. payout = floor(x * num / den), i.e. 0 <= x*num - payout*den < den.
assert_u96(x);                         // line 67
assert_u96(num);                       // line 68
assert_u96(den);                       // line 69
assert_u96(payout);                    // line 70
assert(den != 0, "zero denominator");  // line 71
let remainder = x * num - payout * den;// line 72
assert_u96(remainder); // >= 0         // line 73
assert_u96(den - remainder - 1); // < den  line 74

// 5. The fee comes out of the payout; the rest becomes a hidden balance note.
let out_amount = payout - fee;         // line 77
assert_u128(fee);                      // line 78
assert_u128(out_amount);               // line 79
```

Every operation is in the field `ZMod p`. The circuit cannot divide, so the
prover supplies `payout` and the circuit checks the division-with-remainder
equation. We prove those field constraints pin `payout` to
`⌊x * num / den⌋` over the naturals.
-/

@[expose] public section

namespace QuietOdds

/-- If the range-checked remainder is at least `den`, then `den - r - 1` wraps
around to a value near `p`, which fails the 96-bit check. -/
lemma rem_lt_den {D R : ℕ} (hD : D < 2 ^ 96) (hR : R < 2 ^ 96)
    (hLess : ((D : ZMod p) - (R : ZMod p) - 1).val < 2 ^ 96) : R < D := by
  by_contra hlt
  have hge : D ≤ R := Nat.le_of_not_lt hlt
  obtain ⟨k, hk⟩ : ∃ k, R + 1 = D + k := Nat.exists_eq_add_of_le (Nat.le_succ_of_le hge)
  -- hk : R + 1 = D + k, so `k ≥ 1` and `k ≤ 2^96`
  set v := ((D : ZMod p) - (R : ZMod p) - 1).val with hv
  have hcast : ((v + k : ℕ) : ZMod p) = ((0 : ℕ) : ZMod p) := by
    have hk' : ((R : ℕ) : ZMod p) + 1 = (D : ZMod p) + (k : ZMod p) := by
      have h := congrArg (Nat.cast : ℕ → ZMod p) hk
      push_cast at h
      exact h
    push_cast
    rw [hv, ZMod.natCast_val, ZMod.cast_id', id]
    linear_combination -hk'
  have hp := two_pow_194_lt_p
  have h0 := eq_of_cast_eq (by omega) (by omega) hcast
  omega

/-- **Theorem 2.** If the redeem circuit's division constraints hold, the
claimed payout is exactly `⌊x * num / den⌋` and the remainder is exactly
`x * num mod den`, as natural numbers. -/
theorem redeem_payout_exact (x num den payout : ZMod p)
    /- main.nr line 67: `assert_u96(x)` -/
    (hx : x.val < 2 ^ 96)
    /- main.nr line 68: `assert_u96(num)` -/
    (hn : num.val < 2 ^ 96)
    /- main.nr line 69: `assert_u96(den)` -/
    (hd : den.val < 2 ^ 96)
    /- main.nr line 70: `assert_u96(payout)` -/
    (hpay : payout.val < 2 ^ 96)
    /- main.nr line 71: `assert(den != 0)` -/
    (hd0 : den ≠ 0)
    /- main.nr lines 72-73: `remainder = x * num - payout * den; assert_u96(remainder)` -/
    (hr : (x * num - payout * den).val < 2 ^ 96)
    /- main.nr line 74: `assert_u96(den - remainder - 1)` -/
    (hLess : (den - (x * num - payout * den) - 1).val < 2 ^ 96) :
    payout.val = x.val * num.val / den.val ∧
      (x * num - payout * den).val = x.val * num.val % den.val := by
  set r := x * num - payout * den with hrdef
  have hp := two_pow_194_lt_p
  have hDpos : 0 < den.val := by
    rcases Nat.eq_zero_or_pos den.val with h | h
    · exact absurd ((ZMod.val_eq_zero den).mp h) hd0
    · exact h
  -- No product wraps: both sides of `x*num = payout*den + r` are below `p`.
  have hXN : x.val * num.val < 2 ^ 192 := by
    calc x.val * num.val < 2 ^ 96 * 2 ^ 96 := Nat.mul_lt_mul'' hx hn
      _ = 2 ^ 192 := by norm_num
  have hPD : payout.val * den.val < 2 ^ 192 := by
    calc payout.val * den.val < 2 ^ 96 * 2 ^ 96 := Nat.mul_lt_mul'' hpay hd
      _ = 2 ^ 192 := by norm_num
  -- The field remainder is the real remainder: `x*num = payout*den + r` in ℕ.
  have hEq : x.val * num.val = payout.val * den.val + r.val := by
    apply eq_of_cast_eq (by omega) (by omega)
    push_cast
    simp only [ZMod.natCast_val, ZMod.cast_id', id]
    rw [hrdef]
    ring
  -- The remainder is below `den`.
  have hRD : r.val < den.val := by
    apply rem_lt_den hd hr
    simp only [ZMod.natCast_val, ZMod.cast_id', id]
    exact hLess
  -- Uniqueness of division with remainder.
  have hform : x.val * num.val = r.val + den.val * payout.val := by rw [hEq]; ring
  refine ⟨?_, ?_⟩
  · rw [hform, Nat.add_mul_div_left _ _ hDpos, Nat.div_eq_of_lt hRD, zero_add]
  · rw [hform, Nat.add_mul_mod_self_left, Nat.mod_eq_of_lt hRD]

/-- **Theorem 2 (fee extension).** `out_amount = payout - fee` with both `fee`
and `out_amount` range-checked to 128 bits forces `fee ≤ payout` and
`out_amount = payout - fee` over the naturals (no wraparound). -/
theorem redeem_fee_sound (payout fee : ZMod p)
    /- main.nr line 70: `assert_u96(payout)` -/
    (hpay : payout.val < 2 ^ 96)
    /- main.nr line 78: `assert_u128(fee)` -/
    (hF : fee.val < 2 ^ 128)
    /- main.nr lines 77, 79: `out_amount = payout - fee; assert_u128(out_amount)` -/
    (hOut : (payout - fee).val < 2 ^ 128) :
    fee.val ≤ payout.val ∧ (payout - fee).val = payout.val - fee.val := by
  have hp := three_mul_two_pow_128_lt_p
  have hsum : (payout - fee).val + fee.val = payout.val := by
    apply eq_of_cast_eq (by omega) (by omega)
    push_cast
    simp only [ZMod.natCast_val, ZMod.cast_id', id]
    ring
  omega

end QuietOdds

end
