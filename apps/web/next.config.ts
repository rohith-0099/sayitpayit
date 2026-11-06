import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
