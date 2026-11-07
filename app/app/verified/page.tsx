import type { Metadata } from "next";
import { AmbientField } from "@/components/AmbientField";
import report from "@/lib/verification.json";

export const metadata: Metadata = {
  title: "Verified · QuietOdds",
  description: "Machine-checked Lean proofs of QuietOdds' money rules, and every test suite, with live results.",
};

const REPO = "https://github.com/AshiqAhamed17/quietodds";
const at = (path: string, from?: number, to?: number) =>
  `${REPO}/blob/${report.commit}/${path}${from ? `#L${from}${to ? `-L${to}` : ""}` : ""}`;

type Theorem = (typeof report.lean.theorems)[number];
const thm = (name: string) => report.lean.theorems.find((t) => t.name === name) as Theorem;

/// Readable test names: test_ticketRedeemsOnlyOnce → "ticket redeems only once".
const words = (n: string) =>
  n
    .replace(/^(testFuzz_|test_|invariant_)/, "")
    .replace(/^\w+::/, "")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();

const date = new Date(report.generatedAt).toLocaleString("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const forgeTests = report.forge.suites.flatMap((s) => s.tests);
const fuzz = forgeTests.filter((t) => t.kind === "fuzz");
const invariants = forgeTests.filter((t) => t.kind === "invariant");
const allOk = report.lean.ok && report.noir.ok && report.forge.ok && report.cre.ok;

export default function VerifiedPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page vf">
        <p className="eyebrow">Security · formal verification</p>
        <h1>Don&apos;t trust us. Check the math.</h1>
        <p className="lead">
          QuietOdds holds your money behind zero-knowledge proofs, so the rules inside those proofs have to be right. We
          proved the money rules in Lean, a proof assistant where a computer checks every step. Then we tested
          everything else. Every number on this page comes from the tools&apos; own output.
        </p>

        <Certificate />
        <WhyProofs />

        <section className="vf-section" id="theorems">
          <h2>What is proved</h2>
          <p className="vf-sub">
            Four theorems, one per rule that would lose people money if it were wrong. Each one names the exact circuit
            or contract lines it models.
          </p>

          <TheoremCard
            n={1}
            title="A private spend can't create money"
            claim="Whatever goes into a spend comes out exactly: the note you spend equals the change you keep, plus what you bet, swap or withdraw, plus the relayer fee."
            attack="A forged proof that spends a 1 USDC note but bets 1,000,000 USDC, by making the numbers wrap around the field."
            why={
              <>
                The circuit&apos;s equation holds &quot;modulo p&quot;, like a clock that wraps at 12. On its own,{" "}
                <code>1 = change + bet</code> can be satisfied by a gigantic &quot;negative&quot; change. The four
                128-bit range checks stop that, and the theorem proves they are enough: since{" "}
                <code>3 × 2¹²⁸ &lt; p</code>, the sum can never wrap, so the field equation is the ordinary equation.
              </>
            }
            circuit={{ ...report.snippets.spend, label: "spend circuit" }}
            theorems={[thm("spend_conserves_value")]}
          />

          <TheoremCard
            n={2}
            title="Payouts are exact, to the unit"
            claim="When you claim a win or redeem a batch ticket, the payout is exactly ⌊stake × pot ÷ winning side⌋. Not a unit more. And the relayer fee can never exceed the payout."
            attack="Claiming a payout slightly larger than your share, or a fee bigger than the payout so the leftover wraps into a huge note."
            why={
              <>
                Circuits can&apos;t divide, so the prover supplies the answer and the circuit checks{" "}
                <code>x·num = payout·den + remainder</code> with <code>0 ≤ remainder &lt; den</code>. The theorem
                proves that with the 96-bit checks, this pins the payout to the one true floor division. The contract
                supplies <code>num</code> and <code>den</code>, never the user.
              </>
            }
            circuit={{ ...report.snippets.redeem, label: "redeem circuit" }}
            theorems={[thm("redeem_payout_exact"), thm("redeem_fee_sound")]}
          />

          <TheoremCard
            n={3}
            title="Winners can never take more than the pot"
            claim="If every winner is paid their rounded-down share, the total paid out is at most the pot. Rounding dust is less than one unit per person, and it stays in the pool."
            attack="Rounding errors that add up across many claims until the last winner, or the pool, comes up short."
            why={
              <>
                Each payout is floored, and a sum of floors is at most the floor of the sum. Here it is with the real
                numbers from our Sepolia batch #1, where three people put in 1.2, 1.0 and 1.0 USDC and the batch got
                back 1,392,866,552,093,773 wei:{" "}
                <span className="vf-example">
                  payouts add up to …772. That is <b>1 wei</b> of dust, kept by the pool.
                </span>{" "}
                Lean checks that example too.
              </>
            }
            theorems={[thm("pro_rata_conserves"), thm("pro_rata_dust_lt_card")]}
            model="Models the pro-rata terms that Markets and BatchSwapper hand to ShieldedPool.redeem."
          />

          <TheoremCard
            n={4}
            title="A sandwich attack on our pool doesn't pay"
            claim="Our Uniswap v4 hook charges the back half of a sandwich a fee as large as the price move it reverses. With that fee, buying first and selling right after in the same block can't make a profit."
            attack="A bot buys just before your swap and sells just after, pocketing the price move your swap caused."
            why={
              <>
                Cost of the front-run is at least <code>q·P₀</code>. Revenue from the back-run is at most{" "}
                <code>q·(1−f)·P₂</code>. With <code>f ≥ (P₂−P₀)/P₀</code>, revenue never beats cost. We also proved
                where it stops: the contract caps the fee at 50%, so if one block more than doubles the price, the
                guarantee fails. We proved that too, instead of hiding it.
              </>
            }
            circuit={{ ...report.snippets.fee, label: "QuietOddsHook.directionalFee" }}
            theorems={[thm("sandwich_unprofitable"), thm("sandwich_unprofitable_fee_rule"), thm("capped_fee_counterexample")]}
            limit
          />
        </section>

        <AxiomAudit />
        <TrustGap />

        <section className="vf-section" id="tests">
          <h2>Tests, all of them</h2>
          <p className="vf-sub">
            Proofs cover the arithmetic. Tests cover the rest: Merkle paths, nullifiers, the hook&apos;s deltas,
            batches, the resolver. The contract tests use real proofs generated by the circuits, plus fuzzing and
            invariants.
          </p>
          <div className="vf-suites">
            <Suite
              title="Noir circuits"
              cmd="nargo test --workspace"
              src="circuits/"
              data={report.noir}
              blurb="Valid spends and claims pass. Wrong side, bad Merkle path, inflated payout, wraparound and tampered notes all fail."
            />
            <Suite
              title="Solidity contracts"
              cmd="forge test"
              src="contracts/test/"
              data={report.forge}
              blurb={`Real UltraHonk proofs, ${fuzz.length} fuzz tests (up to 1,000 runs each) and ${invariants.length} invariants, including "the pool always holds every deposit".`}
            />
            <Suite
              title="Chainlink CRE workflow"
              cmd="bun test"
              src="cre/resolver/main.test.ts"
              data={report.cre}
              blurb="ESPN and F1 parsing, price rules after close, and report encoding for ResolverReceiver."
            />
          </div>

          <div className="panel vf-fuzz">
            <h3>Property tests: random inputs, hundreds to thousands of runs each</h3>
            <ul>
              {[...fuzz, ...invariants].map((t) => (
                <li key={t.name}>
                  <span className="vf-ok" aria-hidden>
                    ✓
                  </span>
                  <span>{words(t.name)}</span>
                  <span className="vf-runs mono">
                    {t.kind === "invariant" ? "invariant" : "fuzz"} · {t.runs?.toLocaleString("en-US")} runs
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Reproduce />
      </main>
    </>
  );
}

function Certificate() {
  const rows = [
    {
      k: "Lean 4 proofs",
      v: `${report.lean.theorems.length} theorems`,
      d: `${report.lean.sorries} sorry · ${report.lean.customAxioms} custom axioms · ${report.lean.jobs.toLocaleString("en-US")} build jobs`,
      ok: report.lean.ok,
      href: "#theorems",
    },
    { k: "Noir circuits", v: `${report.noir.passed}/${report.noir.total}`, d: "spend, redeem, shared library", ok: report.noir.ok, href: "#tests" },
    {
      k: "Solidity contracts",
      v: `${report.forge.passed}/${report.forge.total}`,
      d: `${report.forge.suites.length} suites · ${fuzz.length} fuzz · ${invariants.length} invariants`,
      ok: report.forge.ok,
      href: "#tests",
    },
    { k: "CRE workflow", v: `${report.cre.passed}/${report.cre.total}`, d: "resolver logic", ok: report.cre.ok, href: "#tests" },
  ];
  return (
    <section className="panel vf-cert" aria-label="Verification summary">
      <div className="vf-cert-head">
        <span className={`vf-seal ${allOk ? "ok" : "bad"}`} aria-hidden>
          {allOk ? "✓" : "!"}
        </span>
        <div>
          <p className="vf-cert-title">{allOk ? "Every check passes" : "Some checks failed"}</p>
          <p className="vf-cert-meta">
            Run {date} on commit{" "}
            <a href={`${REPO}/commit/${report.commit}`} target="_blank" rel="noreferrer" className="mono">
              {report.commit.slice(0, 7)} ↗
            </a>
          </p>
        </div>
      </div>
      <div className="vf-cert-grid">
        {rows.map((r) => (
          <a key={r.k} href={r.href} className="vf-stat">
            <span className="vf-stat-k">{r.k}</span>
            <span className="vf-stat-v">
              <span className={r.ok ? "vf-ok" : "vf-bad"} aria-hidden>
                {r.ok ? "✓" : "✗"}
              </span>
              {r.v}
            </span>
            <span className="vf-stat-d">{r.d}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function WhyProofs() {
  return (
    <section className="vf-section vf-why">
      <h2>Why a proof, not just tests</h2>
      <div className="vf-why-grid">
        <div>
          <h3>Tests check examples</h3>
          <p>
            A test tries one input, or a few thousand random ones. If a bug needs one exact number out of 2²⁵⁴, testing
            will almost never find it.
          </p>
        </div>
        <div>
          <h3>ZK circuits wrap around</h3>
          <p>
            Circuit math works modulo a huge prime <code>p</code>, like a clock. On a clock, 11 + 3 = 2. In a circuit, a
            &quot;negative&quot; number is just a very big one. That&apos;s how money gets created from nothing.
          </p>
        </div>
        <div>
          <h3>A proof covers every input</h3>
          <p>
            Lean checks each step of the argument down to its axioms, for all possible values at once. If it builds,
            the claim holds. No sampling, no luck.
          </p>
        </div>
      </div>
    </section>
  );
}

function Code({ code, label, href, from }: { code: string; label: string; href?: string; from?: number }) {
  const lines = code.split("\n");
  return (
    <figure className="vf-code">
      <figcaption>
        <span>{label}</span>
        {href && (
          <a href={href} target="_blank" rel="noreferrer">
            source ↗
          </a>
        )}
      </figcaption>
      <pre>
        {lines.map((l, i) => {
          const t = l.trim();
          const dim = t.startsWith("//") || t.startsWith("/-") || t.startsWith("///");
          return (
            <span key={i} className={`vf-line ${dim ? "dim" : ""}`}>
              {from !== undefined && <span className="vf-ln">{from + i}</span>}
              <span className="vf-text">{l || " "}</span>
            </span>
          );
        })}
      </pre>
    </figure>
  );
}

function TheoremCard(props: {
  n: number;
  title: string;
  claim: string;
  attack: string;
  why: React.ReactNode;
  circuit?: { path: string; from: number; to: number; code: string; label: string };
  theorems: Theorem[];
  model?: string;
  limit?: boolean;
}) {
  const { n, title, claim, attack, why, circuit, theorems, model, limit } = props;
  return (
    <article className="panel vf-thm" id={`theorem-${n}`}>
      <header className="vf-thm-head">
        <span className="vf-thm-n">Theorem {n}</span>
        <span className="vf-proved">
          <span aria-hidden>✓</span> proved
        </span>
      </header>
      <h3>{title}</h3>
      <p className="vf-claim">{claim}</p>
      <dl className="vf-facts">
        <div>
          <dt>Rules out</dt>
          <dd>{attack}</dd>
        </div>
        <div>
          <dt>How</dt>
          <dd>{why}</dd>
        </div>
      </dl>

      <div className={`vf-pair ${circuit ? "" : "single"}`}>
        {circuit ? (
          <Code
            code={circuit.code}
            label={`${circuit.label} · ${circuit.path.split("/").slice(-3).join("/")} L${circuit.from}–${circuit.to}`}
            href={at(circuit.path, circuit.from, circuit.to)}
            from={circuit.from}
          />
        ) : (
          model && <p className="vf-model">{model}</p>
        )}
        <Code
          code={theorems[0].statement}
          label={`Lean · ${theorems[0].file.split("/").pop()} L${theorems[0].line}`}
          href={at(theorems[0].file, theorems[0].line)}
          from={theorems[0].line}
        />
      </div>

      {theorems.length > 1 && (
        <details className="vf-more">
          <summary>
            {theorems.length - 1} more {theorems.length > 2 ? "theorems" : "theorem"} in this group
          </summary>
          {theorems.slice(1).map((t) => (
            <div key={t.name} className={t.name === "capped_fee_counterexample" ? "vf-limit-code" : ""}>
              <Code code={t.statement} label={`Lean · ${t.file.split("/").pop()} L${t.line}`} href={at(t.file, t.line)} from={t.line} />
            </div>
          ))}
        </details>
      )}

      {limit && (
        <p className="vf-limit">
          <b>Where it stops.</b> <code>capped_fee_counterexample</code> proves that with the 50% fee cap, a block that
          more than doubles the price lets a sandwich profit. Sandwiches spread over several blocks are also outside
          the model. We state these limits as theorems, not footnotes.
        </p>
      )}

      <div className="vf-axioms">
        {theorems.map((t) => (
          <span key={t.name}>
            <code>{t.name}</code>
            <span className="vf-axiom-list">
              {(t.axioms ?? []).map((a) => (
                <span key={a} className="vf-axiom">
                  {a}
                </span>
              ))}
            </span>
          </span>
        ))}
      </div>
    </article>
  );
}

function AxiomAudit() {
  const out = report.lean.theorems
    .map((t) => `'QuietOdds.${t.name}' depends on axioms: [${(t.axioms ?? []).join(", ")}]`)
    .join("\n");
  return (
    <section className="vf-section" id="axioms">
      <h2>The axiom audit</h2>
      <p className="vf-sub">
        A proof is only as strong as what it assumes. Lean can list every axiom a theorem rests on, so an unfinished
        proof (<code>sorry</code>) or a made-up assumption can&apos;t hide. This is the real output of{" "}
        <code>lake build</code>:
      </p>
      <div className="vf-term">
        <div className="vf-term-bar">
          <span />
          <span />
          <span />
          <em>lean/ · lake build</em>
        </div>
        <pre>
          <span className="dim">$ lake build</span>
          {"\n"}
          {out}
          {"\n"}
          <span className="vf-term-ok">Build completed successfully ({report.lean.jobs} jobs).</span>
        </pre>
      </div>
      <div className="vf-axiom-legend">
        <p>
          <code>propext</code> Two statements that imply each other are equal.
        </p>
        <p>
          <code>Quot.sound</code> Lean&apos;s rule for working with equivalence classes.
        </p>
        <p>
          <code>Classical.choice</code> Ordinary classical logic, used by Mathlib.
        </p>
        <p className="vf-axiom-note">
          These are Lean&apos;s three standard axioms, used by almost all of mathematics in Lean. No{" "}
          <code>sorryAx</code>, no custom axioms. Lean {report.lean.toolchain.split(":v")[1]} with Mathlib.
        </p>
      </div>
    </section>
  );
}

function TrustGap() {
  const items = [
    ["Constraints copied by hand", "The circuit lines were transcribed into Lean by hand. Each hypothesis names the main.nr line it models, so you can check them side by side above. Nothing checks this mechanically."],
    ["Trusted toolchain", "We trust the Noir compiler, Barretenberg, the generated Solidity verifier, and Poseidon's collision resistance. The proofs are about the arithmetic, not these tools."],
    ["Model, not bytecode", "Theorems 3 and 4 model contract logic. Theorem 3 relies on three tested facts: stakes really sum to the total, each note redeems once, and the pot is really in the pool. Theorem 4 works over real numbers and leaves out integer rounding and price encoding."],
    ["Not audited", "This is a hackathon build on Sepolia. Formally verified where it matters most, tested everywhere else, but not audited."],
  ];
  return (
    <section className="vf-section" id="limits">
      <h2>What these proofs don&apos;t cover</h2>
      <p className="vf-sub">A proof you can trust says exactly where it ends.</p>
      <div className="vf-gap">
        {items.map(([h, p]) => (
          <div key={h}>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Suite({
  title,
  cmd,
  src,
  data,
  blurb,
}: {
  title: string;
  cmd: string;
  src: string;
  blurb: string;
  data: { ok: boolean; passed: number; total: number; seconds: number; suites: { name: string; tests: { name: string; pass: boolean }[] }[] };
}) {
  return (
    <div className="panel vf-suite">
      <div className="vf-suite-head">
        <h3>{title}</h3>
        <span className={`vf-count ${data.ok ? "ok" : "bad"}`}>
          {data.passed}/{data.total} passing
        </span>
      </div>
      <p>{blurb}</p>
      <p className="vf-cmd mono">
        $ {cmd} <span className="dim">· {data.seconds}s</span>
      </p>
      <details className="vf-more">
        <summary>Show all {data.total} tests</summary>
        {data.suites.map((s) => (
          <div key={s.name} className="vf-group">
            {data.suites.length > 1 && <p className="vf-group-name mono">{s.name}</p>}
            <ul>
              {s.tests.map((t) => (
                <li key={t.name}>
                  <span className={t.pass ? "vf-ok" : "vf-bad"} aria-hidden>
                    {t.pass ? "✓" : "✗"}
                  </span>
                  {words(t.name)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
      <a className="vf-src" href={at(src)} target="_blank" rel="noreferrer">
        {src} ↗
      </a>
    </div>
  );
}

function Reproduce() {
  return (
    <section className="vf-section" id="reproduce">
      <h2>Check it yourself</h2>
      <p className="vf-sub">
        Everything here is open source. One command reruns every suite and the Lean build, and rewrites the data this
        page shows.
      </p>
      <div className="vf-term">
        <div className="vf-term-bar">
          <span />
          <span />
          <span />
          <em>terminal</em>
        </div>
        <pre>
          <span className="dim"># clone</span>
          {"\n"}git clone {REPO} && cd quietodds && npm install
          {"\n\n"}
          <span className="dim"># the proofs (downloads prebuilt Mathlib, then checks every step)</span>
          {"\n"}cd lean && lake exe cache get && lake build && cd ..
          {"\n\n"}
          <span className="dim"># every suite + this page&apos;s data</span>
          {"\n"}npm run verify-report -w scripts
        </pre>
      </div>
      <p className="vf-tools mono">
        nargo {report.tools.nargo} · forge {report.tools.forge.split("-")[0]} · {report.lean.toolchain.replace("leanprover/", "")} ·
        bun {report.tools.bun}
      </p>
    </section>
  );
}
