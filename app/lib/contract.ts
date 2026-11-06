import { parseAbi } from "viem";
import { sepolia as chain } from "wagmi/chains";
import { sepolia as deployment } from "@quietodds/lib";

export { batchSwapperAbi, marketsAbi, shieldedPoolAbi } from "@quietodds/lib";

/// QuietOdds runs on Ethereum Sepolia. Addresses come from deployments/*.json
/// through @quietodds/lib, the same source the relayer and scripts use.
export const CHAIN = chain;
export const DEPLOYMENT = deployment;
export const EXPLORER = "https://sepolia.etherscan.io";
export const REPO = "https://github.com/AshiqAhamed17/quietodds";
export const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "https://quietodds-relayer.vercel.app";

export const USDC_DECIMALS = 6;
export const ETH_USD_FEED = deployment.ethUsdFeed;

export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

/// Markets.Status
export enum Status {
  None = 0,
  Open = 1,
  Resolved = 2,
  Cancelled = 3,
}

/// Markets.Source
export enum Source {
  Price = 0,
  Sports = 1,
}

/// Verified Sepolia price feeds → human labels.
export const FEEDS: Record<string, { asset: string; unit: string }> = {
  "0x694aa1769357215de4fac081bf1f309adc325306": { asset: "ETH", unit: "USD" },
  "0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43": { asset: "BTC", unit: "USD" },
  "0xc59e3633baac79493d908e63626716e204a45edf": { asset: "LINK", unit: "USD" },
};

export function feedLabel(feed: string): { asset: string; unit: string } {
  return FEEDS[feed.toLowerCase()] ?? { asset: "Feed", unit: "USD" };
}

/// Chainlink AggregatorV3 read surface (live price chart and ticker).
export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/// ERC-20 surface for USDC / WETH.
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);
