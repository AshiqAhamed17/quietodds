import { serve } from "@hono/node-server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { Prover } from "@quietodds/lib/prover";
import { loadConfig } from "./config.ts";
import { createRelayer } from "./relayer.ts";
import { createApp } from "./server.ts";

const cfg = loadConfig();
const transport = http(cfg.rpcUrl);
const relayer = createRelayer({
  publicClient: createPublicClient({ chain: sepolia, transport }),
  walletClient: createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(cfg.privateKey) }),
  prover: await Prover.create(),
  pool: cfg.pool,
  markets: cfg.markets,
  ethUsdFeed: cfg.ethUsdFeed,
  fees: cfg.fees,
});

serve({ fetch: createApp(relayer, { corsOrigin: cfg.corsOrigin }).fetch, port: cfg.port }, ({ port }) => {
  console.log(`relayer ${relayer.address} on :${port}, pool ${cfg.pool}`);
});
