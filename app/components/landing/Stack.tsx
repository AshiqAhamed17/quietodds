"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";

/// The three sponsor integrations, told as an editorial list — what each one
/// does for QuietOdds, and where to see it in the app.
const STACK = [
  {
    sponsor: "Uniswap v4",
    title: "A hook that shields, and a pool that can't be sandwiched",
    body:
      "Shield-on-swap carves your USDC into a private note mid-swap. Private batch swaps settle through the same pool inside one unlock. A directional dynamic fee and a block-start guard make same-block sandwiches lose money, and market fees are donated to LPs.",
    href: "/markets",
    cta: "Explore the markets",
    accent: "#ff7ad9",
  },
  {
    sponsor: "Chainlink CRE",
    title: "Results under consensus, not on our word",
    body:
      "A CRE workflow reads open markets, fetches each result from ESPN or a Chainlink price feed, agrees on it across the DON, and writes one signed report that resolves markets, executes ready batches and donates fees.",
    href: "/markets",
    cta: "See how markets resolve",
    accent: "var(--yes)",
  },
  {
    sponsor: "EF Anon-RPC",
    title: "Even your reads stay private",
    body:
      "Scanning for your notes, reading odds and pool state all go through Anon-RPC, so the node serving you can't tie your IP to the markets you look at. Proofs are generated in your browser.",
    href: "/portfolio",
    cta: "Open your private portfolio",
    accent: "#6bd6b0",
  },
];

export function Stack() {
  return (
    <section id="stack" className="wrap stack-section">
      <Reveal>
        <div className="kicker">The stack</div>
        <h2 className="landing-h2 stack-h2">
          Three integrations doing one quiet job.
        </h2>
      </Reveal>
      <div className="stack-list">
        {STACK.map((s, i) => (
          <Reveal key={s.sponsor} delay={60 * i}>
            <article className="stack-row">
              <div className="stack-row-head">
                <span className="stack-sponsor mono" style={{ color: s.accent }}>
                  {s.sponsor}
                </span>
                <h3 className="stack-title">{s.title}</h3>
              </div>
              <p className="stack-body">{s.body}</p>
              <Link className="stack-cta" href={s.href}>
                {s.cta} <span aria-hidden>↗</span>
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
