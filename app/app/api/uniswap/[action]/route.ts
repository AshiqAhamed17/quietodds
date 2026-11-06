// Server-side proxy to the Uniswap Trading API. The API key (UNISWAP_API_KEY)
// stays on the server; the browser only ever talks to this route.
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const BASE = "https://trade-api.gateway.uniswap.org/v1";
const ACTIONS = new Set(["quote", "check_approval", "swap"]);
const SEPOLIA = 11155111;
const MAX_BODY = 64 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "unknown action" }, { status: 404 });
  const key = process.env.UNISWAP_API_KEY;
  if (!key) return NextResponse.json({ error: "UNISWAP_API_KEY is not configured on the server" }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "body too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Sepolia only: this deployment is a testnet demo.
  const chain = body.tokenInChainId ?? body.chainId ?? (body.quote as { chainId?: number } | undefined)?.chainId;
  if (chain !== undefined && Number(chain) !== SEPOLIA) return NextResponse.json({ error: "Sepolia only" }, { status: 400 });

  const res = await fetch(`${BASE}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
}
