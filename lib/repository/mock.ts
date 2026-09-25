// ============================================================================
// Mock adapter — in-memory, backed by the master universe snapshot
// (data/master/master.json). Used for dev/build/SSG where no D1 binding or
// local SQLite exists. Implements the same InstitutionRepository contract;
// swapping to D1 at deploy is a one-line config change (see factory in
// lib/repository/index.ts).
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AliasDto,
  BranchDto,
  DocumentDto,
  FinancialReportDto,
  InstitutionDetail,
  InstitutionSummary,
  InterestRateDto,
  JobDto,
  ListInstitutionsOptions,
  ListNewsOptions,
  NewsItemDto,
  OutboundLinkDto,
  Paged,
  PersonDto,
  SearchGroups,
} from "./types";
import type { InstitutionRepository } from "./contract";

interface MasterFile {
  universeSnapshot?: { source_id: string; observed_at: string };
  institutions: Array<{
    id: string; slug: string; name_en: string; name_np: string | null;
    short_name: string; institution_type: string; status: string;
    established: number | null; head_office_district: string | null;
    head_office_municipality: string | null; working_area: string | null;
    official_website: string | null; official_email: string | null;
    official_phone: string | null; logo_url: string | null;
    source_id: string; last_verified_at: string | null;
  }>;
  aliases: Array<{ institution_id: string; alias: string; normalized_alias: string; alias_type: string; source_grade: string }>;
  officialLinks: Array<{ institution_id: string; link_type: string; label: string; url: string; canonical_url: string | null; verified: number; verified_at: string | null; status: string; source_id: string; last_checked_at: string | null }>;
  timeline: Array<{ institution_id: string | null; event_type: string; title: string; occurred_at: string | null; summary: string; source_id: string; predecessor_id: string; predecessor_name: string }>;
}

let cached: MasterFile | null = null;
function master(): MasterFile {
  if (cached) return cached;
  cached = JSON.parse(
    readFileSync(join(process.cwd(), "data/master/master.json"), "utf8"),
  ) as MasterFile;
  return cached;
}

function qopts<T>(list: T[], opts: { page: number; limit: number }): Paged<T> {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 20));
  const total = list.length;
  return { data: list.slice((page - 1) * limit, page * limit), pagination: { page, limit, total } };
}

function summaryOf(i: MasterFile["institutions"][number]): InstitutionSummary {
  return {
    id: i.id,
    slug: i.slug,
    name_en: i.name_en,
    name_np: i.name_np,
    short_name: i.short_name,
    institution_type: i.institution_type === "NATIONAL" ? "NATIONAL" : "PROVINCIAL",
    status: (i.status as InstitutionSummary["status"]) || "ACTIVE",
    established: i.established,
    head_office_district: i.head_office_district,
    head_office_municipality: i.head_office_municipality,
    official_website: i.official_website,
    official_email: i.official_email,
    official_phone: i.official_phone,
    logo_url: i.logo_url,
    meta: {
      source: i.source_id,
      last_verified_at: i.last_verified_at,
      verification_status: "AUTO_VERIFIED",
    },
  };
}

export class MockInstitutionRepository implements InstitutionRepository {
  private bySlug = new Map(master().institutions.map((i) => [i.slug, i]));
  private byId = new Map(master().institutions.map((i) => [i.id, i]));

  async listInstitutions(opts: ListInstitutionsOptions): Promise<Paged<InstitutionSummary>> {
    let rows = master().institutions;
    if (opts.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((i) => {
        const aliasHit = master().aliases.some(
          (a) => a.institution_id === i.id && a.normalized_alias.includes(q),
        );
        return i.name_en.toLowerCase().includes(q) || i.short_name.toLowerCase().includes(q) || aliasHit;
      });
    }
    if (opts.status) rows = rows.filter((i) => i.status === opts.status);
    return qopts(rows.map(summaryOf), opts);
  }

  async getInstitutionBySlug(slug: string): Promise<InstitutionDetail | null> {
    const i = this.bySlug.get(slug);
    return i ? this.detailOf(i) : null;
  }

  async getInstitutionById(id: string): Promise<InstitutionDetail | null> {
    const i = this.byId.get(id);
    return i ? this.detailOf(i) : null;
  }

  private detailOf(i: MasterFile["institutions"][number]): InstitutionDetail {
    const m = master();
    return {
      ...summaryOf(i),
      aliases: m.aliases
        .filter((a) => a.institution_id === i.id)
        .map((a) => ({
          alias: a.alias,
          alias_type: (a.alias_type as AliasDto["alias_type"]) || "NAME_ALT",
          is_active: true,
          source_id: "nrb-bfi-mid-may-2026",
          last_verified_at: null,
        })),
      official_links: m.officialLinks
        .filter((l) => l.institution_id === i.id)
        .map((l) => ({
          link_type: l.link_type,
          label: l.label,
          url: l.url,
          canonical_url: l.canonical_url,
          status: (l.status as "VERIFIED" | "CANDIDATE" | "STALE" | "FAILED") || "CANDIDATE",
          verified_at: l.verified_at,
          last_checked_at: l.last_checked_at,
        })),
      timeline: m.timeline
        .filter((e) => e.institution_id === i.id)
        .map((e) => ({
          event_type: e.event_type as InstitutionDetail["timeline"][number]["event_type"],
          title: e.title,
          occurred_at: e.occurred_at,
          summary: e.summary,
        })),
      coverage: null, // seed sets NOT_STARTED coverage; mock reflects no researched data yet
      go_slug: `/go/${i.id}/website`,
    };
  }

  async listLeadership(_institutionId: string): Promise<Paged<PersonDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async listBranches(_institutionId: string): Promise<Paged<BranchDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async listFinancials(_institutionId: string): Promise<Paged<FinancialReportDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async listDocuments(_institutionId: string): Promise<Paged<DocumentDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async listJobs(_institutionId: string): Promise<Paged<JobDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async getPersonBySlug(_slug: string): Promise<PersonDto | null> {
    return null;
  }
  async listNews(_opts: ListNewsOptions): Promise<Paged<NewsItemDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async search(query: string): Promise<SearchGroups> {
    const q = query.toLowerCase();
    return {
      institutions: master().institutions
        .filter((i) => i.name_en.toLowerCase().includes(q) || i.short_name.toLowerCase().includes(q))
        .slice(0, 10)
        .map(summaryOf),
      people: [],
      documents: [],
    };
  }
  async listInterestRates(): Promise<Paged<InterestRateDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  async resolveOutboundLink(scopeKey: string, slug: string): Promise<OutboundLinkDto | null> {
    const inst = this.byId.get(scopeKey);
    if (!inst || slug !== "website") return null;
    const link = master().officialLinks.find((l) => l.institution_id === inst.id);
    if (!link) return null;
    return {
      scope_key: inst.id,
      slug: "website",
      target_type: "WEBSITE",
      label: link.label,
      target_url: link.url,
      canonical_url: link.canonical_url,
      availability_status: "UNKNOWN",
      last_checked_at: null,
    };
  }
}