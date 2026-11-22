import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the API route body limit generous enough for a resized photo.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
