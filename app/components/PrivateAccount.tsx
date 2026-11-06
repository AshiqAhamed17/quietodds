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
} from "@quietodds/lib";
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
  rescan: () => Promise<void>;
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

  // A different wallet is a different private account.
  useEffect(() => {
    setKeys(null);
    setNotes([]);
    setTree(null);
    setScan({ phase: "idle", progress: 0, detail: "" });
    reserved.current = 0;
  }, [address]);

  const runScan = useCallback(
    async (k: Keys): Promise<{ notes: OwnedNote[]; tree: MerkleTree } | null> => {
      if (!client) return null;
      const id = ++scanId.current;
      const live = () => id === scanId.current;
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
  }, []);

  const rescan = useCallback(async () => {
    if (keys) await runScan(keys);
  }, [keys, runScan]);

  const sync = useCallback(async () => {
    if (!keys) throw new Error("Unlock your private account first");
    const fresh = await runScan(keys);
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
