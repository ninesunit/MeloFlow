import type { NextConfig } from "next";

/**
 * MeloFlow is served as a static site from Firebase Hosting.
 * All data access happens in the browser through the Firebase SDK,
 * and anything that needs a secret (Gemini) runs in Cloud Functions.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
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
