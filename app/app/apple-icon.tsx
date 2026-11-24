import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/// The nav glyph (a lit ring) as the home-screen icon.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#050506" }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, border: "10px solid #f5f6f8", boxShadow: "0 0 36px rgba(150,180,255,0.6)" }} />
      </div>
    ),
    size,
  );
}
