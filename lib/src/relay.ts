// Client for the relayer's HTTP API. Bigints travel as decimal strings.
import type { Hex } from "viem";
import type { RedeemArgs, RedeemPlan, SpendArgs, SpendPlan } from "./witness.ts";

export interface RelayResult {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: string;
  gasUsed: string;
}

export interface RelayQuote {
  relayer: `0x${string}`;
  chainId: number;
  gasPrice: string;
  validForSeconds: number;
  fees: { withdraw: { usdc: string; weth: string }; bet: { usdc: string }; redeem: { usdc: string } };
}

const strings = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

export const spendBody = (plan: Pick<SpendPlan, "args" | "changeCiphertext" | "outCiphertext">, proof: Hex) => ({
  args: strings<SpendArgs>(plan.args),
  proof,
  changeCiphertext: plan.changeCiphertext,
  outCiphertext: plan.outCiphertext,
});

export const redeemBody = (plan: Pick<RedeemPlan, "args" | "outCiphertext">, proof: Hex) => ({
  args: strings<RedeemArgs>(plan.args),
  proof,
  outCiphertext: plan.outCiphertext,
});

export class RelayerHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RelayerHttpError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const relayerApi = (baseUrl: string, fetchFn: typeof fetch = fetch) => ({
  quote: () => call<RelayQuote>(`${baseUrl}/fee-quote`, undefined, fetchFn),
  health: () => call<Record<string, unknown>>(`${baseUrl}/health`, undefined, fetchFn),
  spend: (body: ReturnType<typeof spendBody>) => call<RelayResult>(`${baseUrl}/spend`, post(body), fetchFn),
  redeem: (body: ReturnType<typeof redeemBody>) => call<RelayResult>(`${baseUrl}/redeem`, post(body), fetchFn),
});
