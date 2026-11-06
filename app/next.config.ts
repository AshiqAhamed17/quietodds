import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @quietodds/lib ships TypeScript source (shared with the relayer and scripts).
  transpilePackages: ["@quietodds/lib"],
  // Cross-origin isolation lets bb.js prove on every core (SharedArrayBuffer).
  // `credentialless` keeps cross-origin fetches (RPC, relayer) working without CORP headers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
