import type { MetadataRoute } from "next";
import { buildSitemapEntries } from "@/util/seo";
import { allPublishedPeople } from "../../lib/repository/static-people";

/**
 * `/sitemap.xml` for the deployed site.
 *
 * The list comes from `@/util/seo`, the same source the smoke tests, so the
 * shipped sitemap and the tested contract cannot disagree. People slugs are read
 * from the published projection (the same one `/people/{slug}` is generated
 * from), so the sitemap can never advertise a person page that does not exist.
 */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const personSlugs = allPublishedPeople().map((p) => p.slug);
  return buildSitemapEntries(personSlugs);
}
