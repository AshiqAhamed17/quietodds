#!/usr/bin/env bash
# Regenerate the on-chain Solidity verifiers for the spend and redeem circuits.
# Outputs are GENERATED files: re-run whenever a circuit changes.
# Requires nargo 1.0.0-beta.25 and bb 5.1.0.
#
# UltraHonk with the keccak oracle hash is the flavor meant for EVM verification.
set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="../contracts/src/verifiers"
mkdir -p "$OUT_DIR"

for circuit in spend redeem; do
  name="$(tr '[:lower:]' '[:upper:]' <<< "${circuit:0:1}")${circuit:1}Verifier"
  echo "==> $circuit: compile"
  nargo compile --package "$circuit"
  echo "==> $circuit: verification key"
  mkdir -p "./target/$circuit"
  bb write_vk --scheme ultra_honk --oracle_hash keccak -b "./target/$circuit.json" -o "./target/$circuit"
  echo "==> $circuit: Solidity verifier -> $OUT_DIR/$name.sol"
  bb write_solidity_verifier --scheme ultra_honk -k "./target/$circuit/vk" -o "$OUT_DIR/$name.sol"
  # Both files declare the same top-level names; prefix every library,
  # interface and contract so the two verifiers can be compiled side by side.
  perl -0pi -e 's/\b(HonkVerificationKey|IVerifier|Errors|FrLib|Honk|ZKTranscriptLib|RelationsLib|CommitmentSchemeLib|BaseZKHonkVerifier)\b/'"${name}"'_$1/g; s/\bcontract HonkVerifier\b/contract '"${name}"'/' "$OUT_DIR/$name.sol"
done
echo "==> done"
