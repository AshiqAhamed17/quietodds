# Security policy

QuietOdds is in **public beta on Sepolia testnet**. It holds no real funds and has not been audited yet. We still take every report seriously: the same contracts and circuits are headed for mainnet.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/AshiqAhamed17/quietodds/security/advisories/new)).

Helpful things to include:

- what an attacker can do, and what they need first
- the contract, circuit or file and line, if you know it
- steps or a test that reproduces it (a Foundry test or a Noir test is ideal)

You'll get a reply within 72 hours. We'll keep you updated while we fix it, and credit you in the release notes unless you'd rather stay anonymous.

## Scope

In scope:

- **Contracts** in [`contracts/src/`](contracts/src): ShieldedPool, Markets, BatchSwapper, ResolverReceiver, QuietOddsHook and the generated verifiers
- **Circuits** in [`circuits/`](circuits): `spend`, `redeem` and the shared `lib`
- **Relayer** in [`relayer/`](relayer): anything that lets it steal, redirect or link users
- **App** in [`app/`](app): key derivation, note encryption, anything that leaks keys or links a user to their actions
- **CRE workflow** in [`cre/`](cre): anything that resolves a market to the wrong result

Especially interesting: creating or stealing value, spending a note twice, linking a deposit to a bet or withdrawal, redirecting a relayed action, and breaking a Lean theorem's assumptions in a way the code depends on.

Out of scope:

- issues that need a compromised browser, wallet or device
- the known limits listed in the [threat model](docs/threat-model.md) and the README's "Known limitations"
- third-party services we use (Vercel, RPC providers, ESPN, Uniswap's Trading API) unless our use of them is the problem
- spam, rate limits and denial of service against the testnet relayer

## Bug bounty

There is no paid bounty yet. One is planned before the mainnet launch.
