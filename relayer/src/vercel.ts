// Vercel function entry: one warm instance serves many requests, so the
// prover and the send queue are built once per instance.
import { handle } from "hono/vercel";
import { loadConfig } from "./config.ts";
import { buildApp } from "./build.ts";

const { app } = await buildApp(loadConfig());
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
