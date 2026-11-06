"use client";

import { useEffect, useSyncExternalStore } from "react";
import { anonState, loadAnonPreference, setAnonEnabled, subscribeAnon, type AnonStatus } from "@/lib/anonRpc";

const LABEL: Record<AnonStatus, string> = {
  on: "Reads via Anon-RPC",
  connecting: "Connecting to Anon-RPC…",
  failed: "Anon-RPC down · direct reads",
  off: "Direct reads",
};

const TITLE: Record<AnonStatus, string> = {
  on: "Every read (odds, pool state, your note scan) goes through the EF's Anon-RPC mixnet, so the RPC node can't link your IP to what you look at. Click to switch to faster direct reads.",
  connecting: "Bootstrapping the Anon-RPC worker (~10s). Reads wait for it.",
  failed: "Anon-RPC couldn't start, so reads go straight to the RPC node. Click to retry.",
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
