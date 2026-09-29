// M3.4 extension: external branch evidence fallback.
//
// An MFB website that is JS-rendered, structurally unreadable, missing branch
// data, broken, incomplete, or impractical to parse must NOT become
// "branch_count = 0". It becomes "official source unusable through the
// deterministic fetcher, external fallback eligible" - and if no external
// source can supply evidence, UNRESOLVED. Never zero.
//
// This module is the generic machinery. It contains no institution URL and no
// site-specific selector: URLs live in the source registry (data), and column
// meaning is read from headers (semantics), never from position.
//
// Provenance is carried by the EXISTING evidence backbone - sources,
// source_snapshots, data_assertions, data_conflicts - so an external record is
// indistinguishable in shape from an official one and is always attributable.
// There is no shortcut that skips fetch -> hash -> extract -> validate ->
// assert -> provenance.

import { branchIdentityKey, type BranchIdentityGeo } from "./branch-records";
import { cleanCell } from "./people";
import type { BranchCoverage } from "./shape-signals";
import type { AssertionInput, EvidenceWriter } from "./contract";

// ---------------------------------------------------------------------------
// SOURCE VOCABULARY AND PRIORITY
// ---------------------------------------------------------------------------

/**
 * Which kind of source a branch record came from. These stay distinguishable
 * end to end; the system must always be able to answer "where did this branch
 * record come from?".
 */
export type BranchSourceType =
  | "OFFICIAL_MFB"
  | "NRB"
  | "MEROLAGANI"
  | "SHARESANSHAR"
  | "OTHER_PUBLIC";

/**
 * The deterministic priority order. It is an ORDERED ENUM, not a score.
 *
 * Deliberately not a score: a source is never preferred because it returned
 * more rows, a higher confidence, or a fresher timestamp. A tier-2 source
 * beats a tier-3 source even when the tier-3 source is bigger and better
 * populated, and both are retained when they disagree.
 */
export const BRANCH_SOURCE_PRIORITY: readonly BranchSourceType[] = [
  "OFFICIAL_MFB",
  "NRB",
  "MEROLAGANI",
  "SHARESANSHAR",
  "OTHER_PUBLIC",
] as const;

/** Numeric priority, 1-based, matching BRANCH_SOURCE_PRIORITY. */
export function branchSourcePriority(t: BranchSourceType): number {
  const i = BRANCH_SOURCE_PRIORITY.indexOf(t);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i + 1;
}

/**
 * Provenance that fits the existing schema without a migration.
 *
 * - `sources.source_grade` carries authority: A for the official website and
 *   for the regulator, C for established secondary aggregators.
 * - `sources.source_type` carries the publisher class. MFB pages and the
 *   regulator map exactly. Secondary aggregators map to the existing
 *   DATA_PROVIDER bucket.
 * - The exact BRANCH_SOURCE_TYPE and the discovery method have NO dedicated
 *   column; they are carried in `ingestion_sources.config_json` and mirrored
 *   onto `sources.publisher` / `sources.domain`, which together keep MEROLAGANI
 *   and SHARESANSHAR distinguishable. See docs for the stated limitation.
 */
export const BRANCH_SOURCE_GRADE: Readonly<Record<BranchSourceType, "A" | "B" | "C">> = {
  OFFICIAL_MFB: "A",
  NRB: "A",
  MEROLAGANI: "C",
  SHARESANSHAR: "C",
  OTHER_PUBLIC: "C",
};

/** Nearest value in the existing `sources.source_type` CHECK constraint. */
export const BRANCH_SOURCE_DB_TYPE: Readonly<
  Record<BranchSourceType, "MFB_WEBSITE" | "NRB" | "DATA_PROVIDER">
> = {
  OFFICIAL_MFB: "MFB_WEBSITE",
  NRB: "NRB",
  MEROLAGANI: "DATA_PROVIDER",
  SHARESANSHAR: "DATA_PROVIDER",
  OTHER_PUBLIC: "DATA_PROVIDER",
};

// ---------------------------------------------------------------------------
// CONTROLLED SOURCE REGISTRY (data, not parser logic)
// ---------------------------------------------------------------------------

/** How a branch source target came to be known. Recorded, not inferred. */
export type BranchDiscoveryMethod =
  | "REGISTRY"
  | "DISCOVERY"
  | "CORRECTION"
  | "MANUAL"
  | "FALLBACK_DISCOVERY";

export interface BranchSourceSpec {
  institution_id: string;
  source_type: BranchSourceType;
  url: string;
  discovery_method: BranchDiscoveryMethod;
  enabled?: boolean;
  /**
   * Whether this source is expected to carry BRANCH-LEVEL rows for this
   * institution. A source can be enabled and still not be a branch list; the
   * decision engine then treats it as not usable rather than as "zero
   * branches".
   */
  expects_branch_rows?: boolean;
  observed_at?: string;
  note?: string;
}

export interface BranchSourceRegistry {
  $schema?: string;
  generated_at?: string;
  sources: BranchSourceSpec[];
}

/** Registry sources for one institution, in deterministic priority order. */
export function registryForInstitution(
  reg: BranchSourceRegistry,
  institutionId: string,
): BranchSourceSpec[] {
  return reg.sources
    .filter(
      (s) =>
        (s.institution_id === institutionId || s.institution_id === "*") && s.enabled !== false,
    )
    .sort((a, b) => {
      const p = branchSourcePriority(a.source_type) - branchSourcePriority(b.source_type);
      return p !== 0 ? p : a.url.localeCompare(b.url);
    });
}

/**
 * The first configured source of a given type across the whole registry, used
 * when a source is institution-wide (the NRB list) rather than per-institution.
 */
export function registryFirstOfType(
  reg: BranchSourceRegistry,
  type: BranchSourceType,
): BranchSourceSpec | null {
  const all = reg.sources
    .filter((s) => s.source_type === type && s.enabled !== false)
    .sort((a, b) => a.institution_id.localeCompare(b.institution_id) || a.url.localeCompare(b.url));
  return all[0] ?? null;
}

// ---------------------------------------------------------------------------
// OFFICIAL + EXTERNAL MERGE
// ---------------------------------------------------------------------------

/** The existing pilot source shape this merge reads. Deliberately minimal. */
export interface OfficialBranchSourceRef {
  institution_id: string;
  id: string;
  known_url: string | null;
  status?: string;
}

/** One source to try, in tier order, for one institution. */
export interface BranchSourcePlanEntry extends BranchSourceSpec {
  /** The pilot-sources row id, for OFFICIAL_MFB entries. */
  pilot_source_id?: string;
  priority: number;
}

export interface BranchSourcePlan {
  institution_id: string;
  entries: BranchSourcePlanEntry[];
  /** True when an OFFICIAL_MFB source with a URL is configured. */
  has_official: boolean;
  /** External sources that are enabled and expect branch rows. */
  external_branch_sources: number;
}

/**
 * Merge the official BRANCH_DIRECTORY capability with the external registry
 * into one tier-ordered plan.
 *
 * Official URLs are read from pilot-sources (the existing single source of
 * truth) and are NOT duplicated into the external registry, so re-pointing an
 * official page stays a one-file change.
 */
export function buildBranchSourcePlan(
  institutionId: string,
  official: ReadonlyArray<OfficialBranchSourceRef>,
  registry: BranchSourceRegistry,
): BranchSourcePlan {
  const entries: BranchSourcePlanEntry[] = [];

  for (const o of official) {
    if (o.institution_id !== institutionId) continue;
    if (!o.known_url || o.known_url.trim().length === 0) continue;
    entries.push({
      institution_id: institutionId,
      source_type: "OFFICIAL_MFB",
      url: o.known_url.trim(),
      discovery_method: "REGISTRY",
      enabled: true,
      expects_branch_rows: true,
      pilot_source_id: o.id,
      priority: branchSourcePriority("OFFICIAL_MFB"),
    });
  }

  for (const e of registryForInstitution(registry, institutionId)) {
    entries.push({ ...e, priority: branchSourcePriority(e.source_type) });
  }

  entries.sort(
    (a, b) => a.priority - b.priority || a.url.localeCompare(b.url),
  );

  return {
    institution_id: institutionId,
    entries,
    has_official: entries.some((e) => e.source_type === "OFFICIAL_MFB"),
    external_branch_sources: entries.filter(
      (e) => e.source_type !== "OFFICIAL_MFB" && e.enabled !== false && e.expects_branch_rows,
    ).length,
  };
}


// ---------------------------------------------------------------------------
// GENERIC EXTERNAL BRANCH-TABLE ADAPTER
// ---------------------------------------------------------------------------

export type ExternalBranchField =
  | "serial"
  | "institution_name"
  | "bfi_code"
  | "branch_code"
  | "branch_name"
  | "province"
  | "district"
  | "municipality"
  | "ward"
  | "address"
  | "open_date"
  | "status"
  | "phone"
  | "email";

/**
 * Header semantics. Matching is on the header TEXT, so the same adapter reads
 * an NRB list, a ministry list, and a hand-maintained spreadsheet without
 * knowing which is which, and re-ordered columns do not break it.
 *
 * A bare "code" is read as BFI code because that is the regulator's own term
 * for that column. A bare "name" is deliberately NOT a branch-name column:
 * institution lists frequently head their name column with plain "Name", and
 * guessing there is how a manager gets asserted as a branch.
 */
const EXACT_HEADERS: Readonly<Record<string, ExternalBranchField>> = {
  "s.n": "serial",
  "s.n.": "serial",
  "sn": "serial",
  "serial": "serial",
  "serial no": "serial",
  "serial no.": "serial",
  "code": "bfi_code",
  "bfi code": "bfi_code",
  "bfi no": "bfi_code",
  "bfi number": "bfi_code",
  "institution code": "bfi_code",
  "branch code": "branch_code",
  "branch no": "branch_code",
  "branch number": "branch_code",
  "branch name": "branch_name",
  "branch office": "branch_name",
  "office name": "branch_name",
  "name of branch": "branch_name",
  "name of office": "branch_name",
  "name of the branch": "branch_name",
  "province": "province",
  "district": "district",
  "zone": "district",
  "municipality": "municipality",
  "municipality/ward": "municipality",
  "ward": "ward",
  "ward no": "ward",
  "ward no.": "ward",
  "address": "address",
  "full address": "address",
  "office address": "address",
  "branch address": "address",
  "location": "address",
  "open date": "open_date",
  "opening date": "open_date",
  "date of opening": "open_date",
  "licensed date": "open_date",
  "status": "status",
  "current status": "status",
  "phone": "phone",
  "phone no": "phone",
  "contact no": "phone",
  "contact no.": "phone",
  "contact number": "phone",
  "contact phone": "phone",
  "email": "email",
  "e-mail": "email",
  "contact email": "email",
  "institution": "institution_name",
  "institution name": "institution_name",
  "name of institution": "institution_name",
  "bfi": "institution_name",
  "bfi name": "institution_name",
  "company": "institution_name",
};

/** Substring fallbacks, applied only when no exact header matched. */
const CONTAINS_HEADERS: ReadonlyArray<[RegExp, ExternalBranchField]> = [
  [/branch\s*name|name\s*of\s*(the\s*)?(branch|office)/, "branch_name"],
  [/branch\s*(code|no\b|number)|code\s*of\s*branch/, "branch_code"],
  [/\bbfi\b.*(code|no\b|number)|(code|no\b|number).*\bbfi\b/, "bfi_code"],
  [/(open|opening|licensed)\s*(date|on)/, "open_date"],
  [/municipality|ward/, "municipality"],
  [/district|^zone$/, "district"],
  [/\b(status)\b/, "status"],
  // A qualified contact column is readable; a bare "Contact" is not, because it
  // may hold a phone, an email, or both, and guessing would assert a contact
  // detail the source never claimed.
  [/contact\s*(no\b|number|phone|mobile|line)/i, "phone"],
  [/contact\s*e?-?mail/i, "email"],
];

export function mapExternalHeader(raw: string): ExternalBranchField | null {
  const k = cleanCell(raw).toLowerCase().replace(/[\s_]+/g, " ").replace(/[.:;]+$/, "").trim();
  if (k.length === 0) return null;
  const exact = EXACT_HEADERS[k];
  if (exact) return exact;
  for (const [re, field] of CONTAINS_HEADERS) {
    if (re.test(k)) return field;
  }
  return null;
}

/**
 * One branch row as read from an external table, before any institution
 * matching or identity work.
 */
export interface ExternalBranchRecord {
  /**
   * A stable identifier the SOURCE assigns (NRB branch code). Preserved as an
   * external source identifier for traceability. It is NOT used as branch
   * identity and the schema is not redesigned to accommodate it.
   */
  external_code: string | null;
  branch_name: string;
  institution_name: string | null;
  province: string | null;
  district: string | null;
  municipality: string | null;
  address: string | null;
  open_date: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
  /** Row position in the source table. Reporting only; never identity. */
  row_index: number;
}

export interface ExternalColumnMap {
  header: string;
  field: ExternalBranchField | null;
  index: number;
}

export interface ExternalRejectedRow {
  row_index: number;
  reason: string;
  sample: string;
}

export interface ExternalBranchTable {
  records: ExternalBranchRecord[];
  columns: ExternalColumnMap[];
  /** data rows seen, including any refused */
  data_row_count: number;
  unmapped_headers: string[];
  rejected: ExternalRejectedRow[];
  /** header row chosen, for reporting */
  header_row: string[];
}

/** How many leading rows may be scanned for a header before giving up. */
const EXTERNAL_HEADER_SCAN_ROWS = 5;

const CODE_RE = /^[0-9]{4,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A source row is only a branch row if it actually names a branch. */
function externalNameUsable(raw: string): boolean {
  const t = cleanCell(raw).replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 160) return false;
  // A row number or a code is not a branch name.
  if (/^[0-9.,/-]+$/.test(t)) return false;
  if (CODE_RE.test(t.replace(/\s/g, ""))) return false;
  if (DATE_RE.test(t)) return false;
  return true;
}

interface CellScan {
  cells: string[];
  is_header: boolean;
  uses_th: boolean;
}

function scanRow(rowHtml: string): CellScan {
  const cells: string[] = [];
  const re = /<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    cells.push(cleanCell(m[2]).replace(/\s+/g, " ").trim());
  }
  return {
    cells,
    is_header: /<th\b/i.test(rowHtml) || /<td[^>]*headers=/i.test(rowHtml),
    uses_th: /<th\b/i.test(rowHtml),
  };
}

/**
 * Parse a branch table from an external source, generically.
 *
 * The table is found by looking for a table whose header row maps a
 * branch-name column AND a geography column; no table index, row index, or
 * column index is ever assumed. A source with several tables (a summary table
 * plus a detail table, say) yields the one that actually looks like a branch
 * list, and the other is reported rather than merged in.
 */
export function parseExternalBranchTable(html: string): ExternalBranchTable {
  const empty: ExternalBranchTable = {
    records: [], columns: [], data_row_count: 0, unmapped_headers: [],
    rejected: [], header_row: [],
  };
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  let best: ExternalBranchTable | null = null;

  for (const tableHtml of tables) {
    const candidate = parseOneTable(tableHtml);
    if (!candidate) continue;
    if (!best || candidate.records.length > best.records.length) best = candidate;
  }
  return best ?? empty;
}

function parseOneTable(tableHtml: string): ExternalBranchTable | null {
  const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  if (rows.length < 2) return null;

  let headerRow: string[] = [];
  let columns: ExternalColumnMap[] = [];
  let headerIndex = -1;

  for (let i = 0; i < Math.min(rows.length, EXTERNAL_HEADER_SCAN_ROWS); i++) {
    const scan = scanRow(rows[i]);
    if (scan.cells.length === 0) continue;
    const mapped = scan.cells.map((c) => mapExternalHeader(c));
    const hasName = mapped.some((m) => m === "branch_name");
    const hasGeo = mapped.some(
      (m) => m === "district" || m === "municipality" || m === "address" || m === "province",
    );
    // A header row is one that states what the columns ARE. Requiring the
    // branch-name column specifically is what stops an unrelated stats table
    // on the same page from being read as a branch list.
    if (!scan.uses_th && !hasName) continue;
    if (!hasName || !hasGeo) continue;
    headerRow = scan.cells;
    columns = scan.cells.map((header, index) => ({ header, field: mapExternalHeader(header), index }));
    headerIndex = i;
    break;
  }
  if (headerIndex < 0) return null;

  const idx = (f: ExternalBranchField): number => {
    const c = columns.find((x) => x.field === f);
    return c ? c.index : -1;
  };
  const cell = (cells: string[], at: number): string | null => {
    if (at < 0) return null;
    const v = cleanCell(cells[at] ?? "").replace(/\s+/g, " ").trim();
    return v.length > 0 ? v : null;
  };

  const records: ExternalBranchRecord[] = [];
  const rejected: ExternalRejectedRow[] = [];
  let dataRowCount = 0;

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const scan = scanRow(rows[r]);
    if (scan.cells.length === 0) continue;
    // A repeated header row is pagination furniture, not data.
    const mappedHere = scan.cells.map((c) => mapExternalHeader(c));
    if (mappedHere.some((m) => m === "branch_name")) continue;
    if (scan.cells.every((c) => c.length === 0)) continue;
    dataRowCount++;

    const nameCell = cell(scan.cells, idx("branch_name"));
    if (!nameCell || !externalNameUsable(nameCell)) {
      rejected.push({
        row_index: r,
        reason: nameCell ? "branch name not usable" : "branch name column empty",
        sample: scan.cells.filter((c) => c.length > 0).slice(0, 4).join(" | ").slice(0, 120),
      });
      continue;
    }

    const bfi = cell(scan.cells, idx("bfi_code"));
    const bcode = cell(scan.cells, idx("branch_code"));
    records.push({
      external_code: bcode ?? bfi,
      branch_name: nameCell,
      institution_name: cell(scan.cells, idx("institution_name")),
      province: cell(scan.cells, idx("province")),
      district: cell(scan.cells, idx("district")),
      municipality: cell(scan.cells, idx("municipality")),
      address: cell(scan.cells, idx("address")),
      open_date: cell(scan.cells, idx("open_date")),
      status: cell(scan.cells, idx("status")),
      phone: cell(scan.cells, idx("phone")),
      email: cell(scan.cells, idx("email")),
      row_index: r,
    });
  }

  return {
    records,
    columns,
    data_row_count: dataRowCount,
    unmapped_headers: columns.filter((c) => c.field === null).map((c) => c.header).filter(Boolean),
    rejected,
    header_row: headerRow,
  };
}

// ---------------------------------------------------------------------------
// INSTITUTION MATCHING LADDER
// ---------------------------------------------------------------------------

export type InstitutionMatchMethod =
  | "BFI_CODE"
  | "CANONICAL_ID"
  | "NORMALIZED_NAME"
  | "ALIAS"
  | "MANUAL_REVIEW"
  | "NO_MATCH";

export interface InstitutionCandidate {
  institution_id: string;
  /** official / canonical name as the source spells it */
  name?: string | null;
  /** regulator-assigned code, when known */
  codes?: ReadonlyArray<string>;
  aliases?: ReadonlyArray<string>;
}

export type InstitutionMatch =
  | { status: "MATCHED"; institution_id: string; method: InstitutionMatchMethod; confidence: number }
  | { status: "AMBIGUOUS"; candidates: string[]; method: InstitutionMatchMethod; reason: string }
  | { status: "UNMATCHED"; method: InstitutionMatchMethod; reason: string };

/** Names reduced for comparison: case, punctuation, and spacing only. */
function normalizeInstitutionName(raw: string): string {
  return cleanCell(raw)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(ltd|limited|pvt|private|co|company|inc|corporation|laghubitta|bittiya|sanstha|branchless)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match an external record to an institution, strongest evidence first.
 *
 * 1. exact regulator / BFI code
 * 2. canonical institution id
 * 3. normalized official institution name
 * 4. approved alias
 * 5. manual review when ambiguous
 *
 * A record is NEVER matched merely because a branch name looks similar. Branch
 * names are not an institution key, and two MFIs in one district routinely
 * share a branch name.
 */
export function matchInstitution(
  record: Pick<ExternalBranchRecord, "external_code" | "institution_name">,
  candidates: ReadonlyArray<InstitutionCandidate>,
): InstitutionMatch {
  if (candidates.length === 0) {
    return { status: "UNMATCHED", method: "MANUAL_REVIEW", reason: "no institution candidates configured" };
  }

  // 1. exact code
  const code = record.external_code?.replace(/\s/g, "").toLowerCase() ?? null;
  if (code && code.length > 0) {
    const byCode = candidates.filter((c) => (c.codes ?? []).some((x) => x.replace(/\s/g, "").toLowerCase() === code));
    if (byCode.length === 1) return { status: "MATCHED", institution_id: byCode[0].institution_id, method: "BFI_CODE", confidence: 1 };
    if (byCode.length > 1) {
      return { status: "AMBIGUOUS", candidates: byCode.map((c) => c.institution_id), method: "BFI_CODE", reason: "code matches more than one institution" };
    }
  }

  const rawName = record.institution_name ?? null;
  if (!rawName) {
    return { status: "UNMATCHED", method: "MANUAL_REVIEW", reason: "record carries no institution name and no usable code" };
  }
  const norm = normalizeInstitutionName(rawName);
  if (norm.length < 3) {
    return { status: "UNMATCHED", method: "MANUAL_REVIEW", reason: `institution name too short to match: "${rawName}"` };
  }

  // 2. canonical id. Both sides go through the SAME normalizer: a bare id like
  // "mfi-002" normalizes to "mfi 002", so comparing it to an unnormalized id
  // would make the canonical step silently unreachable.
  const byId = candidates.filter((c) => normalizeInstitutionName(c.institution_id) === norm);
  if (byId.length === 1) return { status: "MATCHED", institution_id: byId[0].institution_id, method: "CANONICAL_ID", confidence: 0.95 };
  if (byId.length > 1) {
    return { status: "AMBIGUOUS", candidates: byId.map((c) => c.institution_id), method: "CANONICAL_ID", reason: "canonical id matches more than one row" };
  }

  // 3. normalized official name
  const byName = candidates.filter((c) => c.name && normalizeInstitutionName(c.name) === norm);
  if (byName.length === 1) return { status: "MATCHED", institution_id: byName[0].institution_id, method: "NORMALIZED_NAME", confidence: 0.9 };
  if (byName.length > 1) {
    return { status: "AMBIGUOUS", candidates: byName.map((c) => c.institution_id), method: "NORMALIZED_NAME", reason: "institution name matches more than one institution" };
  }

  // 4. approved alias
  const byAlias = candidates.filter((c) => (c.aliases ?? []).some((a) => normalizeInstitutionName(a) === norm));
  if (byAlias.length === 1) return { status: "MATCHED", institution_id: byAlias[0].institution_id, method: "ALIAS", confidence: 0.8 };
  if (byAlias.length > 1) {
    return { status: "AMBIGUOUS", candidates: byAlias.map((c) => c.institution_id), method: "ALIAS", reason: "alias matches more than one institution" };
  }

  // 5. no confident match: a human decides, never a guess
  return { status: "UNMATCHED", method: "MANUAL_REVIEW", reason: `no institution matches "${rawName}"` };
}

// ---------------------------------------------------------------------------
// FALLBACK DECISION ENGINE
// ---------------------------------------------------------------------------

/**
 * Coverage A/B/C/D, reported separately from official parser coverage so the
 * two are never conflated.
 */
export type BranchEvidenceCoverage =
  | "A_OFFICIAL_PARSED"
  | "B_NRB_FALLBACK"
  | "C_SECONDARY_FALLBACK"
  | "D_UNRESOLVED";

export interface ExternalSourceAvailability {
  source_type: BranchSourceType;
  /** Did the source yield usable branch records for THIS institution? */
  usable: boolean;
  records: number;
  reason: string;
  /** A source can be enabled and simply not be a branch list for this MFI. */
  configured?: boolean;
}

export interface BranchEvidenceDecision {
  coverage: BranchEvidenceCoverage;
  /** The source the public projection would be built from, or null when unresolved. */
  selected_source_type: BranchSourceType | null;
  used_fallback: boolean;
  /** True whenever branch evidence exists from ANY source. Never conflated with 0. */
  branch_evidence_available: boolean;
  /**
   * Assertable branch names, reported SEPARATELY per source so official parser
   * coverage is never conflated with usable branch-evidence coverage.
   *
   * null means "unknown": no source could supply evidence. It is deliberately
   * never 0 for an unresolved target, because 0 asserts a fact we do not have.
   */
  official_branch_count: number | null;
  external_branch_count: number | null;
  /** The single count a projection should use, or null when unresolved. */
  branch_count: number | null;
  reason: string;
  /** Every source considered, in priority order, for auditability. */
  considered: ExternalSourceAvailability[];
}

/**
 * Which official coverage classes make an external fallback legitimate.
 *
 * An unusable official page is NOT "zero branches". BRANCH_LOCATOR_UNRENDERED,
 * BRANCH_STRUCTURE_UNREAD, BRANCH_INTENT_NO_STRUCTURE and UNREADABLE_BODY all
 * mean "we could not read it", so a fallback is allowed. A page the official
 * source answered fully does not need one.
 */
export function officialAllowsExternalFallback(coverage: BranchCoverage): boolean {
  return (
    coverage === "BRANCH_LOCATOR_UNRENDERED" ||
    coverage === "BRANCH_STRUCTURE_UNREAD" ||
    coverage === "BRANCH_INTENT_NO_STRUCTURE" ||
    coverage === "UNREADABLE_BODY"
  );
}

function coverageFor(type: BranchSourceType): BranchEvidenceCoverage {
  if (type === "OFFICIAL_MFB") return "A_OFFICIAL_PARSED";
  if (type === "NRB") return "B_NRB_FALLBACK";
  return "C_SECONDARY_FALLBACK";
}

/**
 * Deterministic fallback decision. Walk the fixed tier order and take the
 * FIRST usable source. Record counts are reported but never used to choose.
 *
 * This is an evidence-acquisition strategy, not automatic data replacement:
 * a lower tier never overwrites a higher tier, and every source considered is
 * kept so its evidence can still be stored.
 */
export function decideBranchEvidence(input: {
  official_coverage: BranchCoverage;
  official_valid_names: number;
  /** availability of each configured external source, any order */
  external: ReadonlyArray<ExternalSourceAvailability>;
}): BranchEvidenceDecision {
  const { official_coverage, official_valid_names } = input;
  const considered = [...input.external].sort(
    (a, b) => branchSourcePriority(a.source_type) - branchSourcePriority(b.source_type),
  );

  // The official source answered on its own terms.
  if (!officialAllowsExternalFallback(official_coverage)) {
    // Three outcomes must stay distinguishable here, because collapsing them is
    // how a system ends up asserting that an MFI has no branches when nobody
    // ever established that:
    //
    //   1. a DIRECTORY we parsed  -> the count is known, and 0 is a real finding
    //                               (a directory that parsed and held no
    //                               branches is the one thing that PROVES zero)
    //   2. a SINGLE LOCATION      -> a branch demonstrably exists, but a count
    //                               is unknown. null, never 1 and never 0.
    //   3. NOT A BRANCH PAGE      -> the page said nothing about branches at
    //                               all. null, never 0.
    const isDirectory =
      official_coverage === "VERIFIED_BRANCH_DIRECTORY" ||
      official_coverage === "PARTIAL_BRANCH_DIRECTORY";
    const answeredWithoutCount =
      official_coverage === "SINGLE_LOCATION_CONTACT" || official_coverage === "NOT_A_BRANCH_PAGE";
    if (isDirectory) {
      return {
        coverage: "A_OFFICIAL_PARSED",
        selected_source_type: "OFFICIAL_MFB",
        used_fallback: false,
        branch_evidence_available: true,
        official_branch_count: official_valid_names,
        external_branch_count: null,
        branch_count: official_valid_names,
        reason:
          official_valid_names === 0
            ? `official branch directory parsed and listed no branches: ${official_coverage} (this is proven zero)`
            : `official source usable: ${official_coverage}, ${official_valid_names} assertable name(s)`,
        considered,
      };
    }
    if (answeredWithoutCount) {
      // A location is evidence a branch exists; it is not evidence of how many.
      // Reporting null here is the honest answer, and it is what keeps
      // "we found something" from being read as "we know the total".
      return {
        coverage: "A_OFFICIAL_PARSED",
        selected_source_type: "OFFICIAL_MFB",
        used_fallback: false,
        branch_evidence_available: official_valid_names > 0,
        official_branch_count: null,
        external_branch_count: null,
        branch_count: null,
        reason:
          official_coverage === "SINGLE_LOCATION_CONTACT"
            ? `official site states a single location (${official_valid_names} name(s)) but publishes no branch list; branch count unknown, not zero`
            : "official site has no branch page structure; branch count unknown, not zero",
        considered,
      };
    }
    return {
      coverage: "A_OFFICIAL_PARSED",
      selected_source_type: "OFFICIAL_MFB",
      used_fallback: false,
      branch_evidence_available: false,
      official_branch_count: null,
      external_branch_count: null,
      branch_count: null,
      reason: `official source resolved the page without branch evidence: ${official_coverage}`,
      considered,
    };
  }

  // Official unusable. Take the first usable external source by tier.
  for (const s of considered) {
    if (s.source_type === "OFFICIAL_MFB") continue;
    if (s.usable && s.records > 0) {
      return {
        coverage: coverageFor(s.source_type),
        selected_source_type: s.source_type,
        used_fallback: true,
        branch_evidence_available: true,
        official_branch_count: null,
        external_branch_count: s.records,
        branch_count: s.records,
        reason: `official source unusable (${official_coverage}); branch evidence obtained from ${s.source_type} (${s.records} record(s))`,
        considered,
      };
    }
  }

  return {
    coverage: "D_UNRESOLVED",
    selected_source_type: null,
    used_fallback: false,
    // Explicitly not false-because-zero: no source produced branch records.
    branch_evidence_available: false,
    official_branch_count: null,
    external_branch_count: null,
    branch_count: null,
    reason: `no usable external branch source: official ${official_coverage}, and no configured NRB or secondary source yielded branch records for this institution`,
    considered,
  };
}

// ---------------------------------------------------------------------------
// CROSS-SOURCE RECONCILIATION AND CONFLICTS
// ---------------------------------------------------------------------------

/** One branch claim, with the provenance that must survive everything else. */
export interface BranchEvidenceClaim {
  institution_id: string;
  branch_name: string;
  district?: string | null;
  place?: string | null;
  address?: string | null;
  source_type: BranchSourceType;
  source_id: string;
  source_url: string;
  source_grade: string;
  observed_at: string;
  content_hash: string;
  snapshot_id: string;
  external_code?: string | null;
}

export type BranchReconciliationStatus = "CORROBORATED" | "SINGLE_SOURCE" | "CONFLICT";

export interface BranchFieldConflict {
  kind: "GEOGRAPHY" | "FIELD";
  field: string;
  /** value from the highest-priority source holding it */
  primary: string;
  /** every other disagreeing value, with the source that holds it */
  others: Array<{ source_type: BranchSourceType; value: string }>;
}

export interface BranchReconciliation {
  /** Semantic branch identity: institution + normalized name + geography. */
  identity_key: string;
  display_name: string;
  institution_id: string;
  status: BranchReconciliationStatus;
  /** Every source that made a claim, in priority order. */
  sources: BranchSourceType[];
  /** Provenance rows for this branch: one per source, never merged away. */
  provenance: BranchEvidenceClaim[];
  conflicts: BranchFieldConflict[];
  /** The source whose values the public projection would use. */
  primary_source_type: BranchSourceType;
}

const COMPARED_FIELDS = ["district", "address"] as const;

/**
 * Collapse claims from every source into semantic branch identities, keeping
 * all provenance and reporting disagreement instead of resolving it silently.
 *
 * Identity is the SAME model the official website parser uses: institution +
 * normalized branch name + geographic discriminator. Email, phone, mobile, map
 * URL, row position and document order are never part of it, so a claim whose
 * contact details differ across sources still reconciles onto one branch.
 */
export function reconcileBranchEvidence(
  claims: ReadonlyArray<BranchEvidenceClaim>,
): BranchReconciliation[] {
  const byIdentity = new Map<string, BranchEvidenceClaim[]>();
  for (const c of claims) {
    const key = branchIdentityKey(c.institution_id, c.branch_name, {
      district: c.district ?? null,
      place: c.place ?? null,
      // address is NOT identity; it is a compared field
    } satisfies BranchIdentityGeo);
    const list = byIdentity.get(key);
    if (list) list.push(c);
    else byIdentity.set(key, [c]);
  }

  // A same-name claim that landed in a different geography bucket is a
  // material disagreement, not a second branch: "Ghorahi, Dang" from the MFB
  // against "Ghorahi, Rupandehi" from the regulator must never be silently
  // normalized into agreement, and must never be silently split into two
  // unrelated branches either. It is surfaced as a geography conflict.
  const results: BranchReconciliation[] = [];
  for (const [identity_key, list] of byIdentity) {
    const sorted = [...list].sort(
      (a, b) => branchSourcePriority(a.source_type) - branchSourcePriority(b.source_type),
    );
    const primary = sorted[0];
    const conflicts: BranchFieldConflict[] = [];

    for (const field of COMPARED_FIELDS) {
      const seen = new Map<string, { value: string; source_type: BranchSourceType }>();
      for (const c of sorted) {
        const v = (c[field] ?? "").trim();
        if (v.length === 0) continue;
        const k = v.toLowerCase();
        if (!seen.has(k)) seen.set(k, { value: v, source_type: c.source_type });
      }
      if (seen.size > 1) {
        const first = [...seen.values()][0];
        conflicts.push({
          kind: "FIELD",
          field,
          primary: first.value,
          others: [...seen.values()].slice(1).map((e) => ({ source_type: e.source_type, value: e.value })),
        });
      }
    }

    const sources = [...new Set(sorted.map((c) => c.source_type))].sort(
      (a, b) => branchSourcePriority(a) - branchSourcePriority(b),
    );
    results.push({
      identity_key,
      display_name: primary.branch_name,
      institution_id: primary.institution_id,
      status: conflicts.length > 0 ? "CONFLICT" : sources.length > 1 ? "CORROBORATED" : "SINGLE_SOURCE",
      sources,
      provenance: sorted,
      conflicts,
      primary_source_type: primary.source_type,
    });
  }

  // Same institution, same normalized name, different geography: report once.
  const byName = new Map<string, BranchReconciliation[]>();
  for (const r of results) {
    const key = `${r.institution_id}|${r.display_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const list = byName.get(key);
    if (list) list.push(r);
    else byName.set(key, [r]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const geoOf = (r: BranchReconciliation): string => {
      const c = r.provenance[0];
      return [c.district, c.place].filter((x): x is string => Boolean(x && x.trim())).join(" / ") || "(none)";
    };
    // Geography is only a CONFLICT between DIFFERENT source types. One source
    // listing two same-named branches in two districts is two distinct
    // branches, already split by identity_key, and must not be reported as a
    // cross-source disagreement.
    const bySource = new Map<string, Set<string>>();
    for (const r of group) {
      for (const t of new Set(r.provenance.map((p) => p.source_type))) {
        const seen = bySource.get(t) ?? new Set<string>();
        seen.add(geoOf(r));
        bySource.set(t, seen);
      }
    }
    const types = [...bySource.keys()];
    if (types.length < 2) continue;
    // A source that itself reports this name in two places is internally
    // inconsistent; that is worth surfacing, but it is not a cross-source
    // conflict, so it is reported once against the first differing type.
    const primaryType = types[0];
    const primaryGeos = [...(bySource.get(primaryType) ?? [])];
    for (const other of types.slice(1)) {
      const otherGeos = [...(bySource.get(other) ?? [])];
      if (primaryGeos.length === 1 && otherGeos.length === 1 && primaryGeos[0] === otherGeos[0]) continue;
      if (primaryGeos.length === 1 && otherGeos.length === 1) {
        for (const r of group) {
          r.status = "CONFLICT";
          r.conflicts.push({
            kind: "GEOGRAPHY",
            field: "district/place",
            primary: primaryGeos[0],
            others: [{ source_type: other as BranchSourceType, value: otherGeos[0] }],
          });
        }
      }
    }
  }

  return results.sort((a, b) => a.identity_key.localeCompare(b.identity_key));
}

// ---------------------------------------------------------------------------
// REPEAT / IDEMPOTENCY PLANNER
// ---------------------------------------------------------------------------
//
// schema/schema.sql gives source_snapshots and data_assertions NO uniqueness
// constraint: `id` is a fresh generated key, so EvidenceWriter's INSERT OR
// IGNORE always appends. Evidence is append-only by design, which means
// repeat suppression CANNOT live in the writer. It has to be planned here,
// before anything is written:
//
//   raw content unchanged  -> write no snapshot, no assertion, no conflict
//   formatting-only change -> canonical hash equal, so no new snapshot; the
//                             extracted records are semantically identical, so
//                             no new assertion and no false conflict
//   real value change      -> new assertion + prior superseded (valid_to),
//                             never deleted, plus one conflict row
//   record disappears      -> prior superseded + a change conflict; it must
//                             NOT be read as "branch closed"
//
// An assertion row is never rewritten in place: data_assertions carries
// valid_from/valid_to and a STALE status precisely so a later observation
// supersedes an earlier one with the history intact.

/** A record's semantic content, for change detection. Formatting-insensitive. */
export function externalRecordFingerprint(rec: ExternalBranchRecord): string {
  const parts = [
    rec.external_code ?? "",
    cleanCell(rec.branch_name),
    rec.province ? cleanCell(rec.province) : "",
    rec.district ? cleanCell(rec.district) : "",
    rec.municipality ? cleanCell(rec.municipality) : "",
    rec.address ? cleanCell(rec.address) : "",
    rec.open_date ? cleanCell(rec.open_date) : "",
    rec.status ? cleanCell(rec.status) : "",
  ];
  return parts.join("\u001f");
}

/**
 * The stable branch identity for an external record, using the SAME key the
 * official parser uses, so one institution's branch keeps one identity across
 * source tiers and across re-runs.
 */
export function externalBranchEntityId(
  institutionId: string,
  rec: ExternalBranchRecord,
): string {
  return branchIdentityKey(institutionId, rec.branch_name, {
    district: rec.district ?? null,
    place: rec.municipality ?? null,
  });
}

export interface ExternalRecordState {
  institution_id: string;
  entity_id: string;
  fingerprint: string;
  record: ExternalBranchRecord;
}

export interface ExternalRecordChange {
  before: ExternalRecordState;
  after: ExternalRecordState;
  changed_fields: string[];
}

export interface ExternalRecordDelta {
  added: ExternalRecordState[];
  changed: ExternalRecordChange[];
  unchanged: ExternalRecordState[];
  disappeared: ExternalRecordState[];
}

/** Index prior observations by entity identity, keeping the newest per entity. */
export function indexExternalRecordState(
  observations: ReadonlyArray<ExternalRecordState>,
): Map<string, ExternalRecordState> {
  const byEntity = new Map<string, ExternalRecordState>();
  for (const o of observations) {
    // later observations win; callers pass them oldest-first
    byEntity.set(o.entity_id, o);
  }
  return byEntity;
}

/** The semantic fields whose change is reportable as a field-level conflict. */
const OBSERVED_FIELDS: ReadonlyArray<{ field: string; get: (r: ExternalBranchRecord) => string }> = [
  { field: "branch_name", get: (r) => cleanCell(r.branch_name) },
  { field: "district", get: (r) => (r.district ? cleanCell(r.district) : "") },
  { field: "municipality", get: (r) => (r.municipality ? cleanCell(r.municipality) : "") },
  { field: "address", get: (r) => (r.address ? cleanCell(r.address) : "") },
  { field: "open_date", get: (r) => (r.open_date ? cleanCell(r.open_date) : "") },
  { field: "status", get: (r) => (r.status ? cleanCell(r.status) : "") },
];

/** Changed field names between two observations of the same identity. */
export function changedExternalFields(
  before: ExternalBranchRecord,
  after: ExternalBranchRecord,
): string[] {
  const out: string[] = [];
  for (const f of OBSERVED_FIELDS) {
    if (f.get(before) !== f.get(after)) out.push(f.field);
  }
  return out;
}

/**
 * Compare this observation of a source against the previous one. Pure and
 * order-independent, so a re-run over the same rows always yields the same
 * plan regardless of row order in the HTML.
 */
export function diffExternalRecords(
  prior: ReadonlyArray<ExternalRecordState>,
  next: ReadonlyArray<ExternalRecordState>,
): ExternalRecordDelta {
  const before = indexExternalRecordState(prior);
  const after = indexExternalRecordState(next);

  const added: ExternalRecordState[] = [];
  const changed: ExternalRecordChange[] = [];
  const unchanged: ExternalRecordState[] = [];
  const disappeared: ExternalRecordState[] = [];

  for (const [entityId, n] of after) {
    const b = before.get(entityId);
    if (!b) {
      added.push(n);
      continue;
    }
    if (b.fingerprint === n.fingerprint) unchanged.push(n);
    else changed.push({ before: b, after: n, changed_fields: changedExternalFields(b.record, n.record) });
  }
  for (const [entityId, b] of before) {
    if (!after.has(entityId)) disappeared.push(b);
  }

  return { added, changed, unchanged, disappeared };
}

/** One write the caller must perform, with everything needed to perform it. */
export type ExternalWrite =
  | { kind: "SNAPSHOT"; source_id: string; content_hash: string; reason: "NEW_CONTENT" }
  | {
      kind: "ASSERT";
      institution_id: string;
      entity_id: string;
      field_name: string;
      value: string;
      source_id: string;
      /** Set when this assertion supersedes an earlier one. */
      supersedes_fingerprint: string | null;
    }
  | {
      kind: "SUPERSEDE";
      institution_id: string;
      entity_id: string;
      field_name: string;
      old_value: string;
      source_id: string;
    }
  | {
      kind: "CONFLICT";
      institution_id: string;
      entity_id: string;
      field_name: string;
      old_value: string;
      new_value: string;
      source_id: string;
      /** Distinguishes a value revision from a record leaving the source. */
      cause: "VALUE_CHANGED" | "NO_LONGER_LISTED";
    };

export interface ExternalRepeatPlan {
  writes: ExternalWrite[];
  /** Assertions that would be written if the plan were applied. */
  assertion_count: number;
  conflict_count: number;
  snapshot_count: number;
  /** True when nothing at all needs writing. */
  no_op: boolean;
}

/**
 * Turn a repeat observation into the exact set of writes.
 *
 * `prior_content_hash` is the canonical hash of the source's last observed
 * body. `prior_assertions` is the earlier observation set, which the caller
 * reads back from data_assertions.
 */
export function planExternalRepeat(input: {
  source_id: string;
  prior_content_hash: string | null;
  content_hash: string;
  prior: ReadonlyArray<ExternalRecordState>;
  next: ReadonlyArray<ExternalRecordState>;
  /** Fields to assert per record. Defaults to branch_name + geography. */
  fields?: ReadonlyArray<{ field: string; get: (r: ExternalBranchRecord) => string }>;
}): ExternalRepeatPlan {
  const writes: ExternalWrite[] = [];
  const fields = input.fields ?? OBSERVED_FIELDS;

  // A formatting-only change is invisible here: the caller passes the CANONICAL
  // hash, not the raw byte hash, so equal semantics mean an equal hash.
  if (input.content_hash !== input.prior_content_hash) {
    writes.push({
      kind: "SNAPSHOT",
      source_id: input.source_id,
      content_hash: input.content_hash,
      reason: "NEW_CONTENT",
    });
  }

  const delta = diffExternalRecords(input.prior, input.next);

  for (const a of delta.added) {
    for (const f of fields) {
      const v = f.get(a.record);
      if (!v) continue;
      writes.push({
        kind: "ASSERT",
        institution_id: a.institution_id,
        entity_id: a.entity_id,
        field_name: f.field,
        value: v,
        source_id: input.source_id,
        supersedes_fingerprint: null,
      });
    }
  }

  for (const c of delta.changed) {
    for (const f of fields) {
      const nv = f.get(c.after.record);
      const ov = f.get(c.before.record);
      if (ov === nv) continue;
      if (ov) {
        writes.push({
          kind: "SUPERSEDE",
          institution_id: c.after.institution_id,
          entity_id: c.after.entity_id,
          field_name: f.field,
          old_value: ov,
          source_id: input.source_id,
        });
        writes.push({
          kind: "CONFLICT",
          institution_id: c.after.institution_id,
          entity_id: c.after.entity_id,
          field_name: f.field,
          old_value: ov,
          new_value: nv,
          source_id: input.source_id,
          cause: "VALUE_CHANGED",
        });
      }
      if (nv) {
        writes.push({
          kind: "ASSERT",
          institution_id: c.after.institution_id,
          entity_id: c.after.entity_id,
          field_name: f.field,
          value: nv,
          source_id: input.source_id,
          supersedes_fingerprint: c.before.fingerprint,
        });
      }
    }
  }

  for (const d of delta.disappeared) {
    for (const f of fields) {
      const ov = f.get(d.record);
      if (!ov) continue;
      writes.push({
        kind: "SUPERSEDE",
        institution_id: d.institution_id,
        entity_id: d.entity_id,
        field_name: f.field,
        old_value: ov,
        source_id: input.source_id,
      });
      writes.push({
        kind: "CONFLICT",
        institution_id: d.institution_id,
        entity_id: d.entity_id,
        field_name: f.field,
        old_value: ov,
        new_value: "",
        source_id: input.source_id,
        cause: "NO_LONGER_LISTED",
      });
    }
  }

  return {
    writes,
    assertion_count: writes.filter((w) => w.kind === "ASSERT").length,
    conflict_count: writes.filter((w) => w.kind === "CONFLICT").length,
    snapshot_count: writes.filter((w) => w.kind === "SNAPSHOT").length,
    no_op: writes.length === 0,
  };
}

/**
 * Apply a plan through the existing evidence writer. No direct SQL: external
 * data reaches data_assertions / data_conflicts only via EvidenceWriter, so it
 * gets the same provenance and audit trail as official ingestion.
 */
export async function applyExternalPlan(
  plan: ExternalRepeatPlan,
  ctx: {
    writer: EvidenceWriter;
    source_id: string;
    snapshot: {
      fetched_at: string;
      http_status: number | null;
      mime_type: string | null;
      parser_version: string;
    };
    observed_at: string;
    confidence: number;
    verification_status: AssertionInput["verificationStatus"];
  },
): Promise<{
  snapshot_id: string | null;
  assertions: number;
  conflicts: number;
  /**
   * Assertions actually closed out: valid_to stamped and status moved to STALE.
   *
   * The frozen schema already carries both halves of this - data_assertions
   * .valid_to and STALE in the verification_status vocabulary - so no migration
   * and no new column was needed. What was missing was the writer operation,
   * which is why this phase added supersedeAssertion() rather than touching
   * schema.sql. Nothing is deleted: the earlier observation keeps its value,
   * its source and its snapshot.
   */
  superseded: number;
  /**
   * SUPERSEDE writes that could NOT be applied, and why that matters.
   *
   * This is an application-level reconciliation state, not a database value:
   * there is no SUPERSEDED_PENDING member of the frozen verification_status
   * vocabulary, and none was invented. A non-zero count means a plan asked to
   * close out a value that no current assertion holds - already superseded, or
   * never asserted by this source - which is a real inconsistency to investigate
   * rather than a detail to swallow. The replacement value and the conflict row
   * are written either way, so no history is lost.
   */
  superseded_pending: number;
}> {
  let snapshotId: string | null = null;
  if (plan.snapshot_count > 0) {
    const w = plan.writes.find((x) => x.kind === "SNAPSHOT");
    if (w && w.kind === "SNAPSHOT") {
      // Reuse an identical canonical snapshot rather than appending a
      // byte-identical row on every re-run. Raw evidence is still preserved:
      // a genuinely different body has a different canonical hash and is stored
      // in full as its own snapshot.
      const existing = await ctx.writer.findSnapshotByContentHash(ctx.source_id, w.content_hash);
      if (existing) {
        snapshotId = existing;
      } else {
        snapshotId = await ctx.writer.saveSnapshot({
          sourceId: ctx.source_id,
          fetchedAt: ctx.snapshot.fetched_at,
          contentHash: w.content_hash,
          httpStatus: ctx.snapshot.http_status,
          mimeType: ctx.snapshot.mime_type,
          parserVersion: ctx.snapshot.parser_version,
          r2Key: null,
          extractionStatus: "EXTRACTED",
        });
      }
    }
  }

  let assertions = 0;
  let conflicts = 0;
  let superseded = 0;
  let supersededPending = 0;

  for (const w of plan.writes) {
    if (w.kind === "ASSERT") {
      // An assertion with no snapshot would be an unattributable fact, which is
      // the one thing this whole path exists to prevent. Unchanged content
      // yields no assertions, so this can only fire on a malformed plan.
      if (!snapshotId) {
        throw new Error(
          `refusing to assert ${w.field_name} for ${w.entity_id} without a source snapshot: ` +
            "an external assertion must be attributable to an observed body",
        );
      }
      await ctx.writer.saveAssertion({
        entityType: "BRANCH",
        entityId: w.entity_id,
        fieldName: w.field_name,
        value: w.value,
        sourceId: ctx.source_id,
        sourceSnapshotId: snapshotId,
        observedAt: ctx.observed_at,
        confidence: ctx.confidence,
        verificationStatus: ctx.verification_status,
      });
      assertions += 1;
    } else if (w.kind === "CONFLICT") {
      await ctx.writer.saveConflict({
        entityType: "BRANCH",
        entityId: w.entity_id,
        fieldName: w.field_name,
        sourceAId: ctx.source_id,
        valueA: w.old_value,
        sourceBId: ctx.source_id,
        valueB: w.new_value,
        detectedAt: ctx.observed_at,
        resolutionStatus: "OPEN",
        resolutionNote:
          w.cause === "NO_LONGER_LISTED"
            ? "record no longer listed by this source; NOT evidence the branch closed"
            : "value revised by a later observation of the same source",
      });
      conflicts += 1;
    } else if (w.kind === "SUPERSEDE") {
      // Find the row this supersede is actually about, then close it out with
      // the operation the writer exposes. The lookup is what makes this safe:
      // it matches on the semantic slot and the exact prior value, and only
      // touches a row that is still current (valid_to IS NULL).
      const existing = await ctx.writer.findAssertions({
        entityType: "BRANCH",
        entityId: w.entity_id,
        fieldName: w.field_name,
        sourceId: ctx.source_id,
      });
      const target = existing.find(
        (a) =>
          a.valid_to === null &&
          cleanCell(a.value) === cleanCell(w.old_value) &&
          a.verification_status !== "STALE",
      );
      if (!target) {
        // Nothing current to close out. The value may already be superseded, or
        // the source may never have asserted it. Reporting this honestly is the
        // point: a silent "done" here would hide a real inconsistency.
        supersededPending += 1;
        continue;
      }
      const ok = await ctx.writer.supersedeAssertion({
        id: target.id,
        validTo: ctx.observed_at,
        status: "STALE",
        reason: `superseded by a later observation from ${ctx.source_id}`,
      });
      if (ok) superseded += 1;
      else supersededPending += 1;
    }
  }

  return {
    snapshot_id: snapshotId,
    assertions,
    conflicts,
    superseded,
    superseded_pending: supersededPending,
  };
}

