import { Hero } from "@/components/Hero";
import { DarkPoolMount } from "@/components/three/DarkPoolMount";
import { Reveal } from "@/components/Reveal";
import { Ruler } from "@/components/landing/Ruler";
import { Features } from "@/components/landing/Features";
import { WorkSection } from "@/components/landing/WorkSection";
import { ProofSection } from "@/components/landing/ProofSection";
import { Stack } from "@/components/landing/Stack";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function Home() {
  return (
    <main id="top">
      <DarkPoolMount />
      <Hero />

      {/* headline */}
      <div className="wrap headline">
        <div>
          <Reveal>
            <h1>
              Nobody sees your <em>bet</em>. Nobody sees your <em>swap</em>.
            </h1>
          </Reveal>
          <Reveal delay={90}>
            <p className="sub">
              Deposit once into a shielded pool. Bet, claim, batch-swap and withdraw with zero-knowledge
              proofs sent by a relayer, so no market, side, payout or swap is ever linked to your wallet.
              Even your reads go through Anon-RPC.
            </p>
          </Reveal>
        </div>
        <a className="scrolldown" href="#features" aria-label="Scroll to features">
          <svg width="18" height="24" viewBox="0 0 18 24" fill="none">
            <path d="M9 1v20M2 15l7 7 7-7" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </a>
      </div>

      <Ruler />
      <Features />
      <Ruler />
      <WorkSection />
      <Ruler />
      <Stack />
      <Ruler />
      <ProofSection />

      {/* closer */}
      <section className="band wrap">
        <div className="kicker">QuietOdds</div>
        <div className="landing-h2" style={{ fontSize: "clamp(2.2rem, 6vw, 4.4rem)", maxWidth: "16ch" }}>
          Quiet bets. <em>Loud</em> odds.
        </div>
        <a
          className="doclink"
          href="https://github.com/AshiqAhamed17/quietodds"
          target="_blank"
          rel="noreferrer"
          style={{ marginTop: "1.4rem" }}
        >
          Explore the repository ↗
        </a>
      </section>

      <LandingFooter />
    </main>
  );
}
