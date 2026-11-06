"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    i: "01",
    label: "Shield",
    body: (
      <>
        <p>
          Deposit USDC, or shield part of a Uniswap swap through our <code>v4 hook</code>. The pool builds a
          Poseidon <code>note</code> from your amount and a commitment only you can open.
        </p>
        <p>Your keys come from one wallet signature, so notes can always be recovered.</p>
      </>
    ),
  },
  {
    i: "02",
    label: "Bet",
    body: (
      <>
        <p>
          Your browser proves in <code>Noir</code> that you own a note, splitting it into a bet and hidden
          change. A relayer submits it, so your wallet never touches the market.
        </p>
        <p>On chain it&apos;s only &quot;someone bet X on side Y&quot;. The odds update; you stay hidden.</p>
      </>
    ),
  },
  {
    i: "03",
    label: "Resolve",
    body: (
      <>
        <p>
          A <code>Chainlink CRE</code> workflow fetches the result (ESPN or a Chainlink feed), agrees on it
          across the DON, and settles the market in one signed report.
        </p>
        <p>The same report executes private batch swaps and donates the 1% fee to Uniswap LPs.</p>
      </>
    ),
  },
  {
    i: "04",
    label: "Claim",
    body: (
      <>
        <p>
          Winners prove a winning position and burn its nullifier. The payout is pinned to exactly
          their share, and lands as a new hidden note.
        </p>
        <p>Withdraw to a brand-new address: nothing links it to the deposit or the bet.</p>
      </>
    ),
  },
];

export function WorkSection() {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    const size = () => {
      const r = cv.getBoundingClientRect();
      W = cv.width = r.width * DPR;
      H = cv.height = r.height * DPR;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    let t = 0;
    let raf = 0;
    const draw = () => {
      t += 0.01;
      ctx.clearRect(0, 0, W, H);
      const levels = 4;
      const cx = W / 2;
      const topY = H * 0.16;
      const botY = H * 0.82;
      const spanTop = W * 0.62;
      const nodes: { x: number; y: number }[][] = [];
      for (let l = 0; l < levels; l++) {
        const count = 2 ** l;
        const y = topY + (botY - topY) * (l / (levels - 1));
        const span = spanTop * (l / (levels - 1)) * 1.1 + W * 0.12;
        const row: { x: number; y: number }[] = [];
        for (let i = 0; i < count; i++) {
          const x = count === 1 ? cx : cx - span / 2 + span * (i / (count - 1));
          row.push({ x, y });
        }
        nodes.push(row);
      }
      ctx.lineWidth = 1 * DPR;
      for (let l = 0; l < levels - 1; l++) {
        for (let i = 0; i < nodes[l].length; i++) {
          const p = nodes[l][i];
          [nodes[l + 1][i * 2], nodes[l + 1][i * 2 + 1]].forEach((c) => {
            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
          });
        }
      }
      const reveal = (activeRef.current + 1) / 4;
      for (let l = 0; l < levels; l++) {
        const depthFrac = 1 - l / (levels - 1);
        const lit = depthFrac <= reveal + 0.001;
        for (let i = 0; i < nodes[l].length; i++) {
          const n = nodes[l][i];
          const pulse = 0.5 + 0.5 * Math.sin(t * 2 + l + i);
          ctx.beginPath();
          ctx.arc(n.x, n.y, (l === 0 ? 4.5 : 3) * DPR, 0, 7);
          if (l === 0) {
            ctx.fillStyle = `rgba(${lit ? "143,230,203" : "180,190,210"},${0.5 + pulse * 0.4})`;
            ctx.shadowColor = "rgba(143,230,203,0.6)";
            ctx.shadowBlur = (lit ? 12 : 0) * DPR;
          } else {
            ctx.fillStyle = `rgba(168,192,255,${lit ? 0.55 + pulse * 0.35 : 0.14})`;
            ctx.shadowColor = "rgba(168,192,255,0.5)";
            ctx.shadowBlur = (lit ? 10 : 0) * DPR;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="band wrap" id="work">
      <div className="kicker">
        <b>How it works</b> — deposit to payout
      </div>
      <div className="landing-h2">
        Four steps. <em>Zero</em> links to you.
      </div>
      <div className="work">
        <div className="work-left">
          <div className="tabs">
            {STEPS.map((s, i) => (
              <button key={s.i} className={`tab ${active === i ? "on" : ""}`} onClick={() => setActive(i)}>
                <span className="mk">→</span>
                <span className="step-i">{s.i}</span>
                {s.label}
              </button>
            ))}
          </div>
          <div className="panel-copy">{STEPS[active].body}</div>
          <a className="doclink" href="https://github.com/AshiqAhamed17/quietodds" target="_blank" rel="noreferrer">
            Read the code ↗
          </a>
        </div>
        <div className="viz">
          <canvas ref={canvasRef} aria-hidden />
          <div className="viz-cap">
            one Poseidon tree · <b>every note hidden</b>
          </div>
        </div>
      </div>
    </section>
  );
}
