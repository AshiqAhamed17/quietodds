module

public import QuietOdds.Field

/-!
# Theorem 1: a spend cannot create money

Models `circuits/spend/src/main.nr`, lines 50-54:

```rust
assert_u128(amount);
assert_u128(change);
assert_u128(public_amount);
assert_u128(fee);
assert(amount == change + public_amount + fee, "value not conserved");
```

The equality is in the field `ZMod p`. Because every term is range-checked to
128 bits and `3 * 2^128 < p`, the field equation forces the integer equation:
no witness can make `change + public_amount + fee` wrap around `p`.
-/

@[expose] public section

namespace QuietOdds

/-- **Theorem 1.** If the spend circuit's constraints hold, value is conserved
as ordinary natural numbers (not just modulo `p`). -/
theorem spend_conserves_value (amount change pub fee : ZMod p)
    /- main.nr line 50: `assert_u128(amount)` -/
    (hA : amount.val < 2 ^ 128)
    /- main.nr line 51: `assert_u128(change)` -/
    (hC : change.val < 2 ^ 128)
    /- main.nr line 52: `assert_u128(public_amount)` -/
    (hP : pub.val < 2 ^ 128)
    /- main.nr line 53: `assert_u128(fee)` -/
    (hF : fee.val < 2 ^ 128)
    /- main.nr line 54: `assert(amount == change + public_amount + fee)` (field equality) -/
    (hCircuit : amount = change + pub + fee) :
    amount.val = change.val + pub.val + fee.val := by
  have hp := three_mul_two_pow_128_lt_p
  apply eq_of_cast_eq (by omega) (by omega)
  push_cast
  simp only [ZMod.natCast_val, ZMod.cast_id', id]
  exact hCircuit

end QuietOdds

end
