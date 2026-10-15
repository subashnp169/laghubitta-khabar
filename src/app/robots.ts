import type { MetadataRoute } from "next";
import { buildRobots } from "@/util/seo";

/**
 * `/robots.txt` for the deployed site. The rule and the sitemap pointer come
 * from `@/util/seo` so they match the sitemap the site actually emits.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const { rules, sitemap } = buildRobots();
  return {
    rules: { userAgent: rules.userAgent, allow: rules.allow },
    sitemap,
  };
}
