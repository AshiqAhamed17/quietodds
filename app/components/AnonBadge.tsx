"use client";

import { useEffect, useSyncExternalStore } from "react";
import { anonState, loadAnonPreference, setAnonEnabled, subscribeAnon, type AnonStatus } from "@/lib/anonRpc";
import { useEthPrice } from "@/hooks/useEthPrice";
import { priceUsd } from "@/lib/format";

const LABEL: Record<AnonStatus, string> = {
  on: "Reads via Anon-RPC",
  connecting: "Connecting to Anon-RPC…",
  failed: "Anon-RPC reconnecting · direct reads",
  off: "Direct reads",
};

const TITLE: Record<AnonStatus, string> = {
  on: "Every read (odds, pool state, your note scan) goes through the EF's Anon-RPC mixnet, so the RPC node can't link your IP to what you look at. Click to switch to faster direct reads.",
  connecting: "Bootstrapping the Anon-RPC worker (~10s). Reads wait for it.",
  failed: "The mixnet missed several reads in a row, so reads go straight to the RPC node while it reconnects on its own. Click to retry now.",
  off: "Reads go straight to the RPC node, which can see your IP. Click to anonymize them.",
};

let cached = anonState();
const snapshot = () => {
  const s = anonState();
  if (s.status !== cached.status || s.enabled !== cached.enabled || s.calls !== cached.calls) cached = s;
  return cached;
};
const server = () => cached;

/// The nav badge: honest, live status of where the app's reads go.
export function AnonBadge() {
  useEffect(() => loadAnonPreference(), []);
  const { status, calls } = useSyncExternalStore(subscribeAnon, snapshot, server);

  const toggle = () => setAnonEnabled(status === "off" || status === "failed");
  return (
    <button className={`anon-badge ${status} mono`} onClick={toggle} title={TITLE[status]} suppressHydrationWarning>
      <span className="anon-dot" />
      {LABEL[status]}
      {status === "on" && calls > 0 && <span className="anon-count">{calls}</span>}
    </button>
  );
}

const SHORT: Record<AnonStatus, string> = {
  on: "Anon-RPC",
  connecting: "Anon-RPC…",
  failed: "Reconnecting",
  off: "Direct reads",
};

/// Nav status: where the app's reads go (click to toggle Anon-RPC), and the
/// live Chainlink ETH/USD price read the same way.
export function StatusChip() {
  useEffect(() => loadAnonPreference(), []);
  const { status } = useSyncExternalStore(subscribeAnon, snapshot, server);
  const { price } = useEthPrice();
  const toggle = () => setAnonEnabled(status === "off" || status === "failed");
  return (
    <button className={`status-chip ${status}`} onClick={toggle} title={TITLE[status]} suppressHydrationWarning>
      <span className="anon-dot" aria-hidden />
      <span className="anon-label">{SHORT[status]}</span>
      <span className="sep" aria-hidden />
      <span className="px" title="Chainlink ETH/USD on Sepolia">
        ETH {price === null ? "…" : priceUsd(price, 0)}
      </span>
    </button>
  );
}
