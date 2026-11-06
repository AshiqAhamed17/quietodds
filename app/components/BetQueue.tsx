"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { ASSET } from "@quietodds/lib";
import { usePrivateAccount } from "./PrivateAccount";
import { betQueue, type QueuedBet } from "@/lib/betQueue";
import { relayedSpend } from "@/lib/private";
import { explorerTx } from "@/lib/contract";
import { usdc } from "@/lib/format";

const EMPTY: QueuedBet[] = [];

export function useBetQueue(): QueuedBet[] {
  const { address } = useAccount();
  return useSyncExternalStore(
    betQueue.subscribe,
    () => (address ? betQueue.list(address) : EMPTY),
    () => EMPTY,
  );
}

/// Mounted once for the whole app: places due bets whenever the private account
/// is unlocked, on any page. Bets due while the tab was closed run on unlock.
export function BetQueueRunner() {
  const { address } = useAccount();
  const acct = usePrivateAccount();
  const queue = useBetQueue();
  const running = useRef(new Set<number>());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!address || !acct.keys || acct.scan.phase !== "done") return;
    // One at a time, so two bets never race for the same note.
    if (running.current.size > 0) return;
    const due = queue.find((b) => b.status === "waiting" && b.dueAt <= now);
    if (!due) return;
    running.current.add(due.id);
    betQueue.update(address, due.id, { status: "betting", detail: "proving in your browser…" });
    relayedSpend({
      account: acct,
      asset: ASSET.USDC,
      amount: BigInt(due.amount),
      action: { type: "bet", market: BigInt(due.market), side: BigInt(due.side) },
    })
      .then((r) => betQueue.update(address, due.id, { status: "done", tx: r.txHash, detail: undefined }))
      .catch((e) => betQueue.update(address, due.id, { status: "failed", detail: e instanceof Error ? e.message : String(e) }))
      .finally(() => running.current.delete(due.id));
  }, [now, queue, address, acct]);

  return null;
}

/// The queue as a list, with countdowns and a "now" button.
export function BetQueueList() {
  const { address } = useAccount();
  const queue = useBetQueue();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!address || queue.length === 0) return null;

  return (
    <div className="bet-queue">
      <h3>Queued private bets</h3>
      <p className="hint">
        Saved in this browser (intent only, no keys). They&apos;re placed while your account is unlocked; if you close the
        tab, due bets run the next time you unlock.
      </p>
      {queue.map((b) => {
        const left = Math.max(0, Math.round((b.dueAt - now) / 1000));
        return (
          <div key={b.id} className="kv">
            <span>
              {usdc(BigInt(b.amount))} on {b.sideLabel} · {b.question}
            </span>
            <b className="mono">
              {b.status === "waiting" ? (
                <>
                  in {Math.floor(left / 60)}:{(left % 60).toString().padStart(2, "0")}{" "}
                  <button className="btn" onClick={() => betQueue.update(address, b.id, { dueAt: Date.now() })}>
                    now
                  </button>
                </>
              ) : b.status === "done" ? (
                <a href={explorerTx(b.tx!)} target="_blank" rel="noreferrer">
                  placed ✓
                </a>
              ) : b.status === "failed" ? (
                <>
                  <span className="tag-no">{b.detail}</span>{" "}
                  <button className="btn" onClick={() => betQueue.update(address, b.id, { status: "waiting", dueAt: Date.now(), detail: undefined })}>
                    retry
                  </button>
                </>
              ) : (
                b.detail
              )}
            </b>
          </div>
        );
      })}
    </div>
  );
}
