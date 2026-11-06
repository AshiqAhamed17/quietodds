module

public import Mathlib

/-!
# Theorem 3: pro-rata shares never add up to more than the pot

Theorem 2 shows each redeem pays exactly `⌊x_i * N / D⌋`. Here we look at
everyone together: if the stakes `x_i` add up to `D`, the floored shares add
up to at most `N`, and the dust left behind is less than one unit per person.

This is pure natural-number arithmetic; no field is involved. It models the
contract logic (`BatchSwapper` batch output `N` over `totalIn = D`, or a market
pot `N` over the winning side's total stake `D`), not bytecode. The facts that
the `x_i` really sum to `D`, that each note redeems once, and that `N` is
really held by the pool are Solidity properties, tested but not proved here.
-/

@[expose] public section

namespace QuietOdds

open Finset

/-- Sum of floors is at most floor of sum. -/
lemma sum_div_le_div_sum {ι : Type*} (s : Finset ι) (a : ι → ℕ) (D : ℕ) :
    ∑ i ∈ s, a i / D ≤ (∑ i ∈ s, a i) / D := by
  classical
  induction s using Finset.induction_on with
  | empty => simp
  | insert j s hj ih =>
    rw [sum_insert hj, sum_insert hj]
    calc a j / D + ∑ i ∈ s, a i / D ≤ a j / D + (∑ i ∈ s, a i) / D := by omega
      _ ≤ (a j + ∑ i ∈ s, a i) / D := Nat.div_add_div_le_add_div

/-- **Theorem 3.** If the stakes `x i` add up to `D`, the floored pro-rata
payouts `⌊x i * N / D⌋` add up to at most `N`. -/
theorem pro_rata_conserves {ι : Type*} (s : Finset ι) (x : ι → ℕ) (N D : ℕ)
    (hD : ∑ i ∈ s, x i = D) :
    ∑ i ∈ s, x i * N / D ≤ N := by
  calc ∑ i ∈ s, x i * N / D ≤ (∑ i ∈ s, x i * N) / D := sum_div_le_div_sum s _ D
    _ = (D * N) / D := by rw [← sum_mul, hD]
    _ ≤ N := by
          rcases Nat.eq_zero_or_pos D with h | h
          · simp [h]
          · rw [Nat.mul_div_cancel_left _ h]

/-- **Theorem 3 (dust bound).** With `D > 0`, the dust `N - ∑ payouts` is
strictly less than the number of participants: `N < ∑ payouts + |s|`. -/
theorem pro_rata_dust_lt_card {ι : Type*} (s : Finset ι) (x : ι → ℕ) (N D : ℕ)
    (hD : ∑ i ∈ s, x i = D) (hDpos : 0 < D) :
    N < ∑ i ∈ s, x i * N / D + s.card := by
  have hne : s.Nonempty := by
    rcases s.eq_empty_or_nonempty with h | h
    · subst h; simp at hD; omega
    · exact h
  have key : ∑ i ∈ s, x i * N < ∑ i ∈ s, D * (x i * N / D + 1) :=
    sum_lt_sum_of_nonempty hne fun i _ => Nat.lt_mul_div_succ _ hDpos
  rw [← sum_mul, hD, ← mul_sum, sum_add_distrib, sum_const, smul_eq_mul, mul_one] at key
  exact Nat.lt_of_mul_lt_mul_left key

/-- Real numbers from the Sepolia batch-swap run (`deployments/batch-e2e-sepolia.json`,
batch #1): three joins of 1.2, 1.0 and 1.0 USDC (D = 3,200,000 units), batch
output N = 1,392,866,552,093,773 wei. Payouts sum to ...772: 1 wei of dust. -/
example :
    1200000 * 1392866552093773 / 3200000
      + 1000000 * 1392866552093773 / 3200000
      + 1000000 * 1392866552093773 / 3200000 = 1392866552093772 := by
  norm_num

/-- The individual Sepolia payouts. -/
example :
    1200000 * 1392866552093773 / 3200000 = 522324957035164 ∧
      1000000 * 1392866552093773 / 3200000 = 435270797529304 := by
  norm_num

/-- The Sepolia numbers, phrased through `pro_rata_conserves` / the dust bound
with an explicit `Fin 3` family. -/
example :
    let x : Fin 3 → ℕ := ![1200000, 1000000, 1000000]
    ∑ i, x i * 1392866552093773 / 3200000 = 1392866552093772 := by
  simp [Fin.sum_univ_three]

end QuietOdds

end
