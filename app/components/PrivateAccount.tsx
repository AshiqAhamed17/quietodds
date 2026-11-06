"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import {
  ASSET,
  KEY_MESSAGE,
  MerkleTree,
  fetchPoolState,
  keysFromSignature,
  nextNoteIndex,
  scanNotes,
  shieldedBalance,
  type Keys,
  type OwnedNote,
  type PoolState,
} from "@quietodds/lib";
import { getProver } from "@/lib/private";
import { DEPLOYMENT } from "@/lib/contract";

export type ScanPhase = "idle" | "logs" | "decrypt" | "done" | "error";

export interface ScanState {
  phase: ScanPhase;
  /** 0..1 across both phases (fetching logs counts as the first 70%). */
  progress: number;
  detail: string;
  error?: string;
}

interface PrivateAccount {
  /** Held in memory only: never written to storage. Reload = sign again. */
  keys: Keys | null;
  unlocking: boolean;
  unlock: () => Promise<void>;
  lock: () => void;
  notes: OwnedNote[];
  tree: MerkleTree | null;
  scan: ScanState;
  /** Incremental by default (only new blocks); `full` re-reads from the deploy block. */
  rescan: (full?: boolean) => Promise<void>;
  /** Fresh notes and tree, straight from the chain, for building a proof. */
  sync: () => Promise<{ notes: OwnedNote[]; tree: MerkleTree }>;
  /**
   * Claims `count` unused note indices. Indices are reserved locally until the
   * chain shows them used, so two quick actions never derive the same note.
   */
  reserveIndices: (notes: readonly OwnedNote[], count: number) => number;
  balances: { usdc: bigint; weth: bigint };
}

const Ctx = createContext<PrivateAccount | null>(null);

export function usePrivateAccount() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrivateAccount outside PrivateAccountProvider");
  return v;
}

/// The user's private account: keys from one wallet signature, and their notes
/// found by scanning the pool's public history (through Anon-RPC) and trial-
/// decrypting every backup with the viewing key. Nothing about the user is
/// sent anywhere: the scan downloads the same data for everyone.
export function PrivateAccountProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const [keys, setKeys] = useState<Keys | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [notes, setNotes] = useState<OwnedNote[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [scan, setScan] = useState<ScanState>({ phase: "idle", progress: 0, detail: "" });
  const scanId = useRef(0);
  const reserved = useRef(0);
  // The last scan, so a sync only reads blocks since then.
  const cache = useRef<{ state: PoolState; owned: OwnedNote[] } | null>(null);

  // A different wallet is a different private account.
  useEffect(() => {
    setKeys(null);
    setNotes([]);
    setTree(null);
    setScan({ phase: "idle", progress: 0, detail: "" });
    reserved.current = 0;
    cache.current = null;
  }, [address]);

  const runScan = useCallback(
    async (k: Keys, incremental = false): Promise<{ notes: OwnedNote[]; tree: MerkleTree } | null> => {
      if (!client) return null;
      const id = ++scanId.current;
      const live = () => id === scanId.current;
      const prev = cache.current;
      if (incremental && prev) {
        try {
          // Overlap the last scan by ~4 minutes: a lagging RPC node may have missed its tail.
          const from = prev.state.toBlock > DEPLOYMENT.deployBlock + 20n ? prev.state.toBlock - 20n : DEPLOYMENT.deployBlock;
          const delta = await fetchPoolState(client as never, DEPLOYMENT.pool, from, { firstIndex: prev.state.leaves.length });
          if (!live()) return null;
          const nullifiers = new Set([...prev.state.nullifiers, ...delta.nullifiers]);
          const leaves = [...prev.state.leaves, ...delta.leaves];
          const fresh = await scanNotes(k, delta.leaves, (h) => nullifiers.has(h));
          const owned = [...prev.owned, ...fresh].map((n) => ({ ...n, spent: nullifiers.has(n.secrets.nullifierHash) }));
          const toBlock = delta.toBlock > prev.state.toBlock ? delta.toBlock : prev.state.toBlock;
          cache.current = { state: { leaves, nullifiers, toBlock }, owned };
          const t = new MerkleTree(leaves.map((l) => l.leaf));
          setNotes(owned);
          setTree(t);
          const mine = owned.filter((n) => !n.spent).length;
          setScan({ phase: "done", progress: 1, detail: `${mine} unspent note${mine === 1 ? "" : "s"} · synced to block ${toBlock}` });
          return { notes: owned, tree: t };
        } catch {
          // fall through to a full scan
        }
      }
      try {
        setScan({ phase: "logs", progress: 0, detail: "Reading the pool's history through Anon-RPC…" });
        const state = await fetchPoolState(client as never, DEPLOYMENT.pool, DEPLOYMENT.deployBlock, {
          onProgress: (done, total) => {
            if (!live() || total === 0n) return;
            const f = Number((done * 1000n) / total) / 1000;
            setScan({ phase: "logs", progress: 0.7 * f, detail: `Scanned ${done.toLocaleString()} of ${total.toLocaleString()} blocks` });
          },
        });
        if (!live()) return null;
        setScan({ phase: "decrypt", progress: 0.7, detail: `Trying ${state.leaves.length} note backups with your viewing key…` });
        const owned = await scanNotes(k, state.leaves, (h) => state.nullifiers.has(h), (done, total) => {
          if (live() && total > 0) setScan({ phase: "decrypt", progress: 0.7 + 0.3 * (done / total), detail: `Decrypted ${done} of ${total} backups` });
        });
        if (!live()) return null;
        cache.current = { state, owned };
        const t = new MerkleTree(state.leaves.map((l) => l.leaf));
        setNotes(owned);
        setTree(t);
        const mine = owned.filter((n) => !n.spent).length;
        setScan({ phase: "done", progress: 1, detail: `${mine} unspent note${mine === 1 ? "" : "s"} found in ${state.leaves.length} leaves` });
        return { notes: owned, tree: t };
      } catch (e) {
        if (live()) setScan({ phase: "error", progress: 0, detail: "Scan failed", error: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [client],
  );

  const unlock = useCallback(async () => {
    setUnlocking(true);
    try {
      const k = keysFromSignature(await signMessageAsync({ message: KEY_MESSAGE }));
      setKeys(k);
      void runScan(k);
      // Load bb.js, the circuits and the proving setup while the user looks around.
      void getProver().then((p) => p.warm()).catch(() => undefined);
    } finally {
      setUnlocking(false);
    }
  }, [signMessageAsync, runScan]);

  const lock = useCallback(() => {
    scanId.current++;
    setKeys(null);
    setNotes([]);
    setTree(null);
    setScan({ phase: "idle", progress: 0, detail: "" });
    cache.current = null;
  }, []);

  const rescan = useCallback(
    async (full = false) => {
      if (keys) await runScan(keys, !full);
    },
    [keys, runScan],
  );

  const sync = useCallback(async () => {
    if (!keys) throw new Error("Unlock your private account first");
    const fresh = await runScan(keys, true);
    if (!fresh) throw new Error("Couldn't read the pool. Try again.");
    return fresh;
  }, [keys, runScan]);

  const reserveIndices = useCallback((current: readonly OwnedNote[], count: number) => {
    const start = Math.max(nextNoteIndex(current), reserved.current);
    reserved.current = start + count;
    return start;
  }, []);

  const balances = { usdc: shieldedBalance(notes, ASSET.USDC), weth: shieldedBalance(notes, ASSET.WETH) };

  return (
    <Ctx.Provider value={{ keys, unlocking, unlock, lock, notes, tree, scan, rescan, sync, reserveIndices, balances }}>{children}</Ctx.Provider>
  );
}
