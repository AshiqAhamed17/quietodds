"use client";

/// Every read the app makes (odds, pool state, note scanning) goes through the
/// EF's Anon-RPC: a hash-pinned worker sends each request over a mixnet, so the
/// RPC node never learns which IP is looking at which markets or notes.
///
/// One long-lived worker per tab. Bootstrapping takes ~10s, so reads wait for
/// it; if it can't start, reads fall back to the direct RPC and the badge says
/// so. Wallet transactions go through the wallet's own RPC and are not covered.

export const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
/// The Nox specifier contract on Sepolia (deployments/sepolia.json).
const NOX_SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";
const PREF_KEY = "quietodds:anon-rpc";
const READY_TIMEOUT_MS = 45_000;

export type AnonStatus = "off" | "connecting" | "on" | "failed";

let status: AnonStatus = "off";
let enabled = true;
let worker: { fetch: typeof fetch; close(): void } | null = null;
let starting: Promise<boolean> | null = null;
let calls = 0;
const listeners = new Set<() => void>();

function set(s: AnonStatus) {
  status = s;
  listeners.forEach((l) => l());
}

export const anonState = () => ({ status, enabled, calls });
export function subscribeAnon(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/// Reads the user's choice (default on). Called once on the client.
export function loadAnonPreference() {
  try {
    enabled = localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    enabled = true;
  }
  if (!enabled) set("off");
}

export function setAnonEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // private mode: the choice lasts for this tab only
  }
  worker?.close();
  worker = null;
  starting = null;
  strikes = 0;
  retryDelay = 15_000;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!on) set("off");
  else void start();
}

/// Used once, only to read the public specifier contract; not anonymized.
const bootstrap = {
  request: async ({ method, params }: { method: string; params?: unknown }) => {
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

/// The mixnet drops the odd request; one miss shouldn't switch the whole tab to
/// direct reads. A failed request falls back on its own, and only a run of
/// misses restarts the worker, which then retries by itself with a backoff.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_STRIKES = 3;
let strikes = 0;
let retryDelay = 15_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/// True once a worker has run in this tab: later restarts don't block reads.
let everReady = false;

function scheduleRetry() {
  if (retryTimer || !enabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!enabled || worker) return;
    starting = null;
    void start();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 120_000);
}

function start(): Promise<boolean> {
  if (starting) return starting;
  set("connecting");
  starting = (async () => {
    try {
      const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
      const w = new AnonRpcWorker({ address: NOX_SPECIFIER, preExisting: { rpcProvider: bootstrap } } as never);
      await Promise.race([
        w.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Anon-RPC bootstrap timed out")), READY_TIMEOUT_MS)),
      ]);
      if (!enabled) {
        (w as unknown as { close(): void }).close();
        return false;
      }
      worker = w as unknown as { fetch: typeof fetch; close(): void };
      strikes = 0;
      retryDelay = 15_000;
      everReady = true;
      set("on");
      return true;
    } catch (e) {
      console.warn("Anon-RPC unavailable, reads use the direct RPC for now:", e);
      set("failed");
      scheduleRetry();
      return false;
    }
  })();
  return starting;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Anon-RPC request timed out")), ms))]);
}

/// viem `fetchFn`: through the mixnet when on, direct otherwise.
export const anonFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined" || !enabled) return fetch(input, init);
  if (!worker) {
    // First start: wait for the worker so no read leaks. A restart after a
    // failure: read directly meanwhile (the badge says so).
    if (everReady || status === "failed") {
      void start();
      return fetch(input, init);
    }
    if (!(await start())) return fetch(input, init);
  }
  calls++;
  listeners.forEach((l) => l());
  const w = worker!;
  try {
    const res = await withTimeout(w.fetch(input, init), REQUEST_TIMEOUT_MS);
    strikes = 0;
    return res;
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    strikes++;
    console.warn(`Anon-RPC request failed (${strikes}/${MAX_STRIKES}), this one goes direct:`, e);
    if (strikes >= MAX_STRIKES && worker === w) {
      worker.close();
      worker = null;
      starting = null;
      strikes = 0;
      set("failed");
      scheduleRetry();
    }
    return fetch(input, init);
  }
};
