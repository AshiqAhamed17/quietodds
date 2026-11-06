"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { DEPLOYMENT, Source, Status, marketsAbi } from "@/lib/contract";

export type MarketCategory = "Crypto" | "Football" | "F1";

/// One market as the UI sees it: Markets.getMarket + getSideTotals.
export interface MarketView {
  id: bigint;
  question: string;
  outcomes: string[];
  numSides: number;
  closeTime: bigint;
  source: Source;
  sourceRef: string;
  priceFeed: `0x${string}`;
  threshold: bigint;
  status: Status;
  winningSide: number;
  pot: bigint;
  protocolFee: bigint;
  sideTotals: bigint[];
  category: MarketCategory;
}

type RawMarket = {
  question: string;
  outcomes: string;
  numSides: number;
  closeTime: bigint;
  source: number;
  sourceRef: string;
  priceFeed: `0x${string}`;
  threshold: bigint;
  status: number;
  winningSide: number;
  pot: bigint;
  protocolFee: bigint;
};

export function toView(id: bigint, m: RawMarket, totals: readonly bigint[] | undefined): MarketView {
  const outcomes = m.outcomes.split("|").map((s) => s.trim());
  return {
    id,
    question: m.question,
    outcomes: outcomes.length === m.numSides ? outcomes : Array.from({ length: m.numSides }, (_, i) => `Side ${i + 1}`),
    numSides: m.numSides,
    closeTime: m.closeTime,
    source: m.source as Source,
    sourceRef: m.sourceRef,
    priceFeed: m.priceFeed,
    threshold: m.threshold,
    status: m.status as Status,
    winningSide: m.winningSide,
    pot: m.pot,
    protocolFee: m.protocolFee,
    sideTotals: totals ? [...totals] : Array(m.numSides).fill(0n),
    category: m.source === Source.Price ? "Crypto" : m.sourceRef.startsWith("espn:racing/") ? "F1" : "Football",
  };
}

/// "Open" on chain but past its close time: betting is over, awaiting the CRE resolver.
export const isClosed = (m: MarketView, nowSec = Date.now() / 1000) =>
  m.status === Status.Open && Number(m.closeTime) <= nowSec;

/// Every market (ids start at 1), with live side totals. Reads go through the
/// app's wagmi transport (Anon-RPC when enabled).
export function useMarkets(): { markets: MarketView[]; isLoading: boolean } {
  const { data: count, isLoading: loadingCount } = useReadContract({
    abi: marketsAbi,
    address: DEPLOYMENT.markets,
    functionName: "marketCount",
    query: { refetchInterval: 30_000 },
  });
  const n = Number(count ?? 0n);
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const { data: raw, isLoading: loadingMarkets } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { abi: marketsAbi, address: DEPLOYMENT.markets, functionName: "getMarket" as const, args: [id] as const },
      { abi: marketsAbi, address: DEPLOYMENT.markets, functionName: "getSideTotals" as const, args: [id] as const },
    ]),
    query: { enabled: n > 0, refetchInterval: 30_000 },
  });

  const markets = useMemo<MarketView[]>(() => {
    if (!raw) return [];
    const out: MarketView[] = [];
    ids.forEach((id, i) => {
      const m = raw[2 * i];
      const t = raw[2 * i + 1];
      if (m?.status !== "success") return;
      out.push(toView(id, m.result as unknown as RawMarket, t?.status === "success" ? (t.result as readonly bigint[]) : undefined));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return { markets, isLoading: loadingCount || loadingMarkets };
}

/// One market by id.
export function useMarket(id: bigint): { market: MarketView | undefined; refetch: () => void } {
  const { data, refetch } = useReadContracts({
    contracts: [
      { abi: marketsAbi, address: DEPLOYMENT.markets, functionName: "getMarket", args: [id] },
      { abi: marketsAbi, address: DEPLOYMENT.markets, functionName: "getSideTotals", args: [id] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const market = useMemo(() => {
    if (data?.[0]?.status !== "success") return undefined;
    const totals = data[1]?.status === "success" ? (data[1].result as readonly bigint[]) : undefined;
    return toView(id, data[0].result as unknown as RawMarket, totals);
  }, [data, id]);
  return { market, refetch: () => void refetch() };
}
