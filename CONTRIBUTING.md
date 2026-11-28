# Contributing to QuietOdds

Thanks for wanting to help. Issues, fixes and ideas are all welcome.

## Before you start

- **Bugs and small fixes:** open a pull request directly, or an issue first if you're not sure.
- **Bigger changes** (new features, circuit or contract changes): open an issue to talk it through first. Circuit and contract changes need new verifiers and proof fixtures, so they're worth planning.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Setup

You'll need:

- Node 24 and npm
- [Foundry](https://getfoundry.sh)
- Nargo `1.0.0-beta.25` and `bb` (`noirup -v 1.0.0-beta.25`, then `bbup`)
- [Bun](https://bun.sh) for the Chainlink CRE workflow
- [elan](https://github.com/leanprover/elan) for the Lean proofs (optional)

```sh
git clone --recurse-submodules https://github.com/AshiqAhamed17/quietodds
cd quietodds
npm install
cp .env.example .env   # testnet-only keys; never commit .env
```

## The repo

| Folder | What it is | Test command |
|---|---|---|
| `circuits/` | Noir circuits (`spend`, `redeem`, shared `lib`) | `cd circuits && nargo test` |
| `contracts/` | Foundry contracts and the generated verifiers | `cd contracts && forge test` |
| `lib/` | Shared TypeScript: keys, notes, Merkle, prover | `npm test -w lib` |
| `relayer/` | Hono relayer | `npm test -w relayer` |
| `cre/resolver/` | Chainlink CRE workflow | `cd cre/resolver && bun install && bun test` |
| `app/` | Next.js app | `npm run build -w app` and `npm run lint -w app` |
| `lean/` | Lean 4 proofs | `cd lean && lake exe cache get && lake build` |

CI runs all of these on every push and pull request.

## Changing a circuit

A circuit change affects everything downstream. In order:

1. Change the circuit and its tests, then run `nargo test`.
2. Regenerate the verifiers: `cd circuits && ./generate-verifiers.sh`.
3. Regenerate the proof fixtures: `npm run fixtures -w scripts`.
4. Copy the compiled circuits to `lib`: `npm run sync -w lib`.
5. Run `forge test` and the `lib` tests.
6. If the change touches a line a Lean theorem models, update the theorem in `lean/` and the line numbers in `lean/README.md`.

## Pull requests

- Keep each PR to one change, with a short description of what and why.
- Add or update tests for anything you change.
- Write commit messages as short, plain sentences ("Hide test markets from the board").
- Make sure CI is green.

## Code style

- Match the code around you: naming, comment density and idiom.
- Solidity: `forge fmt`.
- TypeScript: the existing ESLint config in `app/`, and strict TypeScript everywhere.
- Comments explain why, not what.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
