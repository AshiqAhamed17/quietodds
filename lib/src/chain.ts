// Reads the pool's public history: every leaf (with its backup ciphertext)
// and every burned nullifier. Works with any viem client, including one
// routed through Anon-RPC.
import type { Address, PublicClient } from "viem";
import { parseAbiItem } from "viem";
import type { PoolLeaf } from "./wallet.ts";

const LEAF_INSERTED = parseAbiItem("event LeafInserted(uint256 indexed index, uint256 leaf, bytes ciphertext)");
const SPEND = parseAbiItem(
  "event Spend(uint256 indexed nullifierHash, uint256 indexed actionType, uint256 asset, uint256 publicAmount)",
);
const REDEEM = parseAbiItem("event Redeem(uint256 indexed nullifierHash, uint256 indexed kind, uint256 indexed id)");

export interface PoolState {
  leaves: PoolLeaf[];
  nullifiers: Set<bigint>;
  toBlock: bigint;
}

/** Scans in chunks; public RPCs cap the block range of eth_getLogs. */
export async function fetchPoolState(
  client: PublicClient,
  pool: Address,
  fromBlock: bigint,
  { chunk = 40_000n, toBlock }: { chunk?: bigint; toBlock?: bigint } = {},
): Promise<PoolState> {
  const end = toBlock ?? (await client.getBlockNumber());
  const leaves: PoolLeaf[] = [];
  const nullifiers = new Set<bigint>();
  for (let start = fromBlock; start <= end; start += chunk) {
    const stop = start + chunk - 1n < end ? start + chunk - 1n : end;
    const range = { address: pool, fromBlock: start, toBlock: stop };
    const [inserted, spends, redeems] = await Promise.all([
      client.getLogs({ ...range, event: LEAF_INSERTED }),
      client.getLogs({ ...range, event: SPEND }),
      client.getLogs({ ...range, event: REDEEM }),
    ]);
    for (const l of inserted) {
      leaves.push({ index: Number(l.args.index!), leaf: l.args.leaf!, ciphertext: l.args.ciphertext! });
    }
    for (const l of [...spends, ...redeems]) nullifiers.add(l.args.nullifierHash!);
  }
  leaves.sort((a, b) => a.index - b.index);
  leaves.forEach((l, i) => {
    if (l.index !== i) throw new Error(`missing leaf ${i}: scan from the pool's deploy block`);
  });
  return { leaves, nullifiers, toBlock: end };
}
