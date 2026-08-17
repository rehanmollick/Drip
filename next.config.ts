import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false, // keeps 393×852 dev screenshots honest (the badge sat on the ask bar)
  // jsdom + readability + shiki run on the server only; keep them out of the client bundle.
  serverExternalPackages: ["jsdom", "@mozilla/readability", "shiki"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
