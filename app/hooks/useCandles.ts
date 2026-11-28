"use client";

import { useEffect, useState } from "react";

export interface Candle {
  time: number; // unix seconds (UTCTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
}

/// Verified Sepolia feed → Coinbase spot product. Only crypto has a keyless
/// exchange candle source; gold/forex fall back to the line chart.
const COINBASE_PRODUCT: Record<string, string> = {
  "0x694aa1769357215de4fac081bf1f309adc325306": "ETH-USD",
  "0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43": "BTC-USD",
  "0xc59e3633baac79493d908e63626716e204a45edf": "LINK-USD",
};

/// The Coinbase product for a feed, or null if we have no candle source for it.
export function candleProductForFeed(feed?: string): string | null {
  if (!feed) return null;
  return COINBASE_PRODUCT[feed.toLowerCase()] ?? null;
}

const NO_CANDLES: Candle[] = [];

/// Real OHLC candles from Coinbase's keyless public API (CORS-enabled, no key).
/// Fetches lazily — only when `product` is non-null (i.e. the candle view is
/// active). This is reference spot data, distinct from the Chainlink feed that
/// actually resolves the market (which the line view shows).
export function useCandles(product: string | null, granularity = 3600): {
  candles: Candle[];
  loading: boolean;
  error: boolean;
} {
  // The last result, tagged with the request it answers; anything else is still loading.
  const key = product ? `${product}:${granularity}` : null;
  const [res, setRes] = useState<{ key: string; candles: Candle[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!product) return;
    const key = `${product}:${granularity}`;
    let alive = true;

    fetch(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: number[][]) => {
        if (!alive) return;
        // Coinbase rows: [time, low, high, open, close, volume], newest first.
        const seen = new Set<number>();
        const cs = rows
          .map(([t, low, high, open, close]) => ({ time: t, open, high, low, close }))
          .filter((c) => (seen.has(c.time) ? false : seen.add(c.time)))
          .sort((a, b) => a.time - b.time);
        setRes({ key, candles: cs, error: false });
      })
      .catch(() => alive && setRes({ key, candles: [], error: true }));

    return () => {
      alive = false;
    };
  }, [product, granularity]);

  if (!key) return { candles: NO_CANDLES, loading: false, error: false };
  const mine = res?.key === key ? res : null;
  return { candles: mine?.candles ?? NO_CANDLES, loading: !mine, error: mine?.error ?? false };
}
