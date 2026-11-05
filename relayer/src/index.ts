import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { buildApp } from "./build.ts";

const cfg = loadConfig();
const { relayer, app } = await buildApp(cfg);

serve({ fetch: app.fetch, port: cfg.port }, ({ port }) => {
  console.log(`relayer ${relayer.address} on :${port}, pool ${cfg.pool}`);
});
