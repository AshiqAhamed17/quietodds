"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { ASSET } from "@quietodds/lib";
import { usePrivateAccount } from "./PrivateAccount";
import { PrivateGate } from "./PrivateGate";
import { ActionStatus, useAction } from "./ActionStatus";
import { relayedSpend } from "@/lib/private";
import { usdc } from "@/lib/format";
import type { MarketView } from "@/hooks/useMarkets";

/// Bet from the private balance: the browser proves a spend with action BET,
/// the relayer submits it. On chain: "someone bet X on side Y".
export function BetForm({ m, onDone }: { m: MarketView; onDone?: () => void }) {
  const acct = usePrivateAccount();
  const [side, setSide] = useState(0);
  const [amount, setAmount] = useState("1");
  const { state, run } = useAction();

  let stake = 0n;
  try {
    stake = amount ? parseUnits(amount, 6) : 0n;
  } catch {
    stake = 0n;
  }
  // Pari-mutuel: if this side wins, the pot (incl. this bet) less 1% is split by stake on this side.
  const sideAfter = (m.sideTotals[side] ?? 0n) + stake;
  const potAfter = m.pot + stake;
  const ifWin = sideAfter > 0n ? (stake * ((potAfter * 99n) / 100n)) / sideAfter : 0n;

  const bet = () =>
    run(async (onStep) => {
      const r = await relayedSpend({
        account: acct,
        asset: ASSET.USDC,
        amount: stake,
        action: { type: "bet", market: m.id, side: BigInt(side) },
        onStep,
      });
      onDone?.();
      return { txHash: r.txHash, summary: `Bet ${usdc(r.amount)} on ${m.outcomes[side]}. Relayer fee ${usdc(r.fee)}.` };
    });

  return (
    <section className="panel" id="bet">
      <h2>Bet privately</h2>
      <PrivateGate compact>
        <div className="form">
          <div className="sides">
            {m.outcomes.map((o, i) => (
              <button key={o} className={`btn ${side === i ? "on" : ""}`} onClick={() => setSide(i)}>
                {o}
              </button>
            ))}
          </div>
          <label>
            Stake (USDC) · private balance {usdc(acct.balances.usdc)}
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="kv">
            <span>If {m.outcomes[side]} wins (at current odds)</span>
            <b>{usdc(ifWin)}</b>
          </div>
          <div className="kv">
            <span>Relayer fee</span>
            <b>~$0.05</b>
          </div>
          <button className="btn primary" onClick={() => void bet()} disabled={state.busy || stake <= 0n}>
            {state.busy ? "Working…" : `Bet ${amount || 0} USDC on ${m.outcomes[side]}`}
          </button>
          <p className="hint">
            Your wallet never signs this. The proof hides which note paid; the chain only learns the side and the amount.
          </p>
          <ActionStatus state={state} />
        </div>
      </PrivateGate>
    </section>
  );
}
