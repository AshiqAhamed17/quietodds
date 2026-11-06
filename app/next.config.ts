import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @quietodds/lib ships TypeScript source (shared with the relayer and scripts).
  transpilePackages: ["@quietodds/lib"],
};

export default nextConfig;
