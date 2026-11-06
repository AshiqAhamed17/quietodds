"use client";

import { useQuery } from "@tanstack/react-query";
import { formatEther, formatUnits } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSignTypedData } from "wagmi";
import { ActionStatus, useAction } from "./ActionStatus";
import { DEPLOYMENT } from "@/lib/contract";
import { ETH, uniswapApi } from "@/lib/uniswapApi";

/// The same swap quoted by the Uniswap Trading API (public routes, no hook),
/// with a button to execute it there: a plain "cash out" swap with no shield.
export function ApiSwap({ usdcIn, amountIn, ourOut }: { usdcIn: boolean; amountIn: bigint; ourOut?: bigint }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { state, run } = useAction();
  const tokenIn = usdcIn ? DEPLOYMENT.usdc : ETH;
  const tokenOut = usdcIn ? ETH : DEPLOYMENT.usdc;

  const { data, error, isFetching } = useQuery({
    queryKey: ["uniswap-api", usdcIn, amountIn.toString(), address],
    enabled: !!address && amountIn > 0n,
    queryFn: () => uniswapApi.quote({ tokenIn, tokenOut, amount: amountIn, swapper: address! }),
    staleTime: 20_000,
    retry: false,
  });
  const out = data ? BigInt(data.quote.output.amount) : undefined;
  const fmt = (v: bigint) => (usdcIn ? `${Number(formatEther(v)).toFixed(6)} ETH` : `${Number(formatUnits(v, 6)).toFixed(2)} USDC`);

  const swap = () =>
    run(async (onStep) => {
      onStep("relay");
      const send = async (tx: { to: `0x${string}`; data: `0x${string}`; value?: string }) => {
        const hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
        const r = await client!.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
        return hash;
      };
      if (usdcIn) {
        const { approval } = await uniswapApi.checkApproval({ walletAddress: address!, token: tokenIn, amount: amountIn });
        if (approval) await send(approval);
      }
      const q = await uniswapApi.quote({ tokenIn, tokenOut, amount: amountIn, swapper: address! });
      let signature: `0x${string}` | undefined;
      if (q.permitData) {
        const { domain, types, values } = q.permitData;
        const primaryType = Object.keys(types).find((t) => t !== "EIP712Domain")!;
        signature = await signTypedDataAsync({ domain, types, primaryType, message: values } as never);
      }
      const { swap } = await uniswapApi.swap(q, signature);
      const hash = await send(swap);
      const legs = (q.quote.routeString ?? "").split(",").filter(Boolean).length;
      return { txHash: hash, summary: `Swapped through the Uniswap Trading API (${q.routing}${legs ? `, split over ${legs} route${legs > 1 ? "s" : ""}` : ""}).` };
    });

  if (amountIn <= 0n) return null;
  return (
    <div className="api-swap">
      <div className="kv">
        <span>Uniswap Trading API, best public route (no hook, no shield)</span>
        <b>{error ? "unavailable" : isFetching && !out ? "…" : out !== undefined ? fmt(out) : "—"}</b>
      </div>
      {out !== undefined && ourOut !== undefined && ourOut > 0n && (
        <p className="hint">
          {ourOut >= out
            ? `Our hooked pool gives ${(Number(ourOut) / Number(out || 1n)).toFixed(1)}× more here. The API can't route through it, because it can't pass the hook's data.`
            : "The API's public routes beat our pool on this size."}
        </p>
      )}
      <button className="btn" onClick={() => void swap()} disabled={state.busy || !out}>
        {state.busy ? "Working…" : "Plain swap via the Uniswap API instead"}
      </button>
      <ActionStatus state={state} steps={{ relay: "Approve / sign / confirm in your wallet" }} />
    </div>
  );
}
