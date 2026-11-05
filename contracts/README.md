# QuietOdds contracts

Foundry project: ShieldedPool, Markets, ResolverReceiver and the Uniswap v4 hook.

```bash
git submodule update --init --recursive
forge build
forge test
```

## Deploying to Sepolia

Sepolia runs a newer gas schedule than Foundry's local EVM (code deposit ≈ 1,560 gas/byte,
cheap base txs), so local gas estimates are far too low for deployments. Skip the local
simulation so every gas limit comes from the node, and keep the tip tiny (base fee is ~wei):

```bash
set -a; source ../.env; set +a
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --skip-simulation --slow \
  --with-gas-price 2gwei --priority-gas-price 1000000 --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
forge script script/CreateMarkets.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --skip-simulation --slow \
  --with-gas-price 2gwei --priority-gas-price 1000000
```

Addresses land in `deployments/quietodds-sepolia.json`.
