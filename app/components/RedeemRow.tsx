"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContract } from "wagmi";
import { ASSET, type OwnedNote } from "@quietodds/lib";
import { usePrivateAccount } from "./PrivateAccount";
import { ActionStatus, useAction } from "./ActionStatus";
import { DEPLOYMENT, batchSwapperAbi } from "@/lib/contract";
import { redeemPreview, redeemTermsFor, relayedRedeem } from "@/lib/private";
import { usdc, weth } from "@/lib/format";
import type { MarketView } from "@/hooks/useMarkets";

const money = (v: bigint, asset: bigint) => (asset === ASSET.USDC ? usdc(v) : weth(v));

/// One position or batch ticket, with its claim/redeem button when settled.
export function RedeemRow({
  note,
  market,
  onDone,
}: {
  note: OwnedNote;
  market?: MarketView;
  /** The row disappears once its note is spent; the page keeps the result. */
  onDone?: (summary: string, txHash: string) => void;
}) {
  const client = usePublicClient();
  const acct = usePrivateAccount();
  const { state, run } = useAction();
  const { data: terms, isLoading } = useQuery({
    queryKey: ["terms", note.leafIndex, note.data.kind === "position" ? market?.status : 0],
    queryFn: () => redeemTermsFor(client!, note),
    enabled: !!client,
    refetchInterval: 30_000,
  });
  const batchId = note.data.kind === "ticket" ? note.data.batch : 0n;
  const { data: batch } = useReadContract({
    abi: batchSwapperAbi,
    address: DEPLOYMENT.batches,
    functionName: "getBatch",
    args: [batchId],
    query: { enabled: note.data.kind === "ticket" },
  });

  let title: React.ReactNode;
  let stake: string;
  if (note.data.kind === "position") {
    const side = market?.outcomes[Number(note.data.side)] ?? `side ${note.data.side}`;
    title = (
      <>
        <Link href={`/markets/${note.data.market}`}>{market?.question ?? `Market #${note.data.market}`}</Link> · {side}
      </>
    );
    stake = usdc(note.data.stake);
  } else if (note.data.kind === "ticket") {
    const usdcIn = batch ? batch.direction === 0 : true;
    title = <>Batch #{note.data.batch.toString()} · {usdcIn ? "USDC → WETH" : "WETH → USDC"}</>;
    stake = money(note.data.amountIn, usdcIn ? ASSET.USDC : ASSET.WETH);
  } else return null;

  const preview = terms ? redeemPreview(note, terms) : null;
  const claim = () =>
    run(async (onStep) => {
      const r = await relayedRedeem({ account: acct, client: client!, leafIndex: note.leafIndex, onStep });
      const summary = `Received ${money(r.amount, preview!.asset)} as a private note (fee ${money(r.fee, preview!.asset)}).`;
      onDone?.(summary, r.txHash);
      return { txHash: r.txHash, summary };
    });

  let right: React.ReactNode;
  if (isLoading) right = <span className="muted mono">…</span>;
  else if (!preview) right = <span className="muted mono">{note.data.kind === "ticket" ? "waiting for the batch" : "open"}</span>;
  else if (!preview.ok) right = <span className="tag-no mono">lost</span>;
  else if (state.step === "done") right = <span className="tag-yes mono">claimed ✓</span>;
  else
    right = (
      <button className="btn primary" onClick={() => void claim()} disabled={state.busy}>
        {state.busy ? "Working…" : `${note.data.kind === "ticket" ? "Redeem" : terms?.anySide ? "Refund" : "Claim"} ${money(preview.payout, preview.asset)}`}
      </button>
    );

  return (
    <div className="redeem-row">
      <div className="obc-row">
        <span className="obc-label">{title}</span>
        <span className="obc-share mono">{stake}</span>
        {right}
      </div>
      <ActionStatus state={state} />
    </div>
  );
}
