import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/laghubitta-khabar",
  assetPrefix: "/laghubitta-khabar/",
  // GitHub Pages serves directory index files (/institutions/slug/) but does NOT
  // resolve extensionless nested paths (/institutions/slug -> slug.html).
  // Without this, every institution link 404s on the deployed staging site.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
