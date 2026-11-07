// Runs every test suite and the Lean build, and writes the results the app's
// /verified page shows: app/lib/verification.json.
//
//   npm run verify-report -w scripts
//
// Needs nargo, forge, lake (elan) and bun on PATH (or in their default
// install folders). Nothing here is hand-written: counts, test names, axiom
// lists and theorem statements all come from the tools' output and the source.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}app/lib/verification.json`;
const PATH = [".elan/bin", ".nargo/bin", ".foundry/bin", ".bun/bin"].map((p) => `${homedir()}/${p}`).join(":") + ":" + process.env.PATH;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function run(cmd, args, cwd) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: `${ROOT}${cwd}`, env: { ...process.env, PATH }, encoding: "utf8", maxBuffer: 64 << 20 });
  const out = strip(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  console.log(`${cmd} ${args.join(" ")} (${cwd}): exit ${r.status}, ${((Date.now() - t) / 1000).toFixed(1)}s`);
  return { ok: r.status === 0, out, seconds: Math.round((Date.now() - t) / 100) / 10 };
}
const version = (cmd, args, cwd = "") => run(cmd, args, cwd).out.split("\n")[0].trim();
const src = (path) => readFileSync(`${ROOT}${path}`, "utf8").split("\n");

// ---- Noir circuits ----
function noir() {
  const r = run("nargo", ["test", "--workspace"], "circuits");
  const groups = {};
  for (const m of r.out.matchAll(/^\[(\w+)\] Testing (\S+) \.\.\. (\w+)/gm)) {
    (groups[m[1]] ??= []).push({ name: m[2], pass: m[3] === "ok" });
  }
  const suites = Object.entries(groups).map(([name, tests]) => ({ name, tests: tests.sort((a, b) => a.name.localeCompare(b.name)) }));
  return { ok: r.ok, seconds: r.seconds, suites, ...count(suites) };
}

// ---- Foundry ----
function forge() {
  const r = run("forge", ["test"], "contracts");
  const suites = [];
  let cur = null;
  for (const line of r.out.split("\n")) {
    const s = line.match(/^Ran \d+ tests? for (\S+):(\w+)/);
    if (s) suites.push((cur = { name: s[2], file: s[1], tests: [] }));
    const t = line.match(/^\[(PASS|FAIL)[^\]]*\] (\w+)\(([^)]*)\)(?: \((.*)\))?/);
    if (t && cur) {
      const runs = t[4]?.match(/runs: (\d+)/)?.[1];
      const kind = t[2].startsWith("invariant") ? "invariant" : runs ? "fuzz" : "unit";
      cur.tests.push({ name: t[2], pass: t[1] === "PASS", kind, ...(runs ? { runs: Number(runs) } : {}) });
    }
  }
  suites.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: r.ok, seconds: r.seconds, suites, ...count(suites) };
}

// ---- CRE workflow (bun) ----
function cre() {
  const r = run("bun", ["test"], "cre/resolver");
  const names = [...src("cre/resolver/main.test.ts").join("\n").matchAll(/test\('([^']+)'/g)].map((m) => m[1]);
  const passed = Number(r.out.match(/(\d+) pass/)?.[1] ?? 0);
  const failed = Number(r.out.match(/(\d+) fail/)?.[1] ?? 0);
  const tests = names.map((name) => ({ name, pass: r.ok }));
  return { ok: r.ok && failed === 0, seconds: r.seconds, suites: [{ name: "resolver", tests }], passed, failed, total: passed + failed };
}

function count(suites) {
  const all = suites.flatMap((s) => s.tests);
  const passed = all.filter((t) => t.pass).length;
  return { passed, failed: all.length - passed, total: all.length };
}

// ---- Lean ----
const THEOREMS = [
  { name: "spend_conserves_value", file: "lean/QuietOdds/Spend.lean" },
  { name: "redeem_payout_exact", file: "lean/QuietOdds/Redeem.lean" },
  { name: "redeem_fee_sound", file: "lean/QuietOdds/Redeem.lean" },
  { name: "pro_rata_conserves", file: "lean/QuietOdds/ProRata.lean" },
  { name: "pro_rata_dust_lt_card", file: "lean/QuietOdds/ProRata.lean" },
  { name: "sandwich_unprofitable", file: "lean/QuietOdds/Sandwich.lean" },
  { name: "sandwich_unprofitable_fee_rule", file: "lean/QuietOdds/Sandwich.lean" },
  { name: "capped_fee_counterexample", file: "lean/QuietOdds/Sandwich.lean" },
];

/// The theorem's statement exactly as written: from `theorem name` up to `:= by` (or `:=`).
function statement(file, name) {
  const lines = src(file);
  const start = lines.findIndex((l) => l.startsWith(`theorem ${name} `));
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const body = [];
  for (let i = start; i < lines.length; i++) {
    const end = lines[i].search(/ :=( by)?$/);
    body.push(end >= 0 ? lines[i].slice(0, end) : lines[i]);
    if (end >= 0 || lines[i].trimEnd().endsWith(":=")) break;
  }
  return { line: start + 1, statement: body.join("\n").replace(/\s*:=$/, "") };
}

function lean() {
  const r = run("lake", ["build"], "lean");
  const axioms = {};
  for (const m of r.out.matchAll(/'QuietOdds\.(\w+)' depends on axioms: \[([^\]]*)\]/g)) axioms[m[1]] = m[2].split(",").map((s) => s.trim());
  const files = ["Field", "Spend", "Redeem", "ProRata", "Sandwich", "Axioms"].map((f) => `lean/QuietOdds/${f}.lean`);
  const sorries = files.reduce((n, f) => n + src(f).filter((l) => /\bsorry\b/.test(l) && !l.trim().startsWith("--")).length, 0);
  const custom = files.reduce((n, f) => n + src(f).filter((l) => /^\s*axiom\s/.test(l)).length, 0);
  const theorems = THEOREMS.map((t) => ({ ...t, ...statement(t.file, t.name), axioms: axioms[t.name] ?? null }));
  const toolchain = readFileSync(`${ROOT}lean/lean-toolchain`, "utf8").trim();
  return {
    ok: r.ok && theorems.every((t) => t.axioms && !t.axioms.includes("sorryAx")),
    seconds: r.seconds,
    jobs: Number(r.out.match(/Build completed successfully \((\d+) jobs\)/)?.[1] ?? 0),
    sorries,
    customAxioms: custom,
    toolchain,
    theorems,
  };
}

/// Circuit lines the Lean theorems model, copied from the source.
function snippet(path, from, to) {
  const lines = src(path);
  return { path, from, to, code: lines.slice(from - 1, to).join("\n") };
}

const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout.trim();

const report = {
  generatedAt: new Date().toISOString(),
  commit: git(["rev-parse", "HEAD"]),
  tools: {
    nargo: version("nargo", ["--version"]).replace("nargo version = ", ""),
    forge: version("forge", ["--version"]).replace(/^forge Version: /i, ""),
    lean: "",
    bun: version("bun", ["--version"]),
  },
  lean: lean(),
  noir: noir(),
  forge: forge(),
  cre: cre(),
  snippets: {
    spend: snippet("circuits/spend/src/main.nr", 50, 54),
    redeem: snippet("circuits/redeem/src/main.nr", 66, 79),
    fee: snippet("contracts/src/QuietOddsHook.sol", 205, 222),
  },
};
report.tools.lean = report.lean.toolchain;

writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
const s = (k) => `${report[k].passed}/${report[k].total}`;
console.log(`\nLean: ${report.lean.ok ? "ok" : "FAILED"} (${report.lean.theorems.length} theorems, ${report.lean.sorries} sorry)  Noir: ${s("noir")}  Foundry: ${s("forge")}  CRE: ${s("cre")}`);
console.log(`wrote ${OUT}`);
if (![report.lean, report.noir, report.forge, report.cre].every((x) => x.ok)) process.exit(1);
