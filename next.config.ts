import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// `next dev` and `next build`/`next start` use separate output folders, so starting a dev server can never
// overwrite the production build that a running `next start` is serving (which breaks every page).
export default function config(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Compact self-contained server for the Docker image (see Dockerfile); local `npm start` is unaffected.
    ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
    poweredByHeader: false,
    serverExternalPackages: ["exceljs", "mongodb"],
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Frame-Options", value: "DENY" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ],
        },
      ];
    },
  };
}
