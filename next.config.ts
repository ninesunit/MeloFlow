import type { NextConfig } from "next";

/**
 * MeloFlow runs on Vercel (free Hobby plan). Pages talk to Firebase Auth and
 * Firestore (free Spark plan) from the browser; the only server code is the
 * /api/gemini route, which keeps GEMINI_API_KEY off the client.
 */
const nextConfig: NextConfig = {
  trailingSlash: true,
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
