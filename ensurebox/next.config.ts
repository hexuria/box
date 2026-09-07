import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["grok-box"],
  // The grok-box SDK lives at ../sdk/typescript. Turbopack otherwise refuses
  // to resolve a file: dependency above the app directory.
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
};

export default nextConfig;
