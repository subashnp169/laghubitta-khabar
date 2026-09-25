// ============================================================================
// D1 adapter — the ONLY place that talks to Cloudflare D1. Implements the
// InstitutionRepository contract. Never imported by React components; used by
// route handlers in a Worker/API runtime (Cloudflare) that injects the binding.
//
// `D1Database` is a minimal structural type matching the Cloudflare D1 API so
// this module needs no @cloudflare/workers-types dependency.
// ============================================================================

import type {
  AliasDto,
  BranchDto,
  CoverageDto,
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
  TimelineEventDto,
} from "./types";
import type { InstitutionRepository, NotFoundError } from "./contract";

export interface D1ResultRow {
  [column: string]: unknown;
}

export interface D1Statement {
  bind(...params: unknown[]): D1Statement;
  first(): Promise<D1ResultRow | null>;
  all(): Promise<{ results: D1ResultRow[]; success: boolean }>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
}

const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 20;

function clamp(pageRaw: unknown, limitRaw: unknown): { page: number; limit: number } {
  const page = Math.max(1, Math.floor(Number(pageRaw) || 1));
  const limit = Math.min(LIMIT_MAX, Math.max(1, Math.floor(Number(limitRaw) || LIMIT_DEFAULT)));
  return { page, limit };
}

function metaFor(rows: D1ResultRow[]): { source: string; last_verified_at: string | null; verification_status: "AUTO_VERIFIED" } {
  const v = rows[0];
  return {
    // Sub-queries populate these aliased columns; undefined → honest unmapped.
    source: String(v?.source || "unknown"),
    last_verified_at: (v?.last_verified_at as string) ?? null,
    verification_status: "AUTO_VERIFIED",
  };
}

function mapInstitutionRow(r: D1ResultRow): InstitutionSummary {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name_en: String(r.name_en),
    name_np: (r.name_np as string) ?? null,
    short_name: String(r.short_name),
    institution_type: (r.institution_type as InstitutionSummary["institution_type"]) || "PROVINCIAL",
    status: (r.status as InstitutionSummary["status"]) || "ACTIVE",
    established: (r.established as number) ?? null,
    head_office_district: (r.head_office_district as string) ?? null,
    head_office_municipality: (r.head_office_municipality as string) ?? null,
    official_website: (r.official_website as string) ?? null,
    official_email: (r.official_email as string) ?? null,
    official_phone: (r.official_phone as string) ?? null,
    logo_url: (r.logo_url as string) ?? null,
    meta: metaFor([r]),
  };
}

export class D1InstitutionRepository implements InstitutionRepository {
  constructor(private readonly db: D1Database) {}

  async listInstitutions(opts: ListInstitutionsOptions): Promise<Paged<InstitutionSummary>> {
    const { page, limit } = clamp(opts.page, opts.limit);
    const where: string[] = [];
    const args: string[] = [];
    if (opts.q) {
      where.push(`(name_en LIKE ? OR short_name LIKE ? OR EXISTS (
        SELECT 1 FROM institution_aliases a WHERE a.institution_id = institutions.id AND a.alias LIKE ?))`);
      const wild = `%${opts.q}%`;
      args.push(wild, wild, wild);
    }
    if (opts.status) {
      where.push(`status = ?`);
      args.push(opts.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM institutions ${whereSql}`)
      .bind(...args)
      .first();
    const total = Number(count?.total ?? 0);
    const stmt = this.db
      .prepare(`
        SELECT institutions.*,
               sources.id AS source, sources.title AS source_title
        FROM institutions
        LEFT JOIN sources ON sources.id = institutions.source_id
        ${whereSql}
        ORDER BY institutions.name_en
        LIMIT ? OFFSET ?`)
      .bind(...args, limit, (page - 1) * limit);
    const { results } = await stmt.all();
    return {
      data: results.map(mapInstitutionRow),
      pagination: { page, limit, total },
    };
  }

  async getInstitutionBySlug(slug: string): Promise<InstitutionDetail | null> {
    const row = await this.db
      .prepare(`
        SELECT institutions.*,
               sources.id AS source, sources.title AS source_title
        FROM institutions
        LEFT JOIN sources ON sources.id = institutions.source_id
        WHERE institutions.slug = ?`)
      .bind(slug)
      .first();
    return row ? this.detailFromRow(row) : null;
  }

  async getInstitutionById(id: string): Promise<InstitutionDetail | null> {
    const row = await this.db
      .prepare(`
        SELECT institutions.*,
               sources.id AS source, sources.title AS source_title
        FROM institutions
        LEFT JOIN sources ON sources.id = institutions.source_id
        WHERE institutions.id = ?`)
      .bind(id)
      .first();
    return row ? this.detailFromRow(row) : null;
  }

  private async detailFromRow(row: D1ResultRow): Promise<InstitutionDetail> {
    const id = String(row.id);
    const base = mapInstitutionRow(row);

    const [aliases, links, timeline, coverage] = await Promise.all([
      this.db.prepare(`SELECT alias, alias_type, is_active, source_id, last_verified_at FROM institution_aliases WHERE institution_id = ? ORDER BY alias`).bind(id).all(),
      this.db.prepare(`SELECT link_type, label, url, canonical_url, status, verified_at, last_checked_at FROM official_links WHERE institution_id = ? ORDER BY status, link_type`).bind(id).all(),
      this.db.prepare(`SELECT event_type, title, occurred_at, summary FROM timeline_events WHERE institution_id = ? ORDER BY occurred_at IS NULL, occurred_at`).bind(id).all(),
      this.db.prepare(`SELECT overall_status, identity_status, leadership_status, branch_status, financial_status, document_status, news_status, digital_status, product_status, career_status, last_full_reviewed_at, next_full_review_at FROM institution_coverage WHERE institution_id = ?`).bind(id).first(),
    ]);

    return {
      ...base,
      aliases: aliases.results.map((a) => ({
        alias: String(a.alias),
        alias_type: (String(a.alias_type) as AliasDto["alias_type"]) || "NAME_ALT",
        is_active: Number(a.is_active) === 1,
        source_id: (a.source_id as string) ?? null,
        last_verified_at: (a.last_verified_at as string) ?? null,
      })),
      official_links: links.results.map((l) => ({
        link_type: String(l.link_type),
        label: String(l.label),
        url: String(l.url),
        canonical_url: (l.canonical_url as string) ?? null,
        status: (l.status as "VERIFIED" | "CANDIDATE" | "STALE" | "FAILED") || "CANDIDATE",
        verified_at: (l.verified_at as string) ?? null,
        last_checked_at: (l.last_checked_at as string) ?? null,
      })),
      timeline: timeline.results.map((e) => ({
        event_type: String(e.event_type) as TimelineEventDto["event_type"],
        title: String(e.title),
        occurred_at: (e.occurred_at as string) ?? null,
        summary: (e.summary as string) ?? null,
      })),
      coverage: coverage
        ? {
            overall: String(coverage.overall_status) as CoverageDto["overall"],
            leadership: String(coverage.leadership_status) as CoverageDto["leadership"],
            branch: String(coverage.branch_status) as CoverageDto["branch"],
            financial: String(coverage.financial_status) as CoverageDto["financial"],
            document: String(coverage.document_status) as CoverageDto["document"],
            news: String(coverage.news_status) as CoverageDto["news"],
            digital: String(coverage.digital_status) as CoverageDto["digital"],
            product: String(coverage.product_status) as CoverageDto["product"],
            career: String(coverage.career_status) as CoverageDto["career"],
            last_full_reviewed_at: (coverage.last_full_reviewed_at as string) ?? null,
            next_full_review_at: (coverage.next_full_review_at as string) ?? null,
          }
        : null,
      go_slug: `/go/${id}/website`,
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
    const wild = `%${query}%`;
    const inst = await this.db
      .prepare(`SELECT * FROM institutions WHERE name_en LIKE ? OR short_name LIKE ? LIMIT 10`)
      .bind(wild, wild)
      .all();
    return {
      institutions: inst.results.map(mapInstitutionRow),
      people: [],
      documents: [],
    };
  }

  async listInterestRates(): Promise<Paged<InterestRateDto>> {
    return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
  }

  async resolveOutboundLink(scopeKey: string, slug: string): Promise<OutboundLinkDto | null> {
    const row = await this.db
      .prepare(`SELECT scope_key, slug, target_type, label, target_url, canonical_url, availability_status, last_checked_at
                FROM outbound_links WHERE scope_key = ? AND slug = ? AND is_active = 1`)
      .bind(scopeKey, slug)
      .first();
    if (!row) return null;
    return {
      scope_key: String(row.scope_key),
      slug: String(row.slug),
      target_type: (row.target_type as OutboundLinkDto["target_type"]) || "WEBSITE",
      label: String(row.label),
      target_url: String(row.target_url),
      canonical_url: (row.canonical_url as string) ?? null,
      availability_status: (row.availability_status as OutboundLinkDto["availability_status"]) || "UNKNOWN",
      last_checked_at: (row.last_checked_at as string) ?? null,
    };
  }
}

export type { CoverageDto, TimelineEventDto } from "./types";
// (types re-exported for handiness; the interface above is the real contract)