// Bundles the smoke page, serves it locally, and runs it in headless Chromium.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [join(dir, "main.js")], bundle: true, format: "esm", outfile: join(dir, "bundle.js") });

const server = createServer(async (req, res) => {
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  try {
    const body = await readFile(join(dir, file));
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(5178);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
await page.goto("http://localhost:5178/");
await page.waitForFunction(() => /ANON_RPC_(OK|FAIL)/.test(document.getElementById("out").textContent), null, { timeout: 180_000 });
const out = await page.textContent("#out");
await browser.close();
server.close();
process.exit(out.includes("ANON_RPC_OK") ? 0 : 1);
