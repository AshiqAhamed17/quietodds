# Spike: funding QuietOdds from Privacy Pools v2

Phase 1.1. Question: can a QuietOdds contract be the processor of a Privacy Pools v2 `transact`, with QuietOdds' own `data` bound into the proof? If yes, a user can move private funds from Privacy Pools into a private QuietOdds balance in **one** transaction (Path A). If not, we fall back to a stealth withdrawal plus a deposit from a one-time address (Path B).

Code: [`scripts/pp-spike/pp-spike.ts`](../scripts/pp-spike/pp-spike.ts) and the throwaway processor [`contracts/test/spike/SpikeProcessor.sol`](../contracts/test/spike/SpikeProcessor.sol). Run on Ethereum Sepolia against Privacy Pools v2 "V9" with `@0xbow/privacy-pools-v2-sdk@1.1.0`.

## Result

**Status: waiting for ASP approval.** Everything up to the final submit works on Sepolia:

| Step | Result |
|---|---|
| Keys from one EIP-712 signature, `PoolSession` on V9 | Works |
| Keystore registration for the owner | Works |
| Deposit 2 USDC into Privacy Pools | Works: tx [`0xd958…f250`](https://sepolia.etherscan.io/tx/0xd95808d942287e6544d1a07e17242c7904e34b24d412f44de629caa62309f250), note `0x1358fdeb2d…` |
| Throwaway processor deployed | [`0x5599…c08a`](https://sepolia.etherscan.io/address/0x55995054c405313c7242e75ca07e6ff6bb16c08a) |
| SDK builds a `transact` with our `processor` and `data`, and both are bound in the calldata | Works (checked by decoding the prepared tx) |
| Note approved by the ASP (PENDING → ACTIVE) | **Pending** since 2026-11-28 13:32 UTC |
| `SpikeProcessor.fund` submitted, proof verifies on-chain, USDC arrives | Not run yet; needs an ACTIVE note |

Run `npx tsx pp-spike.ts status` in `scripts/pp-spike/` to check, then `npx tsx pp-spike.ts fund 1` once it is ACTIVE.

## How it works

`PoolVault.transact(proof, TransactParams{processor, data}, NoteData[])`:

- requires `processor == msg.sender`
- requires the proof's `context` to equal `keccak256(abi.encode(params, noteData)) % SNARK_SCALAR_FIELD`, so `data` is bound by the proof
- pays `amountOut` of `tokenIdOut` to `msg.sender` (the processor). There is no callback.

So the processor contract decodes `data`, calls `transact` with itself as processor, measures what it received and acts on it. For QuietOdds, `data = abi.encode(precommitment, ciphertext, relayer, fee)`. The real `PrivacyPoolsDepositor` (Phase 1.2a) will pay `fee` to `relayer` and call `ShieldedPool.deposit(USDC, received − fee, precommitment, ciphertext)`. Nobody can change the precommitment, the relayer or the fee without breaking the proof.

## Building the proof with the SDK

The public session API (`prepareWithdraw`, `relayWithdraw`) always encodes `data` as `PayoutRouting{recipient, feeRecipient, feeAmount, nativeGas}` for 0xbow's relay contract. Its zod validation drops any other fields, so a custom `data` can't be passed through it.

The orchestrator underneath, `TransactOrchestrator.prepareTransact`, does take a `transactParams: {processor, data}` override. The SDK uses it for its own yield withdrawals (processor = PPRouter). The spike reaches it as `session.delegates.withdraw.core`, which is internal.

`prepareTransact` also simulates the transaction from the owner's wallet, which reverts because only the processor may send it. Passing `pendingKeystoreRegistration: false` skips that simulation without changing the keystore proof.

## What we found on the way

| Finding | Impact | What we did |
|---|---|---|
| Sepolia V9 still verifies with SDK **1.0.0's dev keys**. Its deposit verifier (`0x6b78…4d06`) holds the 1.0.0 verification key, not the 1.0.1+ ceremony keys that SDK 1.1.0 ships. Every 1.1.0 proof reverts on Sepolia. | Blocks any 1.1.0 user on Sepolia | Pinned the 1.0.0 circuit manifest ([`sepolia-v9-circuits.json`](../scripts/pp-spike/sepolia-v9-circuits.json)): same circuits, matching keys |
| 1.1.0's own `DEFAULT_CIRCUIT_MANIFEST` fails `PoolSessionBuilder`'s schema: the sha256 digests have no `0x` prefix | The documented default doesn't build | Add the prefix before passing the manifest |
| The default IPFS gateway (ipfs.io) returns HTTP 429 for the 20–70 MB proving keys | Deposits fail to prove | Use `ipfs.filebase.io` and `gateway.pinata.cloud` first |
| `POOL_VAULT_TRANSACT_ABI` is in the type declarations but missing from the JS exports | Import fails at runtime | Define the ABI locally |
| Free Alchemy keys cap `eth_getLogs` at 10 blocks; the SDK scans wide ranges | Note discovery fails | Use publicnode |
| The SDK depends on snarkjs and circomlibjs (GPL-3.0) | Licence question for the app | The spike lives outside the npm workspaces. The app will load the SDK with a dynamic import on one tab (Phase 1.4). |

## Questions for 0xbow

1. Is a third-party processor with custom `TransactParams.data` a supported use? Could `prepareTransact` (or a `prepareWithdraw` option) accept `transactParams` publicly, so integrators don't reach into internals?
2. Will Sepolia be rotated to the ceremony keys, or should integrators pin the 1.0.0 manifest there?
3. How long does the dev ASP take to approve Sepolia deposits?
4. Which L2s are planned for v2?

## Decision

**Pending the final run.** Path A looks feasible: the contract rules allow a third-party processor, and the SDK binds custom `data` into the proof. If the on-chain proof verifies and the USDC arrives, we build Path A (`PrivacyPoolsDepositor`). If the proof is rejected, we fall back to Path B and ask 0xbow about custom `data`.
