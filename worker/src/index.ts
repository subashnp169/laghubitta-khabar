// ============================================================================
// Laghubitta Khabar — API Worker.
//
// Route surface (docs/API-CONTRACT.md), read-only V1:
//   GET /api/institutions[?q=&status=&page=&limit=]
//   GET /api/institutions/:slug
//   GET /api/institutions/:slug/{leadership|branches|financials|documents|events|jobs}
//   GET /api/news[?tier=&page=&limit=]
//   GET /api/search?q=
//   GET /api/people/:slug
//   GET /api/interest-rates
//   GET /go/:scopeKey/:slug   → 302 redirect door (outbound_links, noindex)
//
// The ONLY Next-layer coupling is the response envelope helpers (lib/api.ts,
// which is framework-agnostic Response). React components never touch D1.
// ============================================================================

import { apiError, collection, handleError, parsePage, single } from "../../lib/api";
import { D1InstitutionRepository, type D1Database } from "../../lib/repository/d1";
import { NotFoundError } from "../../lib/repository/contract";
import type { NewsTier, VerificationStatus } from "../../lib/repository/types";

export interface Env {
  DB: D1Database;
}

const VALID_TIERS = new Set(["OFFICIAL", "NRB", "KHABAR", "MEDIA"]);

const CACHE_DETAIL = {
  headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const repo = new D1InstitutionRepository(env.DB);
    const url = new URL(request.url);
    const path = url.pathname;

    if (!request.method || request.method.toUpperCase() !== "GET") {
      return apiError("VALIDATION", "Only GET is supported (read-only V1).", 405);
    }

    try {
      // ---- /api/institutions ----
      if (path === "/api/institutions") return await handleInstitutions(url.searchParams, repo);
      const detailMatch = path.match(/^\/api\/institutions\/([^/]+)$/);
      if (detailMatch) return await handleInstitution(detailMatch[1], repo);
      const subMatch = path.match(/^\/api\/institutions\/([^/]+)\/([^/]+)$/);
      if (subMatch) return await handleSubResource(subMatch[1], subMatch[2], repo);

      if (path === "/api/news") return await handleNews(url.searchParams, repo);
      if (path === "/api/search") return await handleSearch(url.searchParams, repo);
      if (path === "/api/interest-rates") return await handleInterestRates(repo);

      const peopleMatch = path.match(/^\/api\/people\/([^/]+)$/);
      if (peopleMatch) return await handlePeople(peopleMatch[1], repo);

      const goMatch = path.match(/^\/go\/([^/]+)\/([^/]+)/);
      if (goMatch) return await handleGo(goMatch[1], goMatch[2], repo);

      return apiError("NOT_FOUND", `No route for ${path}`, 404);
    } catch (e) {
      return handleError(e);
    }
  },
};

async function handleInstitutions(sp: URLSearchParams, repo: D1InstitutionRepository) {
  const { page, limit } = parsePage(sp);
  const result = await repo.listInstitutions({
    q: sp.get("q") || undefined,
    status: sp.get("status") || undefined,
    page,
    limit,
  });
  return collection(
    result.data.map((i) => ({
      ...i,
      meta: {
        source: i.meta.source,
        sources: i.meta.sources,
        last_verified_at: i.meta.last_verified_at,
        verification_status: i.meta.verification_status as VerificationStatus,
      },
    })),
    result.pagination,
  );
}

async function handleInstitution(slug: string, repo: D1InstitutionRepository) {
  const inst = await repo.getInstitutionBySlug(slug);
  if (!inst) throw new NotFoundError(`No institution with slug '${slug}'`);
  return single(inst, inst.meta, CACHE_DETAIL);
}

const SUB_RESOURCES: Record<string, (slug: string, repo: D1InstitutionRepository) => Promise<Response>> = {
  leadership: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    const r = await repo.listLeadership(inst.id);
    return collection(r.data, r.pagination);
  },
  branches: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    const r = await repo.listBranches(inst.id);
    return collection(r.data, r.pagination);
  },
  financials: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    const r = await repo.listFinancials(inst.id);
    return collection(r.data, r.pagination);
  },
  documents: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    const r = await repo.listDocuments(inst.id);
    return collection(r.data, r.pagination);
  },
  events: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    return collection(inst.timeline, { page: 1, limit: inst.timeline.length, total: inst.timeline.length });
  },
  jobs: async (slug, repo) => {
    const inst = await requireInstitution(slug, repo);
    const r = await repo.listJobs(inst.id);
    return collection(r.data, r.pagination);
  },
};

async function handleSubResource(slug: string, resource: string, repo: D1InstitutionRepository) {
  const handler = SUB_RESOURCES[resource];
  if (!handler) throw new NotFoundError(`Unknown sub-resource '${resource}'`);
  return handler(slug, repo);
}

async function requireInstitution(slug: string, repo: D1InstitutionRepository) {
  const inst = await repo.getInstitutionBySlug(slug);
  if (!inst) throw new NotFoundError(`No institution with slug '${slug}'`);
  return inst;
}

async function handleNews(sp: URLSearchParams, repo: D1InstitutionRepository) {
  const { page, limit } = parsePage(sp);
  const tier = sp.get("tier")?.toUpperCase() as NewsTier | null;
  if (tier && !VALID_TIERS.has(tier)) {
    return apiError("VALIDATION", `tier must be one of ${[...VALID_TIERS].join(", ")}`, 422);
  }
  const result = await repo.listNews({ tier: tier ?? undefined, page, limit });
  return collection(result.data, result.pagination, {
    tiers: { OFFICIAL: 0, NRB: 0, KHABAR: 0, MEDIA: 0 }, // Phase D fills real counts
  });
}

async function handleSearch(sp: URLSearchParams, repo: D1InstitutionRepository) {
  const query = sp.get("q")?.trim();
  if (!query) return apiError("VALIDATION", "Query parameter 'q' is required.", 422);
  const groups = await repo.search(query);
  return single(
    { query, groups },
    { source: "institution+alias index", sources: ["institution+alias index"], last_verified_at: null, verification_status: "AUTO_VERIFIED" },
  );
}

async function handleInterestRates(repo: D1InstitutionRepository) {
  const result = await repo.listInterestRates();
  return collection(result.data, result.pagination);
}

async function handlePeople(slug: string, repo: D1InstitutionRepository) {
  const person = await repo.getPersonBySlug(slug);
  if (!person) throw new NotFoundError(`No person with slug '${slug}'`);
  return single(person, person.meta);
}

async function handleGo(scopeKey: string, slug: string, repo: D1InstitutionRepository) {
  const link = await repo.resolveOutboundLink(scopeKey, slug);
  if (!link) throw new NotFoundError(`No outbound link for '/go/${scopeKey}/${slug}'`);
  return Response.redirect(link.target_url, 302);
}
