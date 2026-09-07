import type { NextConfig } from "next";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  transpilePackages: ["grok-box"],
  // The grok-box package is a file: link into ../sdk/typescript. Turbopack
  // only resolves modules at or below `root`, which defaults to this app.
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
