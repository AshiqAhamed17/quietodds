import type { Address } from "viem";
import external from "../../deployments/sepolia.json" with { type: "json" };
import core from "../../deployments/quietodds-sepolia.json" with { type: "json" };

export interface Deployment {
  chainId: number;
  deployBlock: bigint;
  pool: Address;
  markets: Address;
  resolverReceiver: Address;
  usdc: Address;
  weth: Address;
  ethUsdFeed: Address;
}

/** QuietOdds on Ethereum Sepolia. */
export const sepolia: Deployment = {
  chainId: external.chainId,
  deployBlock: BigInt(core.deployBlock),
  pool: core.ShieldedPool as Address,
  markets: core.Markets as Address,
  resolverReceiver: core.ResolverReceiver as Address,
  usdc: external.tokens.USDC.address as Address,
  weth: external.tokens.WETH.address as Address,
  ethUsdFeed: external.chainlinkFeeds.ETH_USD as Address,
};
