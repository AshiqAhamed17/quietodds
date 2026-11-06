"use client";

/// Delayed private bets (swap-and-bet). Only the *intent* is stored, in this
/// browser's localStorage, per wallet: market, side, amount, due time. No keys
/// or notes: the bet is proven when it's due, from the unlocked account. If the
/// tab was closed, due bets run the next time the account is unlocked.

export interface QueuedBet {
  id: number;
  market: string; // bigint as string
  question: string;
  side: number;
  sideLabel: string;
  amount: string; // USDC base units
  dueAt: number;
  status: "waiting" | "betting" | "done" | "failed";
  detail?: string;
  tx?: string;
}

const KEY = (address: string) => `quietodds:bets:${address.toLowerCase()}`;
const listeners = new Set<() => void>();
const cache = new Map<string, QueuedBet[]>();

function read(address: string): QueuedBet[] {
  const k = KEY(address);
  if (!cache.has(k)) {
    let list: QueuedBet[] = [];
    try {
      list = JSON.parse(localStorage.getItem(k) ?? "[]") as QueuedBet[];
    } catch {
      list = [];
    }
    // A bet interrupted mid-proof (tab closed) goes back to waiting.
    cache.set(k, list.map((b) => (b.status === "betting" ? { ...b, status: "waiting", detail: undefined } : b)));
  }
  return cache.get(k)!;
}

function write(address: string, list: QueuedBet[]) {
  const k = KEY(address);
  cache.set(k, list);
  try {
    localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
  } catch {
    // storage blocked: the queue lasts for this tab only
  }
  listeners.forEach((l) => l());
}

export const betQueue = {
  list: (address: string | undefined) => (address ? read(address) : []),
  add(address: string, bet: Omit<QueuedBet, "id" | "status">) {
    write(address, [{ ...bet, id: Date.now(), status: "waiting" }, ...read(address)]);
  },
  update(address: string, id: number, patch: Partial<QueuedBet>) {
    write(address, read(address).map((b) => (b.id === id ? { ...b, ...patch } : b)));
  },
  remove(address: string, id: number) {
    write(address, read(address).filter((b) => b.id !== id));
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
