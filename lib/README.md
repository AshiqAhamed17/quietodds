# @quietodds/lib

Shared by the app, the relayer and the scripts. TypeScript source, no build step.

| Module | What |
|---|---|
| `keys` | Spending key from a wallet signature; per-index note secrets |
| `notes`, `merkle` | Poseidon leaves and the depth-20 tree, identical to the circuits and contracts |
| `backup` | AES-GCM note backups carried in `LeafInserted` events |
| `wallet`, `chain` | Rebuild a user's notes from pool events |
| `witness` | Circuit inputs + matching `ShieldedPool` arguments for spend and redeem |
| `prover` (`@quietodds/lib/prover`) | noir_js + bb.js proving and verification (browser or Node) |

`npm run sync` copies the compiled circuits and contract ABIs in after a circuit or contract change.
`npm test` checks bb.js against the bb CLI fixtures and proves a full bet and redeem.
