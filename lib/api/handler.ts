// ============================================================================
// Phase 3 (M3.1) — pure HTTP router: {method, url} → {status, contentType, body}.
// No sockets here (importable + testable); scripts/api-server.ts wires node:http.
// Implements the frozen docs/API-CONTRACT.md routes.
// ============================================================================

import {
  getInstitution,
  getPerson,
  institutionDocuments,
  institutionEvents,
  institutionJobs,
  institutionLeadership,
  emptyPhaseEnvelope,
  listInstitutions,
  search,
} from "./repository";
import { errorEnvelope } from "./contract";

export interface ApiRequest {
  method: string;
  url: string;
}

export interface ApiResponse {
  status: number;
  contentType?: string;
  body: string;
}

const JSON_TYPE = "application/json; charset=utf-8";

function readQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

const PHASE_EMPTY_ROUTES = ["branches", "financials"] as const;

export function handleApiRequest(req: ApiRequest): ApiResponse {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const { status, body } = errorEnvelope("METHOD_NOT_ALLOWED", "This API is read-only; only GET is supported");
    return { status, contentType: JSON_TYPE, body: JSON.stringify(body) };
  }

  const query = readQuery(req.url);
  const pathname = req.url.split("?")[0].replace(/\/+$/, "") || "/";
  const segs = pathname.split("/").filter(Boolean);

  const respond = (out: { status: number; body: unknown }): ApiResponse => ({
    status: out.status,
    contentType: JSON_TYPE,
    body: JSON.stringify(out.body),
  });

  if (segs[0] !== "api") return respond(errorEnvelope("NOT_FOUND", `Unknown path '${pathname}'`));

  switch (segs[1]) {
    case "institutions": {
      if (segs.length === 2) {
        return respond(
          listInstitutions({
            q: query.get("q") ?? undefined,
            province: query.get("province") ?? undefined,
            status: query.get("status") ?? undefined,
            page: query.get("page"),
            limit: query.get("limit"),
          }),
        );
      }
      const slug = segs[2];
      const requested = { page: query.get("page"), limit: query.get("limit") };
      switch (segs[3]) {
        case undefined:
          return respond(getInstitution(slug));
        case "documents":
          return respond(institutionDocuments(slug, requested));
        case "events":
          return respond(institutionEvents(slug, requested));
        case "jobs":
          return respond(institutionJobs(slug, requested));
        case "leadership":
          return respond(institutionLeadership(slug, requested));
        case "interest-rates":
          return respond({ status: 200, body: emptyPhaseEnvelope(requested.page, requested.limit) });
        default: {
          const leaf = segs[3];
          if (leaf && (PHASE_EMPTY_ROUTES as readonly string[]).includes(leaf))
            return respond({ status: 200, body: emptyPhaseEnvelope(requested.page, requested.limit) });
          return respond(errorEnvelope("NOT_FOUND", `No such endpoint '/api/institutions/${slug}/${leaf ?? ""}'`));
        }
      }
    }
    case "people": {
      if (segs.length === 2) return respond(errorEnvelope("NOT_FOUND", "No such endpoint '/api/people'"));
      return respond(getPerson(segs[2]));
    }
    case "search":
      return respond(search({ q: query.get("q") }));
    case "interest-rates":
      return respond({ status: 200, body: emptyPhaseEnvelope(query.get("page"), query.get("limit")) });
    default:
      return respond(errorEnvelope("NOT_FOUND", `No such endpoint '/${segs.join("/")}'`));
  }
}