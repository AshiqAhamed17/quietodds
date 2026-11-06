import type { Address } from "viem";
import external from "../../deployments/sepolia.json" with { type: "json" };
import core from "../../deployments/quietodds-sepolia.json" with { type: "json" };
import hook from "../../deployments/hook-sepolia.json" with { type: "json" };

export interface Deployment {
  chainId: number;
  deployBlock: bigint;
  pool: Address;
  markets: Address;
  resolverReceiver: Address;
  /** Private batch swaps and the LP fee donation. */
  batches: Address;
  usdc: Address;
  weth: Address;
  ethUsdFeed: Address;
  hook: Address;
  /** The ETH/USDC v4 pool with QuietOddsHook. */
  poolKey: PoolKey;
  poolSwapTest: Address;
}

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** QuietOdds on Ethereum Sepolia. */
export const sepolia: Deployment = {
  chainId: external.chainId,
  deployBlock: BigInt(core.deployBlock),
  pool: core.ShieldedPool as Address,
  markets: core.Markets as Address,
  resolverReceiver: core.ResolverReceiver as Address,
  batches: core.BatchSwapper as Address,
  usdc: external.tokens.USDC.address as Address,
  weth: external.tokens.WETH.address as Address,
  ethUsdFeed: external.chainlinkFeeds.ETH_USD as Address,
  hook: hook.QuietOddsHook as Address,
  poolKey: hook.poolKey as PoolKey,
  poolSwapTest: external.uniswapV4.PoolSwapTest as Address,
};
