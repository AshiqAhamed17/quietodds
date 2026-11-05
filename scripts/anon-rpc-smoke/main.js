// Browser smoke test: one eth_blockNumber on Sepolia through Anon-RPC (Nox).
import { AnonRpcWorker } from "@anon-rpc/browser-harness";

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const NOX_SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";

// Used once, only to read the specifier contract (not anonymized).
const bootstrap = {
  request: async ({ method, params }) => {
    const res = await fetch(SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  },
};

const log = (msg) => {
  console.log(msg);
  document.getElementById("out").textContent += msg + "\n";
};

async function main() {
  const t0 = performance.now();
  const worker = new AnonRpcWorker({ address: NOX_SPECIFIER, preExisting: { rpcProvider: bootstrap } });
  await worker.ready;
  log(`ready in ${Math.round(performance.now() - t0)}ms`);

  const t1 = performance.now();
  const res = await worker.fetch(SEPOLIA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const { result } = await res.json();
  log(`eth_blockNumber via Anon-RPC = ${BigInt(result)} (${Math.round(performance.now() - t1)}ms)`);
  log("ANON_RPC_OK");
  worker.close();
}

main().catch((e) => log(`ANON_RPC_FAIL ${e?.code ?? ""} ${e?.message ?? e}`));
