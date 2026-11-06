"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DEPLOYMENT, Source, Status, explorerAddress, feedLabel } from "@/lib/contract";
import { isClosed, useMarket } from "@/hooks/useMarkets";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { statusClass, statusLabel, usd, usdc } from "@/lib/format";
import { ChartPanel } from "@/components/ChartPanel";
import { Countdown } from "@/components/Countdown";
import { AmbientField } from "@/components/AmbientField";
import { SourceChip } from "@/components/MarketList";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export default function MarketDetailPage() {
  const params = useParams();
  const id = BigInt((params.id as string) || "1");
  const { market: m } = useMarket(id);
  const isFeed = m?.source === Source.Price;
  const { points, current } = usePriceHistory(isFeed && m ? m.priceFeed : ZERO);

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <Link href="/markets" className="back-link mono">← All markets</Link>

        {!m ? (
          <p className="muted mono" style={{ marginTop: "1.4rem" }}>Loading market #{id.toString()}…</p>
        ) : (
          <>
            <div className="detail-head">
              <div>
                <span className="card-cat mono">{m.category}</span>
                <h1 className="detail-title">{m.question}</h1>
              </div>
              <div className="detail-tags">
                <span className={`pill ${statusClass(m)}`}>{statusLabel(m)}</span>
                <SourceChip source={m.source} />
              </div>
            </div>

            <div className="detail-grid">
              <section className="panel detail-main">
                {isFeed && <ChartPanel feed={m.priceFeed} threshold={Number(m.threshold) / 1e8} points={points} height={300} />}
                <OutcomeBoard
                  labels={m.outcomes}
                  totals={m.sideTotals}
                  pot={m.pot}
                  winning={m.status === Status.Resolved ? m.winningSide : undefined}
                />
              </section>

              <aside className="panel detail-side">
                <div className="detail-metrics">
                  {isFeed && (
                    <Metric
                      k={`Live ${feedLabel(m.priceFeed).asset}`}
                      v={current === null ? "—" : `$${current.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    />
                  )}
                  {isFeed && <Metric k="YES if above" v={usd(m.threshold)} />}
                  <Metric k="Pot" v={usdc(m.pot)} />
                  <Metric k="Outcomes" v={m.numSides.toString()} />
                  {m.status === Status.Resolved ? (
                    <Metric k="Result" v={m.outcomes[m.winningSide]} />
                  ) : m.status === Status.Cancelled ? (
                    <Metric k="Result" v="Cancelled: refunds" />
                  ) : (
                    <Metric k={isClosed(m) ? "Closed" : "Closes"} v="" node={<Countdown resolveAfter={m.closeTime} />} />
                  )}
                </div>

                {m.status === Status.Open && !isClosed(m) ? (
                  <Link className="btn primary detail-cta" href={`/markets/${id.toString()}#bet`}>
                    Bet privately
                  </Link>
                ) : m.status === Status.Open ? (
                  <div className="note">Betting closed. The Chainlink CRE workflow resolves it shortly.</div>
                ) : (
                  <Link className="btn primary detail-cta" href="/portfolio">
                    {m.status === Status.Cancelled ? "Claim your refund" : "Claim your winnings"}
                  </Link>
                )}

                <p className="hint">
                  Bets are placed from your private balance through a relayer, so your wallet never appears. Only the
                  side totals above are public.{" "}
                  {isFeed
                    ? "Resolves permissionlessly from the Chainlink feed."
                    : `Resolved by a Chainlink CRE workflow reading ${m.sourceRef.replace(/^espn:/, "ESPN ")}.`}
                </p>
                <a className="doclink mono" href={explorerAddress(DEPLOYMENT.markets)} target="_blank" rel="noreferrer">
                  Markets contract ↗
                </a>
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Metric({ k, v, node }: { k: string; v: string; node?: React.ReactNode }) {
  return (
    <div className="detail-metric">
      <span className="detail-metric-k mono">{k}</span>
      <span className="detail-metric-v">{node ?? v}</span>
    </div>
  );
}

/// Each side's share of the pot: the public aggregate. Individual bets stay private.
function OutcomeBoard({ labels, totals, pot, winning }: { labels: string[]; totals: readonly bigint[]; pot: bigint; winning?: number }) {
  return (
    <div className="obc">
      <p className="obc-title">Live odds</p>
      <div className="obc-list">
        {labels.map((label, i) => {
          const t = totals[i] ?? 0n;
          const pct = pot > 0n ? Number((t * 10000n) / pot) / 100 : 0;
          const isWin = winning === i;
          return (
            <div key={i} className={`obc-row ${isWin ? "win" : ""}`}>
              <div className="obc-bar" style={{ width: `${Math.max(pct, 2)}%` }} />
              <span className="obc-label">{label}{isWin && " ✓"}</span>
              <span className="obc-share mono">{pct.toFixed(0)}% · {usdc(t)}</span>
            </div>
          );
        })}
      </div>
      <p className="hint">Pari-mutuel: winners split the pot (less a 1% fee donated to Uniswap LPs) in proportion to their stake.</p>
    </div>
  );
}
