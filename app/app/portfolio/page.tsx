"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ASSET, unspentPositions, unspentTickets } from "@quietodds/lib";
import { AmbientField } from "@/components/AmbientField";
import { ConnectButton } from "@/components/ConnectButton";
import { usePrivateAccount } from "@/components/PrivateAccount";
import { useMarkets } from "@/hooks/useMarkets";
import { usdc, weth } from "@/lib/format";

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const acct = usePrivateAccount();

  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Private</p>
        <h1>Portfolio</h1>
        <p className="lead">
          Your private balances, bets and batch tickets. Only you can see this page: it&apos;s rebuilt in your
          browser from public chain data and your viewing key.
        </p>

        {!isConnected ? (
          <section className="panel unlock">
            <p>Connect the wallet you used to deposit.</p>
            <ConnectButton />
          </section>
        ) : !acct.keys ? (
          <UnlockPanel />
        ) : (
          <>
            <ScanBar />
            {acct.scan.phase === "done" && <Holdings />}
          </>
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
      <button className="btn primary" onClick={() => void acct.unlock()} disabled={acct.unlocking}>
        {acct.unlocking ? "Waiting for signature…" : "Sign to unlock"}
      </button>
    </section>
  );
}

/// Scan progress: logs through Anon-RPC, then trial decryption of every backup.
export function ScanBar() {
  const { scan, rescan, lock } = usePrivateAccount();
  return (
    <section className="panel scanbar">
      <div className="scanbar-head">
        <span className="mono">
          {scan.phase === "done" ? "Private account unlocked" : scan.phase === "error" ? "Scan failed" : "Scanning…"}
        </span>
        <span className="scanbar-actions">
          <button className="btn" onClick={() => void rescan()} disabled={scan.phase === "logs" || scan.phase === "decrypt"}>
            Rescan
          </button>
          <button className="btn" onClick={lock}>
            Lock
          </button>
        </span>
      </div>
      <div className="scanbar-track" aria-label="scan progress">
        <div className="scanbar-fill" style={{ width: `${Math.round(scan.progress * 100)}%` }} />
      </div>
      <p className="hint mono">{scan.error ?? scan.detail}</p>
    </section>
  );
}

function Holdings() {
  const { notes, balances } = usePrivateAccount();
  const { markets } = useMarkets();
  const positions = unspentPositions(notes);
  const tickets = unspentTickets(notes);
  const question = (id: bigint) => markets.find((m) => m.id === id);

  return (
    <>
      <div className="statrow">
        <div className="stat">
          <span className="stat-label mono">Private USDC</span>
          <span className="stat-value accent">{usdc(balances.usdc)}</span>
        </div>
        <div className="stat">
          <span className="stat-label mono">Private WETH</span>
          <span className="stat-value">{weth(balances.weth)}</span>
        </div>
        <div className="stat">
          <span className="stat-label mono">Open bets</span>
          <span className="stat-value">{positions.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label mono">Batch tickets</span>
          <span className="stat-value">{tickets.length}</span>
        </div>
      </div>

      <section className="panel">
        <h2>Bets</h2>
        {positions.length === 0 ? (
          <p className="hint">
            No open bets. <Link href="/markets">Browse markets →</Link>
          </p>
        ) : (
          <div className="obc-list">
            {positions.map((n) => {
              if (n.data.kind !== "position") return null;
              const m = question(n.data.market);
              return (
                <div key={n.leafIndex} className="obc-row">
                  <span className="obc-label">
                    <Link href={`/markets/${n.data.market}`}>{m?.question ?? `Market #${n.data.market}`}</Link>
                    {" · "}
                    {m?.outcomes[Number(n.data.side)] ?? `side ${n.data.side}`}
                  </span>
                  <span className="obc-share mono">{usdc(n.data.stake)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Batch tickets</h2>
        {tickets.length === 0 ? (
          <p className="hint">No batch tickets.</p>
        ) : (
          <div className="obc-list">
            {tickets.map((n) =>
              n.data.kind === "ticket" ? (
                <div key={n.leafIndex} className="obc-row">
                  <span className="obc-label">Batch #{n.data.batch.toString()}</span>
                  <span className="obc-share mono">{n.data.amountIn.toString()} in</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Notes</h2>
        <p className="hint">
          Every unspent note you own, by leaf. Each is a commitment in the pool&apos;s Merkle tree; its backup is
          encrypted to your viewing key.
        </p>
        <div className="obc-list">
          {notes
            .filter((n) => !n.spent)
            .map((n) => (
              <div key={n.leafIndex} className="obc-row">
                <span className="obc-label mono">
                  leaf {n.leafIndex} · {n.data.kind}
                </span>
                <span className="obc-share mono">
                  {n.data.kind === "balance"
                    ? n.data.asset === ASSET.USDC
                      ? usdc(n.data.amount)
                      : weth(n.data.amount)
                    : n.data.kind === "position"
                      ? usdc(n.data.stake)
                      : n.data.amountIn.toString()}
                </span>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}
