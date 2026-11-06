import { formatEther, formatUnits } from "viem";
import { Status, USDC_DECIMALS } from "./contract";
import type { MarketView } from "@/hooks/useMarkets";

/// Status as the UI shows it: an open market past its close time is "Closed"
/// (betting over, waiting for the CRE resolver).
export function statusLabel(m: MarketView, nowSec = Date.now() / 1000): string {
  if (m.status === Status.Open) return Number(m.closeTime) <= nowSec ? "Closed" : "Open";
  if (m.status === Status.Cancelled && m.pot === 0n) return "No bets";
  return ["", "Open", "Resolved", "Cancelled"][m.status] ?? "Unknown";
}
export function statusClass(m: MarketView, nowSec = Date.now() / 1000): string {
  if (m.status === Status.Open) return Number(m.closeTime) <= nowSec ? "resolved" : "open";
  return m.status === Status.Resolved ? "settled" : "resolved";
}

/// Implied probability of each side from the public side totals (pari-mutuel).
export function impliedOdds(totals: readonly bigint[]): number[] {
  const sum = totals.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return totals.map(() => 1 / Math.max(totals.length, 1));
  return totals.map((t) => Number((t * 10_000n) / sum) / 10_000);
}

/// Render a WETH amount (18 decimals) compactly.
export function weth(base: bigint, digits = 6): string {
  const v = Number(formatEther(base));
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} WETH`;
}

/// Chainlink price feeds use 8 decimals; render the threshold as USD.
export function usd(threshold: bigint): string {
  const dollars = Number(threshold) / 1e8;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/// Render a USDC base-unit amount (6 decimals) as "$1.23".
export function usdc(base: bigint, digits = 2): string {
  const v = Number(formatUnits(base, USDC_DECIMALS));
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits });
}

export function whenResolves(resolveAfter: bigint): string {
  const d = new Date(Number(resolveAfter) * 1000);
  const now = Date.now();
  const ms = d.getTime() - now;
  if (ms <= 0) return `resolvable now`;
  const hrs = Math.round(ms / 3.6e6);
  return hrs >= 24 ? `in ${Math.round(hrs / 24)}d` : `in ${hrs}h`;
}

/// Plain USD (8-decimal Chainlink price) with cents, for live tickers/tooltips.
export function priceUsd(scaled: number, digits = 2): string {
  return scaled.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/// Compact USDC, e.g. "$1.24" / "$12.3k", for dense stat rows.
export function usdcCompact(base: bigint): string {
  const v = Number(formatUnits(base, USDC_DECIMALS));
  if (v >= 1000) return `$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/// Split a remaining-seconds count into d/h/m/s for a ticking countdown.
export function splitDuration(secondsLeft: number): { d: number; h: number; m: number; s: number } {
  const s = Math.max(0, Math.floor(secondsLeft));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/// Compact countdown string, e.g. "2d 04h", "58m 12s", or "resolvable".
export function countdownLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return "resolvable";
  const { d, h, m, s } = splitDuration(secondsLeft);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

