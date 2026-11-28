# Sepolia runs

A record of real end-to-end runs on Ethereum Sepolia with the v0.2 contracts (November 2026). Every hash is a real Sepolia transaction and links to Etherscan. These runs were first recorded for the ETHGlobal Mumbai 2026 build; see [CHANGELOG.md](../CHANGELOG.md).

## Full flow with three wallets

The run used three test wallets (Priya, Rahul and Arjun), the live relayer, the v4 hook and CRE. Script outputs are in [`deployments/batch-e2e-sepolia.json`](../deployments/batch-e2e-sepolia.json).

**Look at the sender of each private action. It is always the relayer, never the user.**

| # | Step | Tx |
|---|---|---|
| 1 | Priya deposits 4 USDC (public, from her wallet) | [0x5a0b…2bab](https://sepolia.etherscan.io/tx/0x5a0bb2f6997e26864995e954295219b05ab62c071a20a4c197f96bf8d7482bab) |
| 1 | Rahul deposits 4 USDC | [0x4b04…72c0](https://sepolia.etherscan.io/tx/0x4b04b6a09348c9ee78c7ecc7219445f1a3a61d792d3e78e9546c2f18e7fb72c0) |
| 1 | Arjun deposits 4 USDC | [0x0d79…7e8a](https://sepolia.etherscan.io/tx/0x0d7917367ec9cf4df1226d7b148163776eb868330eebb3fa6b4b6a1957bb7e8a) |
| 2 | Priya's private bet, 1 USDC on side 0 (relayed) | [0x6945…9f2c](https://sepolia.etherscan.io/tx/0x6945c16a0adb39e6e56be730c774b8322e265d4a1b5e32879562cae31df49f2c) |
| 2 | Rahul's private bet, 1 USDC on side 2 (relayed) | [0x8618…7f27](https://sepolia.etherscan.io/tx/0x8618f9beec71990c2f13926acb065c284a25bed1eaf34dad0a9ca4f83131d27f) |
| 2 | Arjun's private bet, 1 USDC on side 1 (relayed) | [0xdee5…e624](https://sepolia.etherscan.io/tx/0xdee508bcde25762d4e1678de49df38f273d31254f1b16dfba7ba225687c0e624) |
| 2 | Swap 2 USDC → ETH through the hook, shielding 1 USDC in the same swap | [0x9240…7473](https://sepolia.etherscan.io/tx/0x924058a19bb4e1166c93f1373f78dea718659ebd9f9514121863f86e043d7473) |
| 2 | …the queued private bet from that shielded USDC, minutes later (relayed) | [0x135f…9d9b](https://sepolia.etherscan.io/tx/0x135f6fcabacc1873ae01eb680e70b0972c200afcfbb79a17b01766c5eac49d9b) |
| 3, 5, 7 | **One CRE report:** resolves market 1 (Arsenal), swaps batch #1 through the v4 pool (3.2 USDC → 0.001393 WETH, floor 0.001370) and donates 0.03 USDC of fees to LPs | [0xc74f…80e7](https://sepolia.etherscan.io/tx/0xc74f806af868206ff80adb6b14515d8b70506473753788e6bf15b389bbb080e7) |
| 5 | Priya, Rahul and Arjun join batch #1 privately (relayed) | [0xd12e…5e56](https://sepolia.etherscan.io/tx/0xd12e9690efd9847545098ea1d6976557464d240e4022dee1aaa93efedfa45e56), [0xf8b1…3c8c](https://sepolia.etherscan.io/tx/0xf8b1fe608871e839ef089df48591ea7f7473144d1b5415ff6edfba7f072e3c8c), [0x2bb1…0ad8](https://sepolia.etherscan.io/tx/0x2bb17e5b437db15c182ef2374ff9f234dd8ff40799dfdcc3d95c42ffdd9d0ad8) |
| 6 | Three batch tickets redeemed for hidden WETH notes (relayed) | [0xe378…34d0](https://sepolia.etherscan.io/tx/0xe378c3921459905bf6e7a98005706b2d0c44a333a20a5be11687dd5eb7cb34d0), [0x5b14…3bdb](https://sepolia.etherscan.io/tx/0x5b14af719bc1c7707f86eb0cff9d9d1a7c4ad07af868045cf22ca7a959f93bdb), [0xb964…9d0c](https://sepolia.etherscan.io/tx/0xb964c72fe2910d1d5df02951926b91ab425f96c6215cd3402d91aca544879d0c) |
| 4 | Rahul claims his win on market 1: 2.97 USDC as a hidden note (relayed) | [0x1045…3cec](https://sepolia.etherscan.io/tx/0x104513473c8d9b91992feed13052d1367ad89a84fd4cc5706e4786784e503cec) |
| 8 | Priya withdraws 0.000482 WETH to a **fresh address with 0 ETH** ([`0x5c69…B317`](https://sepolia.etherscan.io/address/0x5c6926b24f016518dC510f203a3455220A5fB317), nonce 0) | [0x24fb…f566](https://sepolia.etherscan.io/tx/0x24fbf8602c04d2d13dd9307fec64814ae1dbefa38ea5000ea4bd49156270f566) |

## From the live app (browser proofs)

| Step | Tx |
|---|---|
| Private bet placed from quietodds.vercel.app | [0xf5df…0c1d](https://sepolia.etherscan.io/tx/0xf5df610021a0080599e351119412c7acb629bc74bb3d27688f72696c950f0c1d) |
| Batch #3 executed from the batch page (permissionless) | [0xfc50…c7ef](https://sepolia.etherscan.io/tx/0xfc50f7af4756eeeae8c1558dfa615a3c6725e6f002b4e654707fe55b0f62c7ef) |
| Swap through the hook from the swap page, shielding 3 USDC | [0x66e9…2d64](https://sepolia.etherscan.io/tx/0x66e90117827555d49592aa2d0f35f116a14958127fd2b415e502ee5947222d64) |
| Private bet of 5 USDC on the F1 replay market #21 | [0x0ee6…e383](https://sepolia.etherscan.io/tx/0x0ee65e35d0b0be08466f80b246584c1a80228b251ff4776f40bf8209841de383) |
| CRE resolves the F1 replay from ESPN (Verstappen), cancels an empty market, donates fees | [0xfbef…e3f8](https://sepolia.etherscan.io/tx/0xfbef8a32c38e693c48876dcd3d31df9ecdec38f0a37ff909d22179e91eafe3f8) |
| Winnings claimed as a hidden note | [0x9f52…a52a](https://sepolia.etherscan.io/tx/0x9f52b342ac58886651dc0ef607c34c6194e8b9631d12d140414ba95a9deaa52a) |
| CRE resolves a Chainlink price market (ETH > $2,300), cancels three ESPN markets that got no bets, and donates fees, in one report | [0x30ff…12c1](https://sepolia.etherscan.io/tx/0x30ff9752b0b87244a26f024cddddd481dde39a5f81e360b39b86a9b5e16212c1) |

## Typical Sepolia gas

| Action | Gas |
|---|---|
| Deposit | 1.2M |
| Relayed private bet | ~6.0M (UltraHonk verify ≈ 2.4M plus two tree inserts) |
| Batch join | 5.7M |
| Redeem | 4.9M |
| Withdraw | 5.0M |
| Shielded swap | 1.4–1.9M |
| CRE report (resolve + batch + donate) | 1.46M |
