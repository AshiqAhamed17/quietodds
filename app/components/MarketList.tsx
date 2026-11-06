"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Source, Status, feedLabel } from "@/lib/contract";
import { impliedOdds, priceUsd, statusClass, statusLabel, usd, usdc, usdcCompact } from "@/lib/format";
import { isClosed, useMarkets, type MarketCategory, type MarketView } from "@/hooks/useMarkets";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { PriceChart } from "./PriceChart";
import { ChartPanel } from "./ChartPanel";
import { Countdown } from "./Countdown";

type Filter = "all" | "open" | "closed" | "resolved";
type Sort = "soon" | "pool" | "newest";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Awaiting result" },
  { key: "resolved", label: "Settled" },
];

type Cat = "Trending" | MarketCategory;
const CATEGORIES: { key: Cat; label: string }[] = [
  { key: "Trending", label: "Trending" },
  { key: "Football", label: "Football" },
  { key: "F1", label: "F1" },
  { key: "Crypto", label: "Crypto" },
];

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const isOpenNow = (m: MarketView) => m.status === Status.Open && !isClosed(m);

export function MarketList() {
  const { markets, isLoading } = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("soon");
  const [category, setCategory] = useState<Cat>("Trending");

  const stats = useMemo(() => {
    let pot = 0n;
    let open = 0;
    for (const m of markets) {
      pot += m.pot;
      if (isOpenNow(m)) open++;
    }
    return { pot, open, total: markets.length };
  }, [markets]);

  const catRows = useMemo(
    () => (category === "Trending" ? markets : markets.filter((m) => m.category === category)),
    [markets, category],
  );

  // Featured: the open price market closing soonest (it has a live chart).
  const featured = useMemo(() => {
    const open = catRows.filter((m) => isOpenNow(m) && m.source === Source.Price);
    return open.length ? [...open].sort((a, b) => Number(a.closeTime - b.closeTime))[0] : null;
  }, [catRows]);

  const shown = useMemo(() => {
    let list = catRows;
    if (filter === "open") list = list.filter(isOpenNow);
    if (filter === "closed") list = list.filter((m) => isClosed(m));
    if (filter === "resolved") list = list.filter((m) => m.status === Status.Resolved || m.status === Status.Cancelled);
    if (featured && (filter === "all" || filter === "open")) list = list.filter((m) => m.id !== featured.id);
    const arr = [...list];
    if (sort === "pool") arr.sort((a, b) => Number(b.pot - a.pot));
    else if (sort === "newest") arr.sort((a, b) => Number(b.id - a.id));
    else arr.sort((a, b) => Number(isOpenNow(b)) - Number(isOpenNow(a)) || Number(a.closeTime - b.closeTime));
    return arr;
  }, [catRows, filter, sort, featured]);

  if (isLoading) return <p className="muted mono">Loading markets on Sepolia…</p>;
  if (markets.length === 0) return <p className="muted">No markets yet. Check back soon.</p>;

  return (
    <>
      <p className="net-caption mono">On Sepolia</p>
      <div className="statrow">
        <Stat label="Markets" value={String(stats.total)} />
        <Stat label="Open now" value={String(stats.open)} />
        <Stat label="Staked privately" value={usdcCompact(stats.pot)} />
        <Stat label="Bettors revealed" value="0" accent />
      </div>

      <nav className="catbar" aria-label="Market categories">
        {CATEGORIES.map((c) => {
          const count = c.key === "Trending" ? markets.length : markets.filter((m) => m.category === c.key).length;
          return (
            <button key={c.key} className={`catbar-tab ${category === c.key ? "on" : ""}`} onClick={() => setCategory(c.key)}>
              {c.label}
              <span className="catbar-count mono">{count}</span>
            </button>
          );
        })}
      </nav>

      {featured && (filter === "all" || filter === "open") && <FeaturedMarket m={featured} />}

      <div className="filterbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="sortsel">
          <span className="mono">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="soon">Closing soon</option>
            <option value="pool">Pot size</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="muted" style={{ marginTop: "1.4rem" }}>Nothing here in this view.</p>
      ) : (
        <div className="grid">
          {shown.map((m, i) => (
            <MarketCard key={m.id.toString()} m={m} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label mono">{label}</span>
      <span className={`stat-value ${accent ? "accent" : ""}`}>{value}</span>
    </div>
  );
}

/// Names how a market resolves: a Chainlink feed, or the CRE workflow reading a sports API.
export function SourceChip({ source }: { source: Source }) {
  return source === Source.Price ? (
    <span className="src-chip src-feed mono">Chainlink feed</span>
  ) : (
    <span className="src-chip src-cre mono">Chainlink CRE · ESPN</span>
  );
}

function ThresholdDistance({ current, threshold }: { current: number | null; threshold: number }) {
  if (current === null) return <span className="dist muted mono">reading feed…</span>;
  const pct = ((current - threshold) / threshold) * 100;
  const over = current > threshold;
  return (
    <span className={`dist mono ${over ? "tag-yes" : "tag-no"}`}>
      {over ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}% {over ? "over" : "to target"}
    </span>
  );
}

/// Public side totals as a stacked bar: the only thing anyone learns about the bets.
export function OddsBar({ m }: { m: MarketView }) {
  const odds = impliedOdds(m.sideTotals);
  return (
    <div className="odds">
      {m.outcomes.map((o, i) => (
        <div key={o} className="odds-row">
          <span className="odds-name">{o}</span>
          <span className="odds-track" aria-hidden>
            <span style={{ width: `${Math.max(odds[i] * 100, 2)}%` }} />
          </span>
          <b className="mono">{Math.round(odds[i] * 100)}%</b>
        </div>
      ))}
    </div>
  );
}

function FeaturedMarket({ m }: { m: MarketView }) {
  const { points, current } = usePriceHistory(m.priceFeed);
  const target = Number(m.threshold) / 1e8;
  const feed = feedLabel(m.priceFeed);

  return (
    <motion.section
      className="featured"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <div className="featured-head">
        <div>
          <span className="eyebrow">Closing soonest</span>
          <h2 className="featured-title">{m.question}</h2>
          <p className="featured-sub">
            Live Chainlink {feed.asset}/{feed.unit} against the {usd(m.threshold)} line that decides this market.
            Bets stay private; only the side totals are public.
          </p>
        </div>
        <div className="featured-tags">
          <span className={`pill ${statusClass(m)}`}>{statusLabel(m)}</span>
          <SourceChip source={m.source} />
        </div>
      </div>

      <ChartPanel feed={m.priceFeed} threshold={target} points={points} />

      <div className="featured-foot">
        <div className="featured-metrics">
          <div className="fm">
            <span className="fm-k mono">Live {feed.asset}</span>
            <span className="fm-v">{current === null ? "—" : priceUsd(current, 0)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Pot</span>
            <span className="fm-v">{usdc(m.pot)}</span>
          </div>
          <div className="fm">
            <span className="fm-k mono">Closes</span>
            <span className="fm-v"><Countdown resolveAfter={m.closeTime} /></span>
          </div>
        </div>
        <div className="featured-cta">
          <ThresholdDistance current={current} threshold={target} />
          <Link className="btn primary" href={`/markets/${m.id.toString()}`}>
            Bet privately
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

function MarketCard({ m, index }: { m: MarketView; index: number }) {
  const isFeed = m.source === Source.Price;
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), { stiffness: 200, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-6, 6]), { stiffness: 200, damping: 18 });
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  const target = Number(m.threshold) / 1e8;
  const { points } = usePriceHistory(isFeed ? m.priceFeed : ZERO);
  const settled = m.status === Status.Resolved || m.status === Status.Cancelled;

  return (
    <Link href={`/markets/${m.id.toString()}`} className="card-link">
      <motion.article
        className="card tilt"
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1], delay: index * 0.06 }}
        whileHover={{ y: -4 }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ rotateX, rotateY, transformPerspective: 900 }}
      >
        <div className="card-top">
          <span className="card-cat mono">{m.category}</span>
          <div className="card-top-right">
            <span className={`pill ${statusClass(m)}`}>{statusLabel(m)}</span>
            <span className="card-id">#{m.id.toString()}</span>
          </div>
        </div>
        <h3>{m.question}</h3>

        <div className="card-src">
          <SourceChip source={m.source} />
          {m.numSides > 2 && <span className="src-chip mono">{m.numSides} outcomes</span>}
        </div>

        {isFeed && (
          <div className="card-spark">
            <PriceChart points={points} threshold={target} variant="spark" />
          </div>
        )}

        <div className="meta">
          <div className="row">
            <span>Pot</span>
            <b>{usdc(m.pot)}</b>
          </div>
          {settled ? (
            <div className="row">
              <span>Result</span>
              <b className="tag-yes">{m.status === Status.Cancelled ? "Refunded" : m.outcomes[m.winningSide]}</b>
            </div>
          ) : (
            <div className="row">
              <span>Closes</span>
              <b><Countdown resolveAfter={m.closeTime} /></b>
            </div>
          )}
        </div>
        <OddsBar m={m} />

        <div className="card-foot">
          <span className="card-cta mono">{isOpenNow(m) ? "Bet privately" : settled ? "Claim / view" : "View market"} →</span>
        </div>
      </motion.article>
    </Link>
  );
}
