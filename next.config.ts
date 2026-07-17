import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/laghubitta-khabar",
  assetPrefix: "/laghubitta-khabar/",
  images: { unoptimized: true },
};

export default nextConfig;
