# Changelog

All notable changes to QuietOdds. Dates are in UTC.

## [Unreleased]

## [0.3.0] - 2026-11-28

The first release as a standalone project: the same contracts on Sepolia, tidied into a public beta.

### Changed

- The app reads as a product in public beta. Event branding and demo wording are gone.
- One "Public beta · Sepolia testnet" badge in the nav, driven by the chain config, replaces the scattered "On Sepolia" captions.
- The nav follows the product: Markets · Portfolio · Deposit · Swap · Batch · Security.
- The README leads with the product, its status and how to try it. The Sepolia transaction log moved to [`docs/sepolia-runs.md`](docs/sepolia-runs.md).
- The threat model describes the current beta.
- Uniswap v4 feedback moved to [`docs/feedback/uniswap-v4.md`](docs/feedback/uniswap-v4.md).

### Added

- A footer on every page: Docs, Security, Threat model, GitHub and the network status.
- A page title and description for every page, a QuietOdds icon and a share image.
- A "Market not found" page for unknown market ids.
- `SECURITY.md`, `CONTRIBUTING.md` and this changelog.
- CI on GitHub Actions for circuits, contracts, the TypeScript packages, the CRE workflow and the app.

### Fixed

- Test and replay markets no longer show on the markets board. They stay on chain, reachable by URL, and still appear in your portfolio if you hold a position.
- A non-numeric market id in the URL no longer crashes the market page.
- Batch details on small screens are readable rows instead of a cramped grid.

## [0.2.0] - 2026-11-08

Built at ETHGlobal Mumbai 2026.

### Added

- Shielded pool with Poseidon notes in a depth-20 Merkle tree and nullifiers.
- Noir circuits `spend` and `redeem`, with UltraHonk proofs made in the browser.
- Private betting on football, F1 and crypto price markets, with pari-mutuel payouts.
- A relayer that verifies, simulates and submits proofs, so the user's wallet never appears.
- A Uniswap v4 hook that shields part of a swap into the pool, with a directional anti-sandwich fee and a skim donated to LPs.
- Private batch swaps through `PoolManager.unlock`, with a Chainlink price floor.
- A Chainlink CRE workflow that resolves markets, executes batches and donates fees.
- Anon-RPC for every read the app makes.
- Lean 4 proofs of the money rules, and a `/verified` page with live results.

[Unreleased]: https://github.com/AshiqAhamed17/quietodds/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AshiqAhamed17/quietodds/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AshiqAhamed17/quietodds/releases/tag/v0.2.0
