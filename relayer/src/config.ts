import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { sepolia as sepoliaDeployment } from "@quietodds/lib";

const ROOT_ENV = fileURLToPath(new URL("../../.env", import.meta.url));

export interface Config {
  rpcUrl: string;
  privateKey: Hex;
  chainId: number;
  pool: Address;
  markets: Address;
  /** Chainlink ETH/USD, to price gas in USDC. Unset: use `ethUsdFallback`. */
  ethUsdFeed?: Address;
  port: number;
  corsOrigin: string;
  fees: FeePolicy;
}

export interface FeePolicy {
  /** Gas a relayed call is priced at. Measured on Sepolia in task 3.5. */
  spendGas: bigint;
  redeemGas: bigint;
  /** Multiplier on the gas cost, in basis points (15000 = 1.5x). */
  marginBps: bigint;
  /** Floors, so a near-zero gas price still covers the relayer's time. */
  minUsdc: bigint;
  minWeth: bigint;
  ethUsdFallback: bigint; // whole dollars
  /** Accept fees down to this share of the current quote (gas moves). */
  toleranceBps: bigint;
  /** Tip per gas. Sepolia's base fee is ~18 wei, so a tiny tip is enough. */
  priorityFee: bigint;
}

export const defaultFees: FeePolicy = {
  spendGas: 5_000_000n,
  redeemGas: 4_000_000n,
  marginBps: 15_000n,
  minUsdc: 50_000n, // 0.05 USDC
  minWeth: 20_000_000_000_000n, // 0.00002 WETH
  ethUsdFallback: 3_000n,
  toleranceBps: 8_000n,
  priorityFee: 1_000_000n,
};

const big = (v: string | undefined, d: bigint) => (v ? BigInt(v) : d);

export function loadConfig(env = process.env): Config {
  if (existsSync(ROOT_ENV) && env === process.env) process.loadEnvFile(ROOT_ENV);
  const privateKey = env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) throw new Error("RELAYER_PRIVATE_KEY is not set");
  const rpcUrl = env.RELAYER_RPC_URL ?? env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is not set");
  return {
    rpcUrl,
    privateKey,
    chainId: sepoliaDeployment.chainId,
    pool: sepoliaDeployment.pool,
    markets: sepoliaDeployment.markets,
    ethUsdFeed: sepoliaDeployment.ethUsdFeed,
    port: Number(env.PORT ?? 8787),
    corsOrigin: env.CORS_ORIGIN ?? "*",
    fees: {
      ...defaultFees,
      spendGas: big(env.RELAYER_SPEND_GAS, defaultFees.spendGas),
      redeemGas: big(env.RELAYER_REDEEM_GAS, defaultFees.redeemGas),
      minUsdc: big(env.RELAYER_MIN_FEE_USDC, defaultFees.minUsdc),
    },
  };
}
