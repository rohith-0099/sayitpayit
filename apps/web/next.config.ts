import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets verification builds run in a separate folder (NEXT_DIST_DIR=.next-verify) so they never
  // share Turbopack's cache with a running `next dev` (sharing it left dev serving stale modules).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Render free tier (512 MB): a standalone server is much lighter at runtime. Opt-in so local
  // `next start` keeps working. No browser sourcemaps in production builds.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  productionBrowserSourceMaps: false,
  // Dev only: let the cloudflared quick tunnel (used to receive PayPal webhooks locally)
  // reach dev endpoints like the HMR websocket. Without it, a page opened through the
  // tunnel can't connect HMR and the dev client reload-loops. Ignored by `next build`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Keep screen recordings clean (no Next.js dev badge).
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
