# QuietOdds relayer

Submits users' spend and redeem proofs and pays the gas, so a user's wallet never
appears next to their bets. It is untrusted: every proof binds the relayer's
address and fee, so it can only submit a call exactly as the user built it.

| Route | |
|---|---|
| `GET /health` | relayer address, ETH balance, latest block |
| `GET /fee-quote` | minimum fee per call kind, in USDC/WETH base units |
| `POST /spend` | `{ args: SpendArgs, proof, changeCiphertext, outCiphertext }` (bet or withdraw) |
| `POST /redeem` | `{ args: RedeemArgs, proof, outCiphertext }` |

Bigints are decimal strings; `spendBody` / `redeemBody` / `relayerApi` in `@quietodds/lib` build them.

Before sending, it checks the proof names this relayer and pays at least the
quoted fee, the root is known and the nullifier unspent, then verifies the proof
with bb.js and simulates the call. Gas limits come from the node's estimate
(Sepolia prices storage far above what local tooling assumes). Sends are
serialized; a nullifier already in flight is refused.

No request bodies, IPs or ciphertexts are logged; the rate limiter keeps
per-IP counters for one minute only.

```sh
npm start            # reads ../.env: RELAYER_PRIVATE_KEY, SEPOLIA_RPC_URL
npm test             # anvil + DeployLocal + full deposit/bet/redeem/withdraw
```

Optional env: `PORT` (8787), `CORS_ORIGIN` (*), `RELAYER_RPC_URL`,
`RELAYER_SPEND_GAS`, `RELAYER_REDEEM_GAS`, `RELAYER_MIN_FEE_USDC`.

## Deploy (Vercel)

The relayer runs as one Vercel Node function, built locally with the Build
Output API (esbuild bundle + bb.js's linux WASM/binary) and uploaded prebuilt:

```sh
vercel link --project quietodds-relayer          # once
vercel env add RELAYER_PRIVATE_KEY production --sensitive   # once, paste the key
vercel env add SEPOLIA_RPC_URL production                   # once
npm run deploy -w relayer
```

A warm instance serves requests in order, so nonces don't collide; the
function may run up to 300s while it waits for a receipt.
