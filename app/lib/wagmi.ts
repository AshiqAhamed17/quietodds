import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { SEPOLIA_RPC, anonFetch } from "./anonRpc";

/// Ethereum Sepolia only, injected wallet (MetaMask, Rabby, ...). Every read
/// goes through Anon-RPC (see anonRpc.ts), batched so each mixnet round trip
/// carries as many calls as possible.
export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC, { fetchFn: anonFetch, batch: { batchSize: 100, wait: 50 }, timeout: 60_000 }),
  },
  batch: { multicall: { wait: 50 } },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
