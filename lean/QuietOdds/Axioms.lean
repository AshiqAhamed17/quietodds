import QuietOdds.Spend
import QuietOdds.Redeem
import QuietOdds.ProRata
import QuietOdds.Sandwich

/-!
# Axiom audit

`#print axioms` lists every axiom each main theorem depends on. The expected
output is only Lean's standard axioms `propext`, `Classical.choice` and
`Quot.sound`: no custom axioms and no unfinished proofs.
-/

#print axioms QuietOdds.spend_conserves_value
#print axioms QuietOdds.redeem_payout_exact
#print axioms QuietOdds.redeem_fee_sound
#print axioms QuietOdds.pro_rata_conserves
#print axioms QuietOdds.pro_rata_dust_lt_card
#print axioms QuietOdds.sandwich_unprofitable
#print axioms QuietOdds.sandwich_unprofitable_fee_rule
#print axioms QuietOdds.capped_fee_counterexample
