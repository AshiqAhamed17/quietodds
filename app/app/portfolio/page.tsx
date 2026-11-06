"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ASSET, unspentPositions, unspentTickets } from "@quietodds/lib";
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
          <button className="btn" onClick={() => void rescan(true)} disabled={scan.phase === "logs" || scan.phase === "decrypt"}>
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
  const [recent, setRecent] = useState<{ summary: string; tx: string }[]>([]);
  const onDone = (summary: string, tx: string) => setRecent((r) => [{ summary, tx }, ...r]);
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

      {recent.length > 0 && (
        <section className="panel">
          <h2>Just now</h2>
          {recent.map((x) => (
            <p key={x.tx} className="hint mono">
              {x.summary}{" "}
              <a href={explorerTx(x.tx)} target="_blank" rel="noreferrer">
                View tx ↗
              </a>
            </p>
          ))}
        </section>
      )}

      <BetQueueList />

      <section className="panel">
        <h2>Bets</h2>
        <p className="hint">Winning and refunded bets are claimed privately: the payout becomes a new hidden note, ready to bet again or withdraw.</p>
        {positions.length === 0 ? (
          <p className="hint">
            No open bets. <Link href="/markets">Browse markets →</Link>
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
        <h2>Batch tickets</h2>
        {tickets.length === 0 ? (
          <p className="hint">
            No batch tickets. <Link href="/batch">Join a private batch swap →</Link>
          </p>
        ) : (
          <div className="obc-list">
            {tickets.map((n) => (
              <RedeemRow key={n.leafIndex} note={n} onDone={onDone} />
            ))}
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
