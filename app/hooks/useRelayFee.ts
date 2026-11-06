"use client";

import { useQuery } from "@tanstack/react-query";
import type { SpendAction } from "@quietodds/lib";
import { ASSET } from "@quietodds/lib";
import { relayer, spendFee } from "@/lib/private";

/// The relayer's fee floors (relayer/src/config.ts), shown until a quote loads.
const FLOOR = { usdc: 50_000n, weth: 20_000_000_000_000n };

/// The relayer's current fee for one private action (refreshed every minute).
export function useRelayFee(action: SpendAction["type"], asset: bigint): bigint {
  const { data } = useQuery({ queryKey: ["relay-quote"], queryFn: () => relayer.quote(), staleTime: 60_000, refetchInterval: 60_000 });
  return data ? spendFee(data, action, asset) : asset === ASSET.USDC ? FLOOR.usdc : FLOOR.weth;
}
