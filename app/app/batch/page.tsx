"use client";

import { useState } from "react";
import { explorerTx } from "@/lib/contract";
import { formatUnits, parseUnits } from "viem";
import { usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import Link from "next/link";
import { ASSET, spendableNotes, unspentTickets } from "@quietodds/lib";
import { AmbientField } from "@/components/AmbientField";
import { ActionStatus, useAction } from "@/components/ActionStatus";
import { Countdown } from "@/components/Countdown";
import { PrivateGate } from "@/components/PrivateGate";
import { usePrivateAccount } from "@/components/PrivateAccount";
import { RedeemRow } from "@/components/RedeemRow";
import { DEPLOYMENT, batchSwapperAbi, explorerAddress } from "@/lib/contract";
import { relayedSpend } from "@/lib/private";
import { useRelayFee } from "@/hooks/useRelayFee";
import { AmountInput, TokenIcon } from "@/components/Token";

const DIRECTIONS = [
  { dir: 0, label: "USDC → WETH", asset: ASSET.USDC, inSym: "USDC", outSym: "WETH", inDec: 6, outDec: 18, def: "1", min: 1_000_000n },
  { dir: 1, label: "WETH → USDC", asset: ASSET.WETH, inSym: "WETH", outSym: "USDC", inDec: 18, outDec: 6, def: "0.0005", min: 500_000_000_000_000n },
] as const;

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: d === 6 ? 2 : 6 });

export default function BatchPage() {
  const acct = usePrivateAccount();
  const tickets = unspentTickets(acct.notes);
  const [recent, setRecent] = useState<{ summary: string; tx: string }[]>([]);
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Private batch swaps · Uniswap v4</p>
        <h1>Batch swap privately</h1>
        <p className="lead">
          Join a batch from your private balance. Every 5 minutes after its first join, the batch swaps as <b>one</b> trade
          through our Uniswap v4 pool (inside a PoolManager unlock), at a floor set by Chainlink. Everyone gets the same
          price, pro rata, and claims it privately. On chain each join is just &quot;someone added X&quot;.
        </p>
        <div className="two-col">
          {DIRECTIONS.map((d) => (
            <BatchCard key={d.dir} d={d} />
          ))}
        </div>
        <section className="panel" style={{ marginTop: "1.4rem" }}>
          <h2>Your batch tickets</h2>
          <PrivateGate compact>
            {tickets.length === 0 ? (
              <p className="hint">No open tickets. Join a batch above.</p>
            ) : (
              <div className="obc-list">
                {tickets.map((n) => (
                  <RedeemRow key={n.leafIndex} note={n} onDone={(summary, tx) => setRecent((x) => [{ summary, tx }, ...x])} />
                ))}
              </div>
            )}
          </PrivateGate>
          {recent.map((x) => (
            <p key={x.tx} className="hint mono">
              {x.summary}{" "}
              <a href={explorerTx(x.tx)} target="_blank" rel="noreferrer">
                View tx ↗
              </a>
            </p>
          ))}
        </section>
        <p className="hint" style={{ marginTop: "1rem" }}>
          The Chainlink CRE workflow executes ready batches automatically; anyone can also press Execute.{" "}
          <a href={explorerAddress(DEPLOYMENT.batches)} target="_blank" rel="noreferrer">
            BatchSwapper ↗
          </a>
        </p>
      </main>
    </>
  );
}

function BatchCard({ d }: { d: (typeof DIRECTIONS)[number] }) {
  const acct = usePrivateAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState<string>(d.def);
  const join = useAction();
  const exec = useAction();

  const { data: id, refetch: refetchId } = useReadContract({
    abi: batchSwapperAbi,
    address: DEPLOYMENT.batches,
    functionName: "currentBatch",
    args: [d.dir],
    query: { refetchInterval: 15_000 },
  });
  const { data: info, refetch } = useReadContracts({
    contracts: [
      { abi: batchSwapperAbi, address: DEPLOYMENT.batches, functionName: "getBatch", args: [id ?? 0n] },
      { abi: batchSwapperAbi, address: DEPLOYMENT.batches, functionName: "isExecutable", args: [id ?? 0n] },
      { abi: batchSwapperAbi, address: DEPLOYMENT.batches, functionName: "BATCH_INTERVAL" },
      { abi: batchSwapperAbi, address: DEPLOYMENT.batches, functionName: "slippageBps" },
    ],
    query: { enabled: id !== undefined, refetchInterval: 15_000 },
  });
  const batch = info?.[0]?.result as { totalIn: bigint; firstJoinAt: bigint } | undefined;
  const ready = info?.[1]?.result as boolean | undefined;
  const interval = (info?.[2]?.result as bigint | undefined) ?? 300n;
  const slippage = info?.[3]?.result as bigint | undefined;
  const { data: floor } = useReadContract({
    abi: batchSwapperAbi,
    address: DEPLOYMENT.batches,
    functionName: "minOutFor",
    args: [d.dir, batch?.totalIn ?? 0n],
    query: { enabled: !!batch && batch.totalIn > 0n },
  });

  const priv = d.asset === ASSET.USDC ? acct.balances.usdc : acct.balances.weth;
  // A join spends one note, so what matters is the biggest note, not the total.
  const notes = spendableNotes(acct.notes, d.asset).map((n) => (n.data.kind === "balance" ? n.data.amount : 0n));
  const largest = notes[0] ?? 0n;
  const fee = useRelayFee("batchJoin", d.asset);
  const maxJoin = largest > fee ? largest - fee : 0n;
  const tooSmall = acct.scan.phase === "done" && maxJoin < d.min;
  let parsed: bigint | null = null;
  try {
    parsed = parseUnits(amount || "0", d.inDec);
  } catch {
    parsed = null;
  }
  const amountError =
    parsed === null
      ? "Enter a number"
      : parsed < d.min
        ? `The batch minimum is ${fmt(d.min, d.inDec)} ${d.inSym}`
        : acct.scan.phase === "done" && !tooSmall && parsed > maxJoin
          ? `Your biggest note allows up to ${fmt(maxJoin, d.inDec)} ${d.inSym}`
          : null;

  const doJoin = () =>
    join.run(async (onStep) => {
      if (id === undefined) throw new Error("Batch not loaded yet");
      const r = await relayedSpend({
        account: acct,
        asset: d.asset,
        amount: parseUnits(amount, d.inDec),
        action: { type: "batchJoin", batch: id },
        onStep,
      });
      void refetch();
      return { txHash: r.txHash, summary: `Joined batch #${id} with ${fmt(r.amount, d.inDec)} ${d.inSym}. Your ticket is below.` };
    });

  const doExec = () =>
    exec.run(async (onStep) => {
      onStep("relay");
      const hash = await writeContractAsync({ abi: batchSwapperAbi, address: DEPLOYMENT.batches, functionName: "executeBatch", args: [id!] });
      const r = await client!.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`Execution reverted: ${hash}`);
      void refetchId();
      void refetch();
      void acct.rescan();
      return { txHash: hash, summary: `Batch #${id} swapped in one trade. Redeem your ticket below.` };
    });

  return (
    <section className="panel">
      <h2>
        <span className="pair">
          <TokenIcon symbol={d.inSym} size={26} />
          <TokenIcon symbol={d.outSym} size={26} />
        </span>
        {d.inSym} → {d.outSym} <span className="muted mono">#{id?.toString() ?? "…"}</span>
      </h2>
      <div className="detail-metrics">
        <div className="kv">
          <span>Pooled so far</span>
          <b>
            {batch ? fmt(batch.totalIn, d.inDec) : "…"} {d.inSym}
          </b>
        </div>
        <div className="kv">
          <span>Swaps</span>
          <b>
            {!batch || batch.totalIn === 0n ? (
              "after the first join + 5 min"
            ) : ready ? (
              "ready now"
            ) : (
              <Countdown resolveAfter={batch.firstJoinAt + interval} />
            )}
          </b>
        </div>
        {floor !== undefined && (
          <div className="kv">
            <span>Oracle floor ({slippage !== undefined ? `${Number(slippage) / 100}%` : "…"} below Chainlink)</span>
            <b>
              {fmt(floor, d.outDec)} {d.outSym}
            </b>
          </div>
        )}
      </div>
      <PrivateGate compact>
        <div className="form" style={{ marginTop: "0.9rem" }}>
          <label>
            Join with
            <span className="input-row">
              <AmountInput symbol={d.inSym} value={amount} onChange={setAmount} disabled={tooSmall} />
              {acct.scan.phase === "done" && maxJoin >= d.min && (
                <button type="button" className="btn ghost" onClick={() => setAmount(formatUnits(maxJoin, d.inDec))}>
                  Max
                </button>
              )}
            </span>
          </label>
          <div className="note-facts">
            <span>
              Private total <b>{fmt(priv, d.inDec)}</b>
            </span>
            <span>
              Biggest note <b>{fmt(largest, d.inDec)}</b>
            </span>
            <span>
              Relayer fee <b>{fmt(fee, d.inDec)}</b>
            </span>
          </div>
          {tooSmall ? (
            <div className="callout">
              <p>
                <b>None of your {d.inSym} notes is big enough to join.</b> A private action spends one note, and a join
                needs at least {fmt(d.min, d.inDec)} {d.inSym} plus the {fmt(fee, d.inDec)} {d.inSym} relayer fee.
                {notes.length > 1 && (
                  <>
                    {" "}
                    Your notes: {notes.map((n) => fmt(n, d.inDec)).join(", ")} {d.inSym}.
                  </>
                )}
              </p>
              <Link className="btn" href="/deposit">
                Deposit {fmt(d.min + fee, d.inDec)} {d.inSym} or more
              </Link>
            </div>
          ) : (
            amountError && <p className="field-error">{amountError}</p>
          )}
          <button className="btn primary" onClick={() => void doJoin()} disabled={join.state.busy || tooSmall || !!amountError}>
            {join.state.busy ? "Working…" : `Join privately`}
          </button>
          <ActionStatus state={join.state} />
          {ready && (
            <>
              <button className="btn" onClick={() => void doExec()} disabled={exec.state.busy}>
                {exec.state.busy ? "Executing…" : "Execute batch now"}
              </button>
              <ActionStatus state={exec.state} steps={{ relay: "Confirm in your wallet" }} />
            </>
          )}
        </div>
      </PrivateGate>
    </section>
  );
}
