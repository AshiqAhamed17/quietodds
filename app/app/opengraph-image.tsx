import { ImageResponse } from "next/og";

export const alt = "QuietOdds: private prediction markets on Ethereum";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/// Share card for every page: the ring glyph, the name and the one-line promise.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "radial-gradient(circle at 78% 30%, #1a2236 0%, #050506 55%)",
          color: "#f5f6f8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 999, border: "4px solid #f5f6f8", boxShadow: "0 0 24px rgba(150,180,255,0.7)" }} />
          <div style={{ fontSize: 44, letterSpacing: -1 }}>QuietOdds</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>Nobody sees your bet.</div>
          <div style={{ fontSize: 30, color: "#a9afbd", maxWidth: 940 }}>
            Private prediction markets on Ethereum. Zero-knowledge proofs, formally verified in Lean.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#6f7584" }}>Noir · Uniswap v4 · Chainlink · Anon-RPC</div>
      </div>
    ),
    size,
  );
}
