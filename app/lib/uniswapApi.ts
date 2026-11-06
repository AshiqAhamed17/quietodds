"use client";

/// The Uniswap Trading API, through our server route (the API key never reaches
/// the browser). It routes across Uniswap's public pools but can't pass
/// hookData, so it can't shield; we use it for comparison quotes and plain swaps.
export const ETH = "0x0000000000000000000000000000000000000000" as const;

export interface ApiQuote {
  routing: string;
  permitData: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; values: Record<string, unknown> } | null;
  quote: {
    input: { amount: string; token: string };
    output: { amount: string; token: string; minimumAmount?: string };
    priceImpact?: number;
    routeString?: string;
    [k: string]: unknown;
  };
}

export interface ApiTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}

async function post<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/uniswap/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { detail?: string; error?: string }).detail ?? (json as { error?: string }).error ?? `Uniswap API ${res.status}`);
  return json as T;
}

export const uniswapApi = {
  quote: (p: { tokenIn: string; tokenOut: string; amount: bigint; swapper: string }) =>
    post<ApiQuote>("quote", {
      type: "EXACT_INPUT",
      amount: p.amount.toString(),
      tokenInChainId: 11155111,
      tokenOutChainId: 11155111,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      swapper: p.swapper,
      routingPreference: "BEST_PRICE",
    }),
  checkApproval: (p: { walletAddress: string; token: string; amount: bigint }) =>
    post<{ approval: ApiTx | null }>("check_approval", { walletAddress: p.walletAddress, token: p.token, amount: p.amount.toString(), chainId: 11155111 }),
  swap: (q: ApiQuote, signature?: `0x${string}`) =>
    post<{ swap: ApiTx }>("swap", signature && q.permitData ? { quote: q.quote, signature, permitData: q.permitData } : { quote: q.quote }),
};
