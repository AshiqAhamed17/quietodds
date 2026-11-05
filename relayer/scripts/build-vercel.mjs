// Builds .vercel/output (Vercel Build Output API) for `vercel deploy --prebuilt`.
// esbuild bundles the relayer, the shared lib and its JSON; bb.js stays a real
// package because it loads its WASM from disk. Only the linux binaries ship.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELAYER = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_MODULES = join(RELAYER, "../node_modules");
const OUT = join(RELAYER, ".vercel/output");
const FUNC = join(OUT, "functions/index.func");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FUNC, { recursive: true });

await build({
  entryPoints: [join(RELAYER, "src/vercel.ts")],
  outfile: join(FUNC, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@aztec/bb.js", "@noir-lang/noir_js"],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});

// bb.js and its runtime dependencies, without the 130MB of other platforms' binaries.
const require = createRequire(join(ROOT_MODULES, "@aztec/bb.js/package.json"));
const bbPkg = require("./package.json");
const copyPkg = (name, filter) => {
  const src = join(ROOT_MODULES, name);
  cpSync(src, join(FUNC, "node_modules", name), { recursive: true, dereference: true, filter });
};
copyPkg("@aztec/bb.js", (p) => !/\/build\/(?!amd64-linux)|\/dest\/(browser|node-cjs)/.test(p));
for (const dep of Object.keys(bbPkg.dependencies ?? {})) copyPkg(dep);
writeFileSync(join(FUNC, "package.json"), JSON.stringify({ type: "module" }));

writeFileSync(
  join(FUNC, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 300, memory: 2048, shouldAddHelpers: false, supportsResponseStreaming: true }, null, 2),
);
writeFileSync(join(OUT, "config.json"), JSON.stringify({ version: 3, routes: [{ src: "/", dest: "/index" }, { src: "/(.*)", dest: "/index" }] }, null, 2));
console.log("built .vercel/output");
