"use client";

import { useState } from "react";

/// The whole idea in one interaction: odds are public, bettors aren't.
export function ProofSection() {
  const [state, setState] = useState<"idle" | "looking" | "done">("idle");

  function reveal() {
    if (state !== "idle") return;
    setState("looking");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => setState("done"), reduce ? 0 : 900);
  }

  const done = state === "done";

  return (
    <section className="band wrap" id="proof">
      <div className="kicker">
        <b>The difference</b> — public odds, private bettors
      </div>
      <div className="landing-h2">Everyone sees the odds. Nobody sees who.</div>
      <p className="lede">
        Other prediction markets put your wallet next to every bet you make. On QuietOdds the side totals are
        public, so prices still work, but each bet arrives from the shielded pool through a relayer.
      </p>
      <div className="proofline">
        <div>
          <div className={`totals ${done ? "done" : ""}`}>
            Arsenal <span className="val">6.20</span> · Liverpool <span className="val">5.40</span> USDC ·{" "}
            {done ? <span className="val">bettors: none linkable</span> : <span className="veiled">████████</span>}
          </div>
          <div className={`pmeta ${done ? "done" : ""}`}>
            {done ? (
              <>
                <b>Nothing to reveal ✓</b> · every bet was sent by the relayer from a hidden note
              </>
            ) : (
              "Who placed these bets?"
            )}
          </div>
        </div>
        <button className="verify" onClick={reveal} disabled={state !== "idle"}>
          {state === "idle" ? "Reveal the bettors" : state === "looking" ? "Searching the chain…" : "Can't be done ✓"}
        </button>
      </div>
    </section>
  );
}
