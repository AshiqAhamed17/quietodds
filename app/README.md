# QuietOdds app

Next.js frontend for QuietOdds on Ethereum Sepolia: the markets board, private betting, deposits,
withdrawals, the swap-and-bet hook and private batch swaps.

- Contract addresses and ABIs come from `@quietodds/lib` (`deployments/*.json`), shared with the
  relayer and scripts.
- Proofs are generated in the browser with bb.js + noir_js; the relayer submits them.

```bash
npm install          # from the repo root (npm workspaces)
npm run dev -w app   # http://localhost:3000
```

`NEXT_PUBLIC_RELAYER_URL` overrides the relayer (default https://quietodds-relayer.vercel.app).
