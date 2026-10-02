import { institutions } from "@/data/institutions";
import type { Institution } from "@/types";

/**
 * Resolving an institution reference to a real profile page.
 *
 * SERVER COMPONENTS ONLY. Importing this from a client component would pull the
 * whole 51-record directory — including every evidence object — into the browser
 * bundle. Client components must be handed an already-resolved boolean instead.
 *
 * Two different defects make a naive `/institutions/${slug}` link wrong, and both
 * were shipping live 404s before this existed:
 *
 * 1. `lib/alerts.ts` assigns `institutionSlug: s.institutionId` on coverage
 *    alerts, so those links read `/institutions/mfi-039`. That field holds an
 *    identifier, not a slug. Coverage alerts are resolved by id instead.
 *
 * 2. `NrbRegulatoryEvent.institutionSlug` sometimes names an entity that no
 *    longer has its own directory row — Matribhumi, Sampada, Cyc Nepal and four
 *    others were merged or renamed away, so the directory has no page to link to.
 *    The event record itself is real and stays published; only the link is
 *    unavailable, and it must be omitted rather than left pointing at a 404.
 *
 * Both cases return `null` rather than a best guess. Fabricating a link to a
 * similarly-named institution would be worse than having none.
 */

const bySlug = new Map<string, Institution>(institutions.map((i) => [i.slug, i]));
const byId = new Map<string, Institution>(institutions.map((i) => [i.id, i]));

/** The profile path for a slug, or `null` when no directory page exists for it. */
export function institutionHrefForSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return bySlug.has(slug) ? `/institutions/${slug}` : null;
}

/** The profile path for an institution id, or `null` when it is not in the directory. */
export function institutionHrefForId(id: string | null | undefined): string | null {
  if (!id) return null;
  const inst = byId.get(id);
  return inst ? `/institutions/${inst.slug}` : null;
}

/** Display name for a slug, falling back to the raw slug rather than blanking it. */
export function institutionNameForSlug(
  slug: string | null | undefined,
  fallback?: string | null,
): string | null {
  if (slug) {
    const inst = bySlug.get(slug);
    if (inst) return inst.name;
  }
  return fallback ?? slug ?? null;
}
