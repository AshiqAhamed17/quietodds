import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Prover } from "@quietodds/lib/prover";
import type { Config } from "./config.ts";
import { createRelayer } from "./relayer.ts";
import { createApp } from "./server.ts";

/** The relayer app on Sepolia, shared by the Node server and the Vercel function. */
export async function buildApp(cfg: Config) {
  const transport = http(cfg.rpcUrl);
  const relayer = createRelayer({
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(cfg.privateKey) }),
    prover: await Prover.create({ threads: 1 }),
    pool: cfg.pool,
    markets: cfg.markets,
    ethUsdFeed: cfg.ethUsdFeed,
    fees: cfg.fees,
  });
  return { relayer, app: createApp(relayer, { corsOrigin: cfg.corsOrigin }) };
}
