"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ASSET, spendableNotes, unspentPositions, unspentTickets, type OwnedNote } from "@quietodds/lib";
import { AmbientField } from "@/components/AmbientField";
import { ConnectButton } from "@/components/ConnectButton";
import { usePrivateAccount } from "@/components/PrivateAccount";
import { useMarkets } from "@/hooks/useMarkets";
import { usdc, weth } from "@/lib/format";
import { RedeemRow } from "@/components/RedeemRow";
import { BetQueueList } from "@/components/BetQueue";
import { useState } from "react";
import { explorerTx } from "@/lib/contract";

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const acct = usePrivateAccount();

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <h1>Portfolio</h1>
        <p className="lead">
          Only you can see this page. It&apos;s rebuilt in your browser from public chain data and your viewing key;
          nothing about it is stored anywhere.
        </p>

        {!isConnected ? (
          <section className="panel unlock">
            <p>Connect the wallet you used to deposit.</p>
            <ConnectButton />
          </section>
        ) : !acct.keys ? (
          <UnlockPanel />
        ) : (
          <Holdings />
        )}
      </main>
    </>
  );
}

/// One signature derives the private account; no gas, no transaction.
export function UnlockPanel() {
  const acct = usePrivateAccount();
  return (
    <section className="panel unlock">
      <h2>Unlock your private account</h2>
      <p className="hint">
        Sign one message (no gas, nothing is sent on chain). The signature derives your spending key and your
        viewing key. They stay in this tab&apos;s memory and are gone when you close it; the same wallet always
        recovers the same notes, on any device.
      </p>
      <div className="sides">
        <button className="btn primary" onClick={() => void acct.unlock()} disabled={acct.unlocking}>
          {acct.unlocking ? "Waiting…" : "Sign to unlock"}
        </button>
        <button className="btn" onClick={() => void acct.unlockWithPasskey().catch((e) => alert(e.message))} disabled={acct.unlocking}>
          Use a passkey instead
        </button>
      </div>
      <p className="hint">
        A passkey gives a <b>separate</b> private account, derived from the passkey (WebAuthn PRF) instead of a wallet
        signature. It syncs with your passkey provider; you still deposit and swap from any wallet.
      </p>
    </section>
  );
}

const ACTIONS = [
  { href: "/deposit", label: "Deposit" },
  { href: "/markets", label: "Bet" },
  { href: "/batch", label: "Batch swap" },
  { href: "/deposit#withdraw", label: "Withdraw" },
];

function Holdings() {
  const { notes, balances, scan, rescan, lock, method } = usePrivateAccount();
  const [recent, setRecent] = useState<{ summary: string; tx: string }[]>([]);
  const onDone = (summary: string, tx: string) => setRecent((r) => [{ summary, tx }, ...r]);
  const { markets } = useMarkets();
  const positions = unspentPositions(notes);
  const tickets = unspentTickets(notes);
  const question = (id: bigint) => markets.find((m) => m.id === id);
  const ready = scan.phase === "done";
  const scanning = scan.phase === "logs" || scan.phase === "decrypt";

  return (
    <>
      <section className="panel pf-hero">
        <div className="pf-hero-top">
          <div className="pf-balance">
            <span className="pf-caption">Private balance</span>
            <span className="pf-usdc">{ready ? usdc(balances.usdc) : "…"}</span>
            <span className="pf-weth mono">{ready ? weth(balances.weth) : "\u00a0"}</span>
          </div>
          <div className="pf-account">
            <span className={`pf-state ${scan.phase}`}>
              <span className="anon-dot" aria-hidden />
              {scan.phase === "error" ? "Scan failed" : ready ? `Unlocked with ${method === "passkey" ? "a passkey" : "your wallet"}` : "Scanning the pool…"}
            </span>
            <span className="pf-account-actions">
              <button className="btn ghost" onClick={() => void rescan(true)} disabled={scanning}>
                Rescan
              </button>
              <button className="btn ghost" onClick={lock}>
                Lock
              </button>
            </span>
          </div>
        </div>
        <nav className="pf-actions" aria-label="Actions">
          {ACTIONS.map((a) => (
            <Link key={a.label} className="btn" href={a.href}>
              {a.label}
            </Link>
          ))}
        </nav>
        <div className="pf-scan">
          <div className="scanbar-track" aria-label="scan progress">
            <div className="scanbar-fill" style={{ width: `${Math.round(scan.progress * 100)}%` }} />
          </div>
          <p className="hint mono">{scan.error ?? scan.detail}</p>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="panel pf-recent">
          <h2>Just now</h2>
          {recent.map((x) => (
            <p key={x.tx} className="hint">
              {x.summary}{" "}
              <a href={explorerTx(x.tx)} target="_blank" rel="noreferrer">
                View tx ↗
              </a>
            </p>
          ))}
        </section>
      )}

      {ready && (
        <div className="pf-grid">
          <div className="pf-main">
            <BetQueueList />
            <section className="panel">
              <div className="pf-head">
                <h2>Bets</h2>
                <span className="pf-count mono">{positions.length}</span>
              </div>
              <p className="hint">Winning and refunded bets are claimed privately: the payout becomes a new hidden note.</p>
              {positions.length === 0 ? (
                <p className="pf-empty">
                  No open bets. <Link href="/markets">Pick a market</Link>
                </p>
              ) : (
                <div className="obc-list">
                  {positions.map((n) =>
                    n.data.kind === "position" ? <RedeemRow key={n.leafIndex} note={n} market={question(n.data.market)} onDone={onDone} /> : null,
                  )}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="pf-head">
                <h2>Batch tickets</h2>
                <span className="pf-count mono">{tickets.length}</span>
              </div>
              {tickets.length === 0 ? (
                <p className="pf-empty">
                  No batch tickets. <Link href="/batch">Join a private batch swap</Link>
                </p>
              ) : (
                <div className="obc-list">
                  {tickets.map((n) => (
                    <RedeemRow key={n.leafIndex} note={n} onDone={onDone} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="panel pf-notes">
            <h2>Your notes</h2>
            <p className="hint">
              Your balance is split across notes, each a hidden commitment in the pool. A private action spends one
              note, so the biggest note is the most you can bet, join or withdraw in one go.
            </p>
            <NoteStack label="USDC" notes={notes} asset={ASSET.USDC} show={usdc} />
            <NoteStack label="WETH" notes={notes} asset={ASSET.WETH} show={weth} />
          </aside>
        </div>
      )}
    </>
  );
}

/// One asset's notes as a bar split in proportion to each note's amount.
function NoteStack({ label, notes, asset, show }: { label: string; notes: OwnedNote[]; asset: bigint; show: (v: bigint) => string }) {
  const list = spendableNotes(notes, asset);
  const amounts = list.map((n) => (n.data.kind === "balance" ? n.data.amount : 0n));
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (list.length === 0)
    return (
      <div className="note-stack empty">
        <div className="pf-head">
          <span className="note-stack-label">{label}</span>
          <span className="mono muted">no notes</span>
        </div>
      </div>
    );
  return (
    <div className="note-stack">
      <div className="pf-head">
        <span className="note-stack-label">{label}</span>
        <span className="mono muted">
          {list.length} {list.length === 1 ? "note" : "notes"}
        </span>
      </div>
      <div className="note-bar" role="img" aria-label={`${label} notes: ${amounts.map(show).join(", ")}`}>
        {amounts.map((a, i) => (
          <span key={list[i].leafIndex} className={i === 0 ? "big" : ""} style={{ flexGrow: Number((a * 10_000n) / total) || 1 }} />
        ))}
      </div>
      <ul className="note-list">
        {list.map((n, i) => (
          <li key={n.leafIndex}>
            <span className="mono muted">leaf {n.leafIndex}</span>
            <span className="mono">{show(amounts[i])}</span>
            {i === 0 && <span className="note-tag">biggest</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
