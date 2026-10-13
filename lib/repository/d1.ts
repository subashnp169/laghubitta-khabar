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
  FinancialDocumentDto,
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
  SourceMeta,
  TimelineEventDto,
} from "./types";
import type { InstitutionRepository } from "./contract";
import {
  branchesFromAssertionRows,
  canonicalVacancyEntityId,
  documentConflictRows,
  documentEntityId,
  documentsFromAssertionRows,
  financialsFromAssertionRows,
  jobsFromAssertionRows,
  peopleFromAssertionRows,
  vacancyConflictRows,
  type BranchAssertionRecord,
  type DocumentAssertionRecord,
  type EvidenceConflictRow,
  type FinancialAssertionRecord,
  type PersonAssertionRecord,
  type VacancyAssertionRecord,
} from "./projection";
import { branchIdentityKey } from "../ingestion/branch-records";

/**
 * A projected financial document -> the frozen Phase C report/rate DTO shapes.
 * The body was never read, so metrics is empty and no numeric rate is set. The
 * mapping is defined once here and mirrored (identically) in the static API.
 */
function financialDocumentMeta(d: FinancialDocumentDto): SourceMeta {
  return {
    source: d.sourceName ?? "generated-modules",
    sources: d.sourceName ? [d.sourceName] : ["generated-modules"],
    source_url: d.sourceDocument,
    last_verified_at: d.lastSeenAt,
    verification_status: d.status === "CONFLICT" ? "CONFLICT" : "UNVERIFIED",
  };
}

function financialReportFromDocument(d: FinancialDocumentDto): FinancialReportDto {
  return {
    id: d.id,
    institution: d.institution,
    institution_slug: d.institution_slug || "(unresolved)",
    title: d.title,
    report_type: d.reportType,
    period_start: null,
    period_end: null,
    report_date: null,
    reporting_period: d.reportingPeriod,
    publication_date: d.publicationDate,
    as_of_date: d.asOfDate,
    source_owner: d.sourceOwner,
    metrics: {},
    source_url: d.sourceDocument,
    meta: financialDocumentMeta(d),
  };
}

function interestRateFromDocument(d: FinancialDocumentDto): InterestRateDto {
  return {
    id: d.id,
    rate_kind: d.rateKind ?? "INTEREST_RATE",
    product_category: null,
    rate_type: null,
    rate_basis: null,
    effective_date: null,
    reporting_period: null,
    grade: null,
    evidence_status: "NOT_EXTRACTED",
    institution: d.institution,
    institution_slug: d.institution_slug || "(unresolved)",
    title: d.title,
    url: d.sourceDocument,
    source_url: d.sourceName,
    rate_pct: null,
    period_start: null,
    period_end: null,
    meta: financialDocumentMeta(d),
  };
}

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

function metaFor(rows: D1ResultRow[]): SourceMeta {
  const v = rows[0];
  // Sub-queries populate these aliased columns; undefined �+' honest unmapped.
  const source = String(v?.source || "unknown");
  return {
    source,
    // Corroboration is derived from every source that owns an observation
    // backing this record, not from the first row. One entry = single source;
    // two or more = corroborated by that many independent sources.
      sources: [...new Set(rows.map((r) => String(r.source || "unknown")))].sort(),
      // Null when the sub-query had no source_url column to map. Reported as
      // unknown rather than omitted so a consumer can tell the difference
      // between "no URL recorded" and "older payload".
      source_url: typeof v?.source_url === "string" && /^https?:\/\//i.test(v.source_url) ? v.source_url : null,
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

  /**
   * Raw people evidence rows (+ open conflict keys) for one institution or the
   * whole corpus. Shared by listLeadership / getPersonBySlug / search.people —
   * the projection does all shaping; SQL here only carries provenance columns.
   */
  private async peopleEvidence(institutionId: string | null): Promise<{ results: PersonAssertionRecord[]; openKeys: Set<string> }> {
    const where = institutionId ? `AND i.id = ?` : "";
    const args = institutionId ? [institutionId] : [];
    const all = await this.db
      .prepare(`
        SELECT i.id AS institution_id, i.slug AS institution_slug, i.name_en AS institution_name,
               a.field_name, a.value, a.source_id, a.observed_at, a.verification_status, a.confidence,
               a.valid_to AS valid_to
        FROM data_assertions a
        JOIN institutions i ON i.id = a.entity_id
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'people_%' ${where}
        ORDER BY i.id, a.value, a.field_name`)
      .bind(...args)
      .all();
    const conflicts = await this.db
      .prepare(`SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status = 'OPEN' AND entity_type = 'institution' AND field_name LIKE 'people_%'`)
      .all();
    // A role-disagreement conflict is labelled `people_a|people_b`, so one open
    // row yields one key per role family involved.
    const openKeys = new Set(
      conflicts.results.flatMap((c) =>
        String(c.field_name)
          .split("|")
          .map((field) => `${String(c.entity_id)}|${field}`),
      ),
    );
    return {
      results: all.results as unknown as PersonAssertionRecord[],
      openKeys,
    };
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

  async listLeadership(institutionId: string): Promise<Paged<PersonDto>> {
    const { results, openKeys } = await this.peopleEvidence(institutionId);
    const data = peopleFromAssertionRows(results, { openConflictKeys: openKeys });
    const total = data.length;
    return {
      data: data.slice(0, 100),
      pagination: { page: 1, limit: Math.max(1, Math.min(100, total || 20)), total },
    };
  }
  /**
   * Raw branch evidence rows (+ open conflict keys) for one institution. The
   * projection does all shaping; SQL here only carries provenance columns.
   *
   * Rows are re-keyed with branchIdentityKey(institutionId, name): a store that
   * carries branch_name assertions against the institution entity_id would
   * otherwise collapse every branch of an institution onto one record. The same
   * identity the builder writes, so D1 and the static module agree.
   */
  private async branchEvidence(institutionId: string): Promise<{ results: BranchAssertionRecord[]; openKeys: Set<string> }> {
    const all = await this.db
      .prepare(`
        SELECT i.id AS institution_id, i.slug AS institution_slug,
               a.field_name, a.value, a.source_id, a.observed_at, a.verification_status, a.confidence,
               a.valid_to AS valid_to
        FROM data_assertions a
        JOIN institutions i ON i.id = a.entity_id
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'branch%' AND i.id = ?
        ORDER BY i.id, a.value, a.field_name`)
      .bind(institutionId)
      .all();
    const conflicts = await this.db
      .prepare(`SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status = 'OPEN' AND entity_type = 'institution' AND field_name LIKE 'branch%'`)
      .all();
    const results: BranchAssertionRecord[] = (all.results as unknown as Array<Record<string, unknown>>).map((r) => {
      const institution = String(r.institution_id);
      return {
        entity_id: branchIdentityKey(institution, String(r.value)),
        institution_id: institution,
        institution_slug: String(r.institution_slug),
        field_name: String(r.field_name),
        value: String(r.value),
        source_id: String(r.source_id),
        observed_at: String(r.observed_at),
        valid_to: (r.valid_to as string | null) ?? null,
        verification_status: String(r.verification_status),
        confidence: (r.confidence as number | null) ?? null,
      };
    });
    const openKeys = new Set(
      conflicts.results.map((c) => `${String(c.entity_id)}|${String(c.field_name)}`),
    );
    return { results, openKeys };
  }

  async listBranches(institutionId: string): Promise<Paged<BranchDto>> {
    const { results, openKeys } = await this.branchEvidence(institutionId);
    const data = branchesFromAssertionRows(results, { openConflictKeys: openKeys });
    const total = data.length;
    return { data, pagination: { page: 1, limit: 100, total } };
  }
  /**
   * Raw financial document evidence rows (+ open conflict keys). Financial rows
   * are NOT institution-scoped: entity_id is `financial-<institution>|<url>`, and
   * the owning institution is resolved from the observation's source, exactly as
   * the module builder does. The entity id is then re-keyed to the resolved
   * institution so D1 and the static module produce the same record identity.
   *
   * NOTE: the canonical lk.db carries no FINANCIAL assertions today (the
   * document layer is published from evidence only — see docs/data/P2-C-*). This
   * path is correct for when it does; until then it returns nothing, honestly.
   */
  private async financialEvidence(
    institutionId?: string,
  ): Promise<{ results: FinancialAssertionRecord[]; openKeys: Set<string> }> {
    const sql =
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at,
              a.valid_to, a.verification_status, a.confidence,
              i.id AS institution_id, i.slug AS institution_slug, i.name_en AS institution_name,
              s.url AS source_url
         FROM data_assertions a
         LEFT JOIN ingestion_sources s ON s.id = a.source_id
         LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE a.entity_type = 'FINANCIAL'` +
      (institutionId ? ` AND i.id = ?` : ``) +
      ` ORDER BY a.entity_id, a.field_name, a.observed_at`;
    const all = institutionId
      ? await this.db.prepare(sql).bind(institutionId).all()
      : await this.db.prepare(sql).all();
    const conflicts = await this.db
      .prepare(`SELECT entity_id, field_name FROM data_conflicts WHERE resolution_status = 'OPEN' AND entity_type = 'FINANCIAL'`)
      .all();
    const results: FinancialAssertionRecord[] = (all.results as unknown as Array<Record<string, unknown>>).map((r) => {
      const rawId = String(r.entity_id);
      const tail = rawId.split("|").slice(1).join("|");
      const institutionId = r.institution_id ? String(r.institution_id) : "";
      const entityId = institutionId && tail ? `financial-${institutionId}|${tail}` : rawId;
      return {
        entity_id: entityId,
        institution_id: institutionId,
        institution_slug: r.institution_slug ? String(r.institution_slug) : "",
        institution_name: r.institution_name ? String(r.institution_name) : "",
        field_name: String(r.field_name),
        value: String(r.value),
        source_id: String(r.source_id),
        source_url: (r.source_url as string | null) ?? null,
        observed_at: String(r.observed_at),
        valid_to: (r.valid_to as string | null) ?? null,
        verification_status: String(r.verification_status),
        confidence: (r.confidence as number | null) ?? null,
      };
    });
    const openKeys = new Set(
      conflicts.results.map((c) => `${String(c.entity_id)}|${String(c.field_name)}`),
    );
    return { results, openKeys };
  }

  async listFinancials(institutionId: string): Promise<Paged<FinancialReportDto>> {
    const { results, openKeys } = await this.financialEvidence(institutionId);
    const data = financialsFromAssertionRows(results, { openConflictKeys: openKeys })
      .filter((d) => d.kind === "REPORT")
      .map(financialReportFromDocument);
    return { data, pagination: { page: 1, limit: 100, total: data.length } };
  }
  /**
   * Raw general document evidence rows (+ open conflict keys), P2-D. Document
   * rows are institution-scoped through the observation's source, exactly as the
   * module builder resolves them: the owning institution comes from
   * `institutions` (registry numbering in lk.db), never from the assertion's
   * entity id, and `entity_id` is rebuilt through documentEntityId so D1 and
   * the static module produce the same record identity.
   *
   * NOTE: lk.db carries no document assertions today (the layer is published
   * from evidence only — see docs/data/P2-D-DOCUMENTS-JOBS-AUDIT.md). This path
   * is correct for when it does; until then it returns nothing, honestly.
   */
  private async documentEvidence(
    institutionId?: string,
  ): Promise<{ results: DocumentAssertionRecord[]; openKeys: Set<string> }> {
    const sql =
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at,
              a.valid_to, a.verification_status, a.confidence,
              i.id AS institution_id, i.slug AS institution_slug, i.name_en AS institution_name,
              s.url AS source_url
         FROM data_assertions a
         LEFT JOIN ingestion_sources s ON s.id = a.source_id
         LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE a.field_name IN ('document_title', 'notice_title')` +
      (institutionId ? ` AND i.id = ?` : ``) +
      ` ORDER BY a.entity_id, a.observed_at`;
    const all = institutionId
      ? await this.db.prepare(sql).bind(institutionId).all()
      : await this.db.prepare(sql).all();
    const conflictSql =
      `SELECT c.entity_id, c.field_name, c.value_a, c.value_b,
              c.source_a_id, c.source_b_id, i.id AS institution_id
         FROM data_conflicts c
         LEFT JOIN ingestion_sources s ON s.id = c.source_a_id
         LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE c.resolution_status = 'OPEN'
          AND c.field_name IN ('document_title', 'notice_title')
          AND c.source_a_id IS NOT NULL
          AND c.source_b_id IS NOT NULL
          AND c.source_a_id <> c.source_b_id`;
    const conflicts = await this.db.prepare(conflictSql).all();

    const results: DocumentAssertionRecord[] = (all.results as unknown as Array<Record<string, unknown>>).map((r) => {
      const inst = r.institution_id ? String(r.institution_id) : "";
      return {
        // Canonical identity is rebuilt here through the shared helper, so the
        // runtime and the generated module can never disagree about what a
        // record IS. Unresolved rows keep their raw id and are withheld by the
        // projection rather than published under a guessed owner.
        entity_id: inst ? documentEntityId(inst, String(r.value)) : String(r.entity_id),
        institution_id: inst,
        institution_slug: r.institution_slug ? String(r.institution_slug) : "",
        institution_name: r.institution_name ? String(r.institution_name) : "",
        field_name: String(r.field_name),
        value: String(r.value),
        source_id: String(r.source_id),
        source_url: (r.source_url as string | null) ?? null,
        observed_at: String(r.observed_at),
        valid_to: (r.valid_to as string | null) ?? null,
        verification_status: String(r.verification_status),
        confidence: (r.confidence as number | null) ?? null,
      };
    });
    const conflictRows: EvidenceConflictRow[] = (conflicts.results as unknown as Array<Record<string, unknown>>).map(
      (c) => ({
        entity_id: String(c.entity_id),
        field_name: String(c.field_name),
        value_a: (c.value_a as string | null) ?? null,
        value_b: (c.value_b as string | null) ?? null,
        institution_id: c.institution_id ? String(c.institution_id) : null,
      }),
    );
    const openKeys = new Set(
      documentConflictRows(conflictRows).map((c) => `${c.entity_id}|${c.field_name}`),
    );
    return { results, openKeys };
  }

  async listDocuments(institutionId: string): Promise<Paged<DocumentDto>> {
    const { results, openKeys } = await this.documentEvidence(institutionId);
    const data = documentsFromAssertionRows(results, { openConflictKeys: openKeys });
    return { data, pagination: { page: 1, limit: 100, total: data.length } };
  }

  /**
   * Raw vacancy evidence, both P2-D representations (+ open conflict keys).
   * Same rules as the builder: institution from the source's row in
   * `institutions`, entity id re-keyed through canonicalVacancyEntityId, and a
   * row whose owner cannot be resolved is not published (kept here only as
   * evidence the caller never sees — the public layer must not carry a pilot
   * number or a guessed owner).
   *
   * NOTE: lk.db carries no vacancy assertions today; until it does this path
   * honestly returns nothing.
   */
  private async vacancyEvidence(
    institutionId?: string,
  ): Promise<{ results: VacancyAssertionRecord[]; openKeys: Set<string> }> {
    const sql =
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at,
              a.valid_to, a.verification_status, a.confidence,
              i.id AS institution_id, i.slug AS institution_slug, i.name_en AS institution_name,
              s.url AS source_url
         FROM data_assertions a
         LEFT JOIN ingestion_sources s ON s.id = a.source_id
         LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE (a.entity_type = 'VACANCY'
           OR (a.entity_type = 'institution' AND a.field_name = 'vacancy_title'))` +
      (institutionId ? ` AND i.id = ?` : ``) +
      ` ORDER BY a.entity_id, a.field_name, a.observed_at`;
    const all = institutionId
      ? await this.db.prepare(sql).bind(institutionId).all()
      : await this.db.prepare(sql).all();
    const conflictSql =
      `SELECT c.entity_id, c.field_name, c.value_a, c.value_b,
              c.source_a_id, c.source_b_id, i.id AS institution_id
         FROM data_conflicts c
         LEFT JOIN ingestion_sources s ON s.id = c.source_a_id
         LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE c.resolution_status = 'OPEN'
          AND (c.entity_type = 'VACANCY' OR c.field_name = 'vacancy_title')
          AND c.source_a_id IS NOT NULL
          AND c.source_b_id IS NOT NULL
          AND c.source_a_id <> c.source_b_id`;
    const conflicts = await this.db.prepare(conflictSql).all();

    const results: VacancyAssertionRecord[] = [];
    for (const r of all.results as unknown as Array<Record<string, unknown>>) {
      const inst = r.institution_id ? String(r.institution_id) : "";
      if (!inst) continue;
      const sourceUrl = (r.source_url as string | null) ?? null;
      results.push({
        entity_id: canonicalVacancyEntityId(String(r.entity_id), String(r.field_name), String(r.value), inst),
        institution_id: inst,
        institution_slug: r.institution_slug ? String(r.institution_slug) : "",
        institution_name: r.institution_name ? String(r.institution_name) : "",
        field_name: String(r.field_name),
        value: String(r.value),
        source_id: String(r.source_id),
        source_name: sourceUrl,
        source_url: sourceUrl,
        observed_at: String(r.observed_at),
        valid_to: (r.valid_to as string | null) ?? null,
        verification_status: String(r.verification_status),
        confidence: (r.confidence as number | null) ?? null,
      });
    }
    const conflictRows: EvidenceConflictRow[] = (conflicts.results as unknown as Array<Record<string, unknown>>).map(
      (c) => ({
        entity_id: String(c.entity_id),
        field_name: String(c.field_name),
        value_a: (c.value_a as string | null) ?? null,
        value_b: (c.value_b as string | null) ?? null,
        institution_id: c.institution_id ? String(c.institution_id) : null,
      }),
    );
    const openKeys = new Set(vacancyConflictRows(conflictRows).map((c) => `${c.entity_id}|${c.field_name}`));
    return { results, openKeys };
  }

  async listJobs(institutionId: string): Promise<Paged<JobDto>> {
    const { results, openKeys } = await this.vacancyEvidence(institutionId);
    const data = jobsFromAssertionRows(results, { openConflictKeys: openKeys });
    return { data, pagination: { page: 1, limit: 100, total: data.length } };
  }

  async getPersonBySlug(slug: string): Promise<PersonDto | null> {
    const { results, openKeys } = await this.peopleEvidence(null);
    const person = peopleFromAssertionRows(results, { openConflictKeys: openKeys }).find((p) => p.slug === slug);
    return person ?? null;
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
    const { results, openKeys } = await this.peopleEvidence(null);
    const people = peopleFromAssertionRows(results, { openConflictKeys: openKeys })
      .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 10);
    return {
      institutions: inst.results.map(mapInstitutionRow),
      people,
      documents: [],
    };
  }

  async listInterestRates(): Promise<Paged<InterestRateDto>> {
    const { results, openKeys } = await this.financialEvidence();
    const data = financialsFromAssertionRows(results, { openConflictKeys: openKeys })
      .filter((d) => d.kind === "RATE")
      .map(interestRateFromDocument);
    return { data, pagination: { page: 1, limit: 100, total: data.length } };
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