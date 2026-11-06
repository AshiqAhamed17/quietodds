module

public import Mathlib

/-!
# Theorem 4: the directional fee makes sandwiches unprofitable

Models the fee rule of `QuietOddsHook.directionalFee`
(`contracts/src/QuietOddsHook.sol`, lines 205-221): a swap that pushes the
price back toward the block-start price `P₀` pays `base + (P₂ - P₀)/P₀`
(capped at 50%), where `P₂` is the current price.

We work over `ℝ` and use only one property of any AMM: price is monotone along
a trade (buying pushes it up, selling pushes it down). An attacker who
front-runs by buying `q` units at prices `≥ P₀` pays at least `q * P₀`; the
back-run sells `q` units, a fraction `f` is taken as fee, and every unit sells
at `≤ P₂`, so revenue is at most `q * (1 - f) * P₂`. These two bounds are taken
as hypotheses (`hCost`, `hRev`); deriving them from `x * y = k` is not done here.

## Honest limits

1. **The 50% cap.** The contract caps the fee at `MAX_REVERSAL_FEE` (50%). If a
   single block moves the price by more than 2x, the capped fee is below the
   move and the guarantee fails. `capped_fee_counterexample` proves this
   concretely: the theorem below does *not* cover the capped contract in that
   regime.
2. **Buying below `P₀`.** We assume the front-run buys at prices `≥ P₀`. If
   someone else pushed the price down earlier in the block, an attacker could
   buy below `P₀`. That front-run is itself a reversal and pays the directional
   fee, but that case is not proved.
3. **Multi-block sandwiches.** The snapshot resets each block; a builder
   controlling consecutive blocks can spread an attack across them.
4. **Model vs. Solidity.** This is a statement about the fee rule over the
   reals. Integer rounding (pips), the `sqrtPriceX96` encoding, the
   start-of-block snapshot mechanics and the BatchSwapper exemption are
   outside the model. The Solidity measures the move relative to the lower
   price; for an upward move that is exactly `(P₂ - P₀)/P₀` as used here.
-/

@[expose] public section

namespace QuietOdds

/-- **Theorem 4.** If the back-run pays a fee `f ≥ (P₂ - P₀)/P₀`, the sandwich
(front-run cost vs back-run revenue) is not profitable. -/
theorem sandwich_unprofitable (q P₀ P₂ cost revenue f : ℝ)
    (hq : 0 ≤ q) (hP₀ : 0 < P₀) (hup : P₀ ≤ P₂)
    /- every unit of the front-run is bought at a price `≥ P₀` -/
    (hCost : q * P₀ ≤ cost)
    /- every unit of the back-run sells at a price `≤ P₂`, after the fee -/
    (hRev : revenue ≤ q * (1 - f) * P₂)
    (hFee : (P₂ - P₀) / P₀ ≤ f)
    /- `f ≤ 1` (kept to match the paper statement; the proof does not need it) -/
    (_hf1 : f ≤ 1) :
    revenue - cost ≤ 0 := by
  have hfP : P₂ - P₀ ≤ f * P₀ := by
    rwa [div_le_iff₀ hP₀] at hFee
  have hf0 : 0 ≤ f := le_trans (div_nonneg (by linarith) hP₀.le) hFee
  -- (1 - f) * P₂ ≤ P₀
  have hkey : (1 - f) * P₂ ≤ P₀ := by nlinarith
  have : q * (1 - f) * P₂ ≤ q * P₀ := by
    rw [mul_assoc]; exact mul_le_mul_of_nonneg_left hkey hq
  linarith

/-- The uncapped fee rule `f = base + (P₂ - P₀)/P₀` with `base ≥ 0` meets the
fee hypothesis of `sandwich_unprofitable`. -/
lemma fee_rule_sufficient (base P₀ P₂ : ℝ) (hbase : 0 ≤ base) :
    (P₂ - P₀) / P₀ ≤ base + (P₂ - P₀) / P₀ := by linarith

/-- **Theorem 4, for our fee rule** (uncapped, i.e. while `f ≤ 1`). -/
theorem sandwich_unprofitable_fee_rule (q P₀ P₂ cost revenue base : ℝ)
    (hq : 0 ≤ q) (hP₀ : 0 < P₀) (hup : P₀ ≤ P₂) (hbase : 0 ≤ base)
    (hCost : q * P₀ ≤ cost)
    (hRev : revenue ≤ q * (1 - (base + (P₂ - P₀) / P₀)) * P₂)
    (hf1 : base + (P₂ - P₀) / P₀ ≤ 1) :
    revenue - cost ≤ 0 :=
  sandwich_unprofitable q P₀ P₂ cost revenue _ hq hP₀ hup hCost hRev
    (fee_rule_sufficient base P₀ P₂ hbase) hf1

/-- **The cap is a real limit.** With the fee capped at 1/2, whenever the price
more than doubles within the block (`P₂ > 2 * P₀`), an attacker meeting the
cost/revenue bounds with equality makes a strictly positive profit. -/
theorem capped_fee_counterexample (q P₀ P₂ base : ℝ)
    (hq : 0 < q) (hP₀ : 0 < P₀) (hbig : 2 * P₀ < P₂) (hbase : 0 ≤ base) :
    let f := min (base + (P₂ - P₀) / P₀) (1 / 2)
    0 < q * (1 - f) * P₂ - q * P₀ := by
  intro f
  have hrel : 1 < (P₂ - P₀) / P₀ := by
    rw [lt_div_iff₀ hP₀]; linarith
  have hf : f = 1 / 2 := min_eq_right (by linarith)
  rw [hf]
  nlinarith

/-- A concrete instance: `P₀ = 1`, `P₂ = 3`, base fee 0.3%, `q = 1`. The
capped fee is 1/2, cost is 1, revenue is 3/2: profit 1/2. -/
example : ∃ q P₀ P₂ cost revenue base : ℝ,
    0 ≤ q ∧ 0 < P₀ ∧ P₀ ≤ P₂ ∧ 0 ≤ base ∧ q * P₀ = cost ∧
      revenue = q * (1 - min (base + (P₂ - P₀) / P₀) (1 / 2)) * P₂ ∧
      0 < revenue - cost := by
  refine ⟨1, 1, 3, 1, 3 / 2, 3 / 1000, by norm_num, by norm_num, by norm_num, by norm_num,
    by norm_num, ?_, by norm_num⟩
  rw [min_eq_right (by norm_num)]
  norm_num

end QuietOdds

end
