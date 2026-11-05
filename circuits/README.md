# QuietOdds circuits (Noir)

| Package | What it proves |
|---|---|
| `lib` | Note leaves (balance / position / ticket), nullifiers, Merkle membership, range checks |
| `spend` | Spend one balance note into change + a public amount (WITHDRAW / BET / BATCH_JOIN) + relayer fee |
| `redeem` | Turn a winning position, a refunded position or a batch ticket into a hidden balance note at ratio `num/den` |

## Toolchain (pinned)
| Tool | Version |
|---|---|
| nargo | 1.0.0-beta.25 |
| bb | 5.1.0 |
| poseidon | v0.3.0 |

## Commands
```bash
nargo test                     # all circuit tests
./generate-verifiers.sh        # -> contracts/src/verifiers/{Spend,Redeem}Verifier.sol
cd ../scripts && npm run fixtures   # real proofs -> contracts/test/fixtures/*.json
```
