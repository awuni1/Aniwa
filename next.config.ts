import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Lets a phone load the dev server through a Cloudflare quick tunnel
  // (README: "Phone as a chainsaw listener"). Dev-only; ignored in production.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
