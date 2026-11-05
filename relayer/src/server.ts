import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { getAddress } from "viem";
import { z } from "zod";
import { RelayError, type Relayer } from "./relayer.ts";

const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "hex bytes") as z.ZodType<`0x${string}`>;
const uint = z
  .union([z.string().regex(/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v))
  .refine((v) => v < 2n ** 256n, "out of range");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => getAddress(a));

const spendSchema = z.object({
  args: z.object({
    root: uint, nullifierHash: uint, asset: uint, changeCommitment: uint, publicAmount: uint, actionType: uint,
    actionParam1: uint, actionParam2: uint, outPrecommitment: uint, relayer: address, fee: uint, recipient: address,
  }),
  proof: hex,
  changeCiphertext: hex,
  outCiphertext: hex,
});

const redeemSchema = z.object({
  args: z.object({
    root: uint, nullifierHash: uint, kind: uint, id: uint, outCommitment: uint, relayer: address, fee: uint,
  }),
  proof: hex,
  outCiphertext: hex,
});

const issueText = (i?: z.core.$ZodIssue) => (i ? `${i.path.join(".") || "body"}: ${i.message}` : "invalid");

/**
 * Fixed-window limiter in memory. Keys are only compared, never logged or
 * stored past the window, so the relayer keeps no record of who called.
 */
function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c: Context, next: () => Promise<void>) => {
    const key = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > limit) return c.json({ error: "rate limited, try again in a minute" }, 429);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    await next();
  };
}

export function createApp(relayer: Relayer, opts: { corsOrigin?: string; submitLimitPerMinute?: number } = {}) {
  const app = new Hono();
  app.use("*", cors({ origin: opts.corsOrigin ?? "*" }));
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.use("*", rateLimit(120, 60_000));

  const submitLimit = rateLimit(opts.submitLimitPerMinute ?? 20, 60_000);

  app.get("/", (c) =>
    c.json({
      service: "QuietOdds relayer",
      relayer: relayer.address,
      routes: ["GET /health", "GET /fee-quote", "POST /spend", "POST /redeem"],
      source: "https://github.com/AshiqAhamed17/quietodds/tree/main/relayer",
    }),
  );
  app.get("/health", async (c) => c.json(await relayer.health()));
  app.get("/fee-quote", async (c) => c.json(await relayer.quote()));

  app.post("/spend", submitLimit, async (c) => {
    const parsed = spendSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `bad request: ${issueText(parsed.error.issues[0])}` }, 400);
    return c.json(await relayer.spend(parsed.data));
  });

  app.post("/redeem", submitLimit, async (c) => {
    const parsed = redeemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `bad request: ${issueText(parsed.error.issues[0])}` }, 400);
    return c.json(await relayer.redeem(parsed.data));
  });

  app.onError((e, c) => {
    if (e instanceof RelayError) return c.json({ error: e.message }, e.status);
    console.error("unhandled", e instanceof Error ? e.message : e);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
