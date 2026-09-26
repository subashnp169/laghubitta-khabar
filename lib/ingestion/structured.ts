// ============================================================================
// Phase R4 — deterministic Branch / Vacancy / Financial-document metadata
// extraction (AI OFF). Institution-agnostic structure parsing, same conventions
// as the Phase R3 people parser:
//   - each extractor self-limits to its capability (BRANCH_DIRECTORY /
//     CAREER_PAGE / REPORTS+DOCUMENT_ARCHIVE) via ctx.capability
//   - FIELD evidence keeps `capability` page-shaped; `field` carries the
//     semantic name that drives UNVERIFIED assertions
//   - identity fields (names/titles) assert at ≥0.5; "volatile" attribute
//     fields (district/place/phone/deadline/period) stay evidence-only at 0.45
//   - full structured detail lands in validator evidence_json for review
// No per-MFB code, no AI, no schema change. Fixture-proven in
// scripts/smoke-structured.ts.
// ============================================================================

import type { ExtractedEvidence } from "./types";
import type { Validator, ValidationContext } from "./contract";
import { cleanCell } from "./people";
import type { HtmlExtractor } from "./people";

export const BRANCH_DIRECTORY_RULE_ID = "r-branch-directory";
export const VACANCY_RULE_ID = "r-vacancies";
export const FINANCIAL_METADATA_RULE_ID = "r-financial-metadata";

export const BRANCH_PARSER_ID = "branch-html-v1";
export const VACANCY_PARSER_ID = "vacancy-html-v1";
export const FINMETADATA_PARSER_ID = "finmeta-html-v1";

interface BranchRow { name: string; district: string | null; place: string | null; phone: string | null; }
interface VacancyRow { title: string; deadline: string | null; }
interface FinanceRow { title: string; period: string | null; }

const PHONE_RE = /^\+?[\d][\d\s\-()]{6,}$/;
const DATE_CAP = /(?:20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/;
const DATE_RE = /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/;
// Well-known Nepali district names (generic vocabulary, institution-agnostic).
const DISTRICT_WORDS = [
  "Rupandehi", "Kathmandu", "Lalitpur", "Bhaktapur", "Butwal", "Chitwan", "Kaski",
  "Pokhara", "Syangja", "Morang", "Biratnagar", "Jhapa", "Dhanusha", "Sarlahi",
  "Surkhet", "Kailali", "Bajhang", "Okhaldhunga", "Nawalparasi", "Gorkha", "Lamjung",
  "Tanahun", "Palpa", "Kapilvastu", "Arghakhanchi", "Gulmi", "Chitwan", "Parsa",
];
// A cell is a branch/office designator (En + Ne). Table rows inside a branch
// directory often also carry people/contact columns; a name WITHOUT any
// branch/office marker would guess wrong (S.No., person names) on real sites.
const BRANCH_MARKER_RE = /\b(?:branch|office|शाखा|केन्द्र|कार्यालय|unit|एकाइ|province|प्रदेश|bittiya)\b/i;
// Column labels that mark a header row (possibly mapped columns + a seq column).
const HEADER_LABEL_RE = /^(?:s\.?\s?n\.?o\.?|s\/n|\d{0,2}#|#|no\.|sn|क्र\.|क्रं|क्रम|क्र)$/i;
// "Branch Manager : Mr. Rajesh Kumar Chaudhary" — a person-attribution suffix
// after a role/office marker must not become a branch_name on its own.
const PERSON_ATTR_RE =
  /[:|]\s*(?:(?:(?:mr\.?|mrs\.?|ms\.?|dr\.?|er\.?|shri)\s*)?[\p{Lu}][a-z]+(?:\s+[\p{Lu}][a-z.]+){1,}|[\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){2,})\s*$/iu;
// Words that can appear in a generic marker-only heading ("Branch Office").
const BARE_BRANCH_TOKENS = new Set([
  "branch", "office", "शाखा", "कार्यालय", "केन्द्र", "unit", "एकाइ",
  "province", "प्रदेश", "bittiya", "of", "the", "main", "मुख्य",
]);

/**
 * Directory name cells must look like a branch/office location, not any
 * title-case string: a branch/office/unit marker, or a known district/place
 * word. Persons and column labels ("S.No.") never qualify.
 */
function directoryNameLike(raw: string): boolean {
  const s = cleanCell(raw);
  if (PHONE_RE.test(s) || /@|https?:\/\/|www\./.test(s) || /\d/.test(s)) return false;
  if (s.length < 2 || s.length > 40) return false;
  if (HEADER_LABEL_RE.test(s)) return false;
  if (PERSON_ATTR_RE.test(s)) return false;
  const lower = s.toLowerCase();
  if (BRANCH_MARKER_RE.test(lower)) {
    // "Branch Office" / "शाखा कार्यालय" with no place word is a generic
    // section/column heading, not a named branch.
    const tokens = s.toLowerCase().split(/[^a-z\u0900-\u097F]+/).filter(Boolean);
    if (tokens.length > 0 && tokens.every((t) => BARE_BRANCH_TOKENS.has(t))) return false;
    return true;
  }
  if (DISTRICT_WORDS.some((d) => lower === d.toLowerCase())) return true;
  return false;
}

const BRANCH_HEADER_MAP: Record<string, string> = {
  name: "name", branch: "name", "branch name": "name", "office name": "name",
  शाखा: "name", "शाखा कार्यालय": "name", केन्द्र: "name",
  district: "district", जिल्ला: "district",
  place: "place", address: "place", "address place": "place", ठेगाना: "place",
  स्थान: "place", location: "place",
  phone: "phone", tel: "phone", telephone: "phone", "contact no": "phone",
  फोन: "phone", सम्पर्क: "phone", contact: "phone",
};

function mapHeader(raw: string): string | null {
  const k = cleanCell(raw).toLowerCase().replace(/\s+/g, " ");
  return BRANCH_HEADER_MAP[k] ?? null;
}

function bestName(cells: string[]): string | null {
  return cells.find((c) => directoryNameLike(c) && !PHONE_RE.test(c)) ?? null;
}

function parseBranchRows(html: string): BranchRow[] {
  const rows: BranchRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) cells.push(cleanCell(cm[1]));
    if (cells.length < 2) continue;
    if (cells.some((c) => HEADER_LABEL_RE.test(c))) continue; // header/sequence row
    const mapped = cells.map(mapHeader);
    const namedCols = mapped.filter((m) => m !== null).length;
    if (namedCols >= 2) {
      const columnMap = mapped.map((m) => m ?? null);
      const by = (f: string): string | null => {
        const idx = columnMap.indexOf(f);
        return idx >= 0 ? cells[idx] : null;
      };
      const name = by("name") || bestName(cells);
      if (!name) continue;
      const nameKey = cleanCell(name).toLowerCase().replace(/\s+/g, " ");
      if (nameKey in BRANCH_HEADER_MAP) continue; // literal header row ("Name", "नाम", …)
      const district = by("district") || (cells.find((c) => DISTRICT_WORDS.some((d) => c === d || c.endsWith(` ${d}`))) ?? null);
      const phone = by("phone") || (cells.find((c) => PHONE_RE.test(c)) ?? null);
      const place = by("place") || (cells.find((c) => c !== name && c !== district && c !== phone && c.length <= 60 && !PHONE_RE.test(c) && /^[\p{L}\p{M}.'\s-]+$/u.test(c)) ?? null);
      rows.push({ name, district: district ?? null, place: place ?? null, phone: phone ?? null });
      continue;
    }
    // No header schema → name cell plus district/phone/place clues.
    const name = bestName(cells);
    if (!name) continue;
    const district = cells.find((c) => c !== name && DISTRICT_WORDS.some((d) => c === d || c.endsWith(` ${d}`))) ?? null;
    const phone = cells.find((c) => c !== name && PHONE_RE.test(c) && !c.startsWith(name)) ?? null;
    const place = cells.find((c) => c !== name && c !== district && c !== phone && c.length <= 60 && !PHONE_RE.test(c) && /^[\p{L}\p{M}.'\s-]+$/u.test(c)) ?? null;
    rows.push({ name, district: district ?? null, place: place ?? null, phone: phone ?? null });
  }
  return rows;
}

export const branchDirectoryExtractor: HtmlExtractor = {
  parserId: BRANCH_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    if (ctx.capability !== "BRANCH_DIRECTORY") return [];
    const html = new TextDecoder().decode(ctx.body);
    const cap = ctx.capability as ExtractedEvidence["capability"];
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    for (const row of parseBranchRows(html)) {
      out.push({ kind: "FIELD", capability: cap, field: "BRANCH_NAME", sourceUrl: ctx.url, text: row.name, confidence: 0.6, parserId: BRANCH_PARSER_ID, extractedAt: now });
      if (row.district) out.push({ kind: "FIELD", capability: cap, field: "BRANCH_DISTRICT", sourceUrl: ctx.url, text: row.district, confidence: 0.45, parserId: BRANCH_PARSER_ID, extractedAt: now });
      if (row.place) out.push({ kind: "FIELD", capability: cap, field: "BRANCH_PLACE", sourceUrl: ctx.url, text: row.place, confidence: 0.45, parserId: BRANCH_PARSER_ID, extractedAt: now });
      if (row.phone) out.push({ kind: "FIELD", capability: cap, field: "BRANCH_PHONE", sourceUrl: ctx.url, text: row.phone, confidence: 0.45, parserId: BRANCH_PARSER_ID, extractedAt: now });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Vacancy (CAREER_PAGE): list/table items with a job-title signal, optionally a
// "deadline … <date>" marker. Titles assert; deadlines stay evidence-only.
// ---------------------------------------------------------------------------

const VACANCY_SKIP = new Set([
  "position", "post", "title", "vacancy", "designation", "job", "jobs",
  "position | deadline", "सबैभन्दा नयाँ", "news", "पद", "जागिर", "स्थान",
]);

// A list/table item is a vacancy only when anchored by a deadline OR carrying a
// job-role noun; global nav / section labels ("Career", "Staff Training") and
// bare announcements must never become vacancy titles.
const JOB_ROLE_RE = /(?:officer|manager|assistant|supervisor|trainee|trainees|engineer|accountant|chief|coordinator|operator|analyst|receptionist|attendant|assistant|peon|guard|cashier|clerk|surveyor|counselor|महाप्रबन्धक|प्रबन्धक|व्यवस्थापक|अधिकृत|सहायक|कर्मचारी|पर्यवेक्षक|लेखापाल|लेखा|रेखदेख|क्याशियर|गार्ड|पियन)/i;

function parseVacancies(html: string): VacancyRow[] {
  const rows: VacancyRow[] = [];
  const seen = new Set<string>();
  const push = (title: string, deadline: string | null): void => {
    const t = title.trim();
    if (t.length < 3 || seen.has(t.toLowerCase())) return;
    if (/@|https?:\/\/|www\./.test(t) || PHONE_RE.test(t)) return;
    if (VACANCY_SKIP.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    rows.push({ title: t, deadline });
  };
  const items: string[] = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(html)) !== null) items.push(cleanCell(lm[1]));
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((lm = trRe.exec(html)) !== null) {
    const c: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(lm[1])) !== null) c.push(cleanCell(cm[1]));
    if (c.length >= 2) items.push(c.join(" | "));
  }
  for (const item of items) {
    const deadlineM = /(?:deadline|last date|last date of submission|apply by|application deadline|अन्तिम मिति|आवेदन|म्याद|मिति)[^<\d]{0,30}?(20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i.exec(item);
    const deadline = deadlineM ? deadlineM[1] : null;
    const markerIdx = item.search(/(?:deadline|last date|last date of submission|apply by|application deadline|अन्तिम मिति|आवेदन|म्याद|मिति)/i);
    let title: string | null = null;
    if (deadline && markerIdx >= 0) {
      title = item.slice(0, markerIdx).replace(/[\s,;:–—-]+$/i, "").trim();
    }
    if (!title) {
      const dateOnly = DATE_RE.exec(item);
      const head = (dateOnly ? item.slice(0, dateOnly.index) : item).trim();
      const parts = head.split(/\s*[|,;:]\s*/).filter((s) => s.length > 0);
      title = parts[0] || head;
    }
    const tl = title.replace(/\s+/g, " ").replace(/\s*[|,;:–—-]\s*$/, "").trim();
    if (tl.length < 3 || tl.length > 90) continue;
    if (!deadline && !JOB_ROLE_RE.test(tl)) continue; // no role noun → not a position
    push(tl, deadline);
  }
  return rows;
}

export const vacancyExtractor: HtmlExtractor = {
  parserId: VACANCY_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    if (ctx.capability !== "CAREER_PAGE") return [];
    const cap = ctx.capability as ExtractedEvidence["capability"];
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    for (const row of parseVacancies(new TextDecoder().decode(ctx.body))) {
      out.push({ kind: "FIELD", capability: cap, field: "VACANCY_TITLE", sourceUrl: ctx.url, text: row.title, confidence: 0.6, parserId: VACANCY_PARSER_ID, extractedAt: now });
      if (row.deadline) out.push({ kind: "FIELD", capability: cap, field: "VACANCY_DEADLINE", sourceUrl: ctx.url, text: row.deadline, confidence: 0.45, parserId: VACANCY_PARSER_ID, extractedAt: now });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Financial-document metadata (REPORTS / DOCUMENT_ARCHIVE): titles + fiscal
// periods near financial-document language. Identity titles assert; periods
// stay evidence-only.
// ---------------------------------------------------------------------------

const FINANCE_HINTS = [
  "annual report", "financial report", "annual financial", "financial statement",
  "audit report", "quarterly", "board of directors report", "अनुसूची",
  "वार्षिक प्रतिवेदन", "वार्षिक समीक्षा", "आर्थिक प्रतिवेदन", "आर्थिक विवरण",
  "लेखापरीक्षण", "चौमासिक", "आव",
];

// Bare collection/index headings ("Quarterly Financial Report", "Annual
// Reports") are NOT specific documents; a specific title carries a period.
const BARE_QUALIFIER_WORDS = new Set([
  "annual", "quarterly", "interim", "final", "audited", "audit", "financial",
  "monthly", "yearly", "half", "weekly", "report", "reports", "the",
]);
const BARE_NE_REPORT_WORDS = new Set([
  "वार्षिक", "प्रतिवेदन", "समीक्षा", "आर्थिक", "विवरण", "लेखापरीक्षण", "चौमासिक",
  "अनुसूची", "आव",
]);

function isBareCollectionTitle(t: string): boolean {
  const enTokens = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (enTokens.length >= 1 && enTokens.length <= 4 && !/\p{Nd}/u.test(t)) {
    if (enTokens.every((w) => BARE_QUALIFIER_WORDS.has(w))) return true;
  }
  // Devanagari: "वार्षिक प्रतिवेदन" (annual report) without any period digits.
  if (!/\p{Nd}/u.test(t) && /^[\u0900-\u097F\s.]+$/u.test(t)) {
    const neTokens = t.split(/[\s.]+/).filter(Boolean);
    if (neTokens.length >= 1 && neTokens.length <= 3 && neTokens.every((w) => BARE_NE_REPORT_WORDS.has(w))) return true;
  }
  return false;
}

function parseFinance(html: string): FinanceRow[] {
  const rows: FinanceRow[] = [];
  const seen = new Set<string>();
  const push = (title: string, period: string | null): void => {
    const t = title.trim().slice(0, 140);
    const key = t.toLowerCase();
    if (t.length < 4 || seen.has(key)) return;
    seen.add(key);
    rows.push({ title: t, period });
  };
  // document titles come from <a> elements (they point at the document itself);
  // section headings like "Financial Reports" are NOT document titles.
  const linkRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    const t = cleanCell(lm[1]);
    if (t.length < 4 || t.length > 160) continue;
    const lower = t.toLowerCase();
    if (!FINANCE_HINTS.some((h) => lower.includes(h))) continue;
    // Archive index headings ("Annual Reports", "Annual Report", "Quarterly
    // Report", "Annual Audit Reports", "Reports", "वार्षिक प्रतिवेदन") are NOT
    // documents; a specific title carries a year/period or extra qualifiers.
    const trimmed = t.trim();
    if (/^(?:annual|quarterly|interim|final|audited?|financial|monthly|yearly|half[ -]?yearly)s?$/i.test(trimmed)) continue;
    if (isBareCollectionTitle(trimmed)) continue;
    let period: string | null = null;
    const fyMatch =
      /\b(?:fy|fiscal year|financial year)\s*(20\d{2})(?:\s*[-\/]\s*(20\d{2}))?\b/i.exec(t) ||
      /\b(?:वार्षिक|आव)\s*(20\d{2})(?:\s*[-\/]\s*(20\d{2}))?\b/i.exec(t);
    if (fyMatch) {
      const yr0 = fyMatch[1];
      const yr1 = fyMatch[2] ?? String(Number(yr0) + 1);
      period = `${yr0}/${yr1}`;
    } else {
      // hint-bearing title with a bare year → fiscal span start/end
      const bareYear = /\b(20\d{2})\b/.exec(t);
      if (bareYear) period = `${bareYear[1]}/${Number(bareYear[1]) + 1}`;
    }
    push(t, period);
  }
  return rows;
}

export const financialMetadataExtractor: HtmlExtractor = {
  parserId: FINMETADATA_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    if (ctx.capability !== "REPORTS" && ctx.capability !== "DOCUMENT_ARCHIVE") return [];
    // NRB category pages: the sidebar/footer repeat category links ("Financial
    // Statements", "Archives (Quarterly Financial Highlights)") that carry the
    // same word hints as the real archive rows — the hint-window would assert
    // them as documents. NRB archive rows are nrb-listing-v1's job (title +
    // date + size per entry); finmeta adds nothing but noise there.
    if (ctx.sourceType === "NRB") return [];
    const cap = ctx.capability as ExtractedEvidence["capability"];
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    for (const row of parseFinance(new TextDecoder().decode(ctx.body))) {
      out.push({ kind: "FIELD", capability: cap, field: "DOCUMENT_TITLE", sourceUrl: ctx.url, text: row.title, confidence: 0.6, parserId: FINMETADATA_PARSER_ID, extractedAt: now });
      if (row.period) out.push({ kind: "FIELD", capability: cap, field: "DOCUMENT_PERIOD", sourceUrl: ctx.url, text: row.period, confidence: 0.45, parserId: FINMETADATA_PARSER_ID, extractedAt: now });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Validators: count identity evidence + pack structured detail for review.
// PASS when ≥1 identity field of the kind; FAIL only on junk (defensive);
// PENDING when the capability page carried none (not a defect).
// ---------------------------------------------------------------------------

function directoryValidatorFor(ruleId: string, fieldPrefix: string): Validator {
  return {
    ruleId,
    severity: "warning",
    async validate(ctx: ValidationContext) {
      const rows = ctx.evidence.filter((e) => e.kind === "FIELD" && (e.field ?? "").startsWith(fieldPrefix));
      const junk = rows.filter((e) => (e.text ?? "").length > 160);
      if (junk.length > 0) {
        return { status: "FAIL", severity: "warning", ruleId, message: `junk ${fieldPrefix} value`, evidence: { count: rows.length, junk: junk.map((j) => j.text) } };
      }
      if (rows.length === 0) {
        return { status: "PENDING", severity: "info", ruleId, message: `no ${fieldPrefix.toLowerCase()} evidence`, evidence: { count: 0 } };
      }
      const attrs = ctx.evidence.filter((e) => e.kind === "FIELD" && e.field !== undefined && !(e.field as string).startsWith(fieldPrefix));
      return {
        status: "PASS",
        severity: "warning",
        ruleId,
        message: `${rows.length} ${fieldPrefix.toLowerCase()} row(s) extracted (UNVERIFIED)`,
        evidence: { count: rows.length, values: rows.map((r) => r.text).slice(0, 30), attrs: attrs.map((a) => ({ field: a.field, text: a.text })).slice(0, 40) },
      };
    },
  };
}

export const branchDirectoryValidator: Validator = directoryValidatorFor(BRANCH_DIRECTORY_RULE_ID, "BRANCH_NAME");
export const vacancyValidator: Validator = directoryValidatorFor(VACANCY_RULE_ID, "VACANCY_TITLE");
export const financialMetadataValidator: Validator = directoryValidatorFor(FINANCIAL_METADATA_RULE_ID, "DOCUMENT_TITLE");

export const structuredValidators: ReadonlyArray<Validator> = [
  branchDirectoryValidator,
  vacancyValidator,
  financialMetadataValidator,
];

// ---------------------------------------------------------------------------
// Phase M1.5 — NRB listing parser (nrb-listing-v1). Regulator-scoped, fully
// institution-agnostic: fires ONLY for sourceType "NRB" on DOCUMENT_ARCHIVE /
// REPORTS pages that carry NRB's arrowed-list entry structure. Every anchored
// entry becomes an outbound document link (LINK evidence → outbound_links row)
// plus a DOCUMENT_TITLE assertion; date/size stay evidence-only at 0.45 until
// a later phase verifies the target documents.
// ---------------------------------------------------------------------------

export const NRB_LISTING_RULE_ID = "r-nrb-listing";
export const NRB_LISTING_PARSER_ID = "nrb-listing-v1";

const NRB_MONTH_INDEX: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12",
};

const NRB_LISTING_CONTAINER_CLASSES = /class\s*=\s*"[^"]*\b(?:arrowed-list|listing)[^"]*"/i;
const NRB_MONTH_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i;
const NRB_ISO_DATE_RE = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const NRB_SIZE_RE = /\b(\d+(?:[.,]\d+)?)\s*(kb|mb|gb|b)\b/i;
// NRB pointer-anchor clutter ("pdf / real" links, incl. an empty-href first
// one) that nests inside some title elements — never part of the title.
const pointerPdfRe = /<a\b[^>]*\bhref\s*=\s*["'][^"']*["'][^>]*>\s*(?:pdf|real)\s*<\/a>/gi;
const pointerEmptyRe = /<a\b(?![^>]*\bhref)[^>]*>\s*(?:pdf|real)\s*<\/a>/gi;

interface NrbListingEntry {
  title: string;
  href: string;
  date: string | null; // ISO yyyy-mm-dd when the entry carried a date
  size: string | null; // e.g. "416.86 kb"
}

/**
 * Pick the real titled anchor of an NRB listing row. NRB nests pointer anchors
 * (an empty-href "pdf", a real ".pdf" "pdf") inside some title elements and
 * appends them as siblings in others — so pointer anchors are removed BEFORE
 * scanning, and the first remaining qualifying anchor (= the .text-primary
 * title link, which precedes any leftovers in document order) is chosen.
 */
function nrbListingAnchor(liRaw: string): { href: string; text: string } | null {
  const liHtml = liRaw
    .replace(pointerPdfRe, "")
    .replace(pointerEmptyRe, "");
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = aRe.exec(liHtml)) !== null) {
    const attrs = am[1];
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2]) : "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    // Pointer removal can leave an empty "( )" / "( / )" pair where the pdf
    // anchors were — never part of the title.
    const text = cleanCell(am[2]).replace(/\s*\(\s*\s*(?:\/\s*)*\)\s*$/, "").trim();
    if (text.length < 4 || text.length > 160) continue;
    return { href, text };
  }
  return null;
}

function pad2(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

function parseNrbListing(html: string): NrbListingEntry[] {
  const out: NrbListingEntry[] = [];
  const seen = new Set<string>();
  const ulRe = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
  let um: RegExpExecArray | null;
  while ((um = ulRe.exec(html)) !== null) {
    if (!NRB_LISTING_CONTAINER_CLASSES.test(`<ul ${um[1]}>`)) continue;
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = liRe.exec(um[2])) !== null) {
      const liHtml = lm[1];
      const anchor = nrbListingAnchor(liHtml);
      if (!anchor) continue;
      const key = anchor.text.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let date: string | null = null;
      let isoMatch: RegExpExecArray | null = null;
      const monthMatch = NRB_MONTH_DATE_RE.exec(liHtml);
      if (monthMatch) {
        const month = NRB_MONTH_INDEX[monthMatch[1].toLowerCase()];
        date = `${monthMatch[3]}-${month}-${pad2(monthMatch[2])}`;
      } else {
        isoMatch = NRB_ISO_DATE_RE.exec(liHtml);
        if (isoMatch) date = `${isoMatch[1]}-${pad2(isoMatch[2])}-${pad2(isoMatch[3])}`;
      }
      let size: string | null = null;
      const sizeMatch = NRB_SIZE_RE.exec(liHtml);
      if (sizeMatch) size = `${sizeMatch[1].replace(",", ".")} ${sizeMatch[2].toLowerCase()}`;
      // Authoritative entry vs sidebar/nav/footer clutter: every real NRB
      // listing row carries a date or a filesize (the `.font-size-xs` block).
      // Sidebar widget links ("Archives", "NRB Quarterly news", category
      // headings) have neither — they must not become documents.
      const documentLike = monthMatch !== null || isoMatch !== null || sizeMatch !== null;
      if (!documentLike) continue;
      out.push({ title: anchor.text.trim(), href: anchor.href, date, size });
    }
  }
  return out;
}

export const nrbListingExtractor: HtmlExtractor = {
  parserId: NRB_LISTING_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    if (ctx.sourceType !== "NRB") return [];
    if (ctx.capability !== "DOCUMENT_ARCHIVE" && ctx.capability !== "REPORTS") return [];
    const cap = ctx.capability as ExtractedEvidence["capability"];
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    for (const entry of parseNrbListing(new TextDecoder().decode(ctx.body))) {
      const meta: Record<string, string> = {};
      if (entry.date) meta.publishedAt = entry.date;
      if (entry.size) meta.size = entry.size;
      out.push({
        kind: "LINK",
        capability: cap,
        sourceUrl: ctx.url,
        href: entry.href,
        text: entry.title,
        documentType: "DOCUMENT",
        description: Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined,
        confidence: 0.6,
        parserId: NRB_LISTING_PARSER_ID,
        extractedAt: now,
      });
      out.push({
        kind: "FIELD",
        capability: cap,
        field: "DOCUMENT_TITLE",
        sourceUrl: ctx.url,
        text: entry.title,
        confidence: 0.6,
        parserId: NRB_LISTING_PARSER_ID,
        extractedAt: now,
      });
      if (entry.date) {
        out.push({
          kind: "FIELD",
          capability: cap,
          field: "DOCUMENT_DATE",
          sourceUrl: ctx.url,
          text: entry.date,
          confidence: 0.45,
          parserId: NRB_LISTING_PARSER_ID,
          extractedAt: now,
        });
      }
      if (entry.size) {
        out.push({
          kind: "FIELD",
          capability: cap,
          field: "DOCUMENT_SIZE",
          sourceUrl: ctx.url,
          text: entry.size,
          confidence: 0.45,
          parserId: NRB_LISTING_PARSER_ID,
          extractedAt: now,
        });
      }
    }
    return out;
  },
};

export const nrbListingValidator: Validator = directoryValidatorFor(NRB_LISTING_RULE_ID, "DOCUMENT_TITLE");

export const nrbStructuredValidators: ReadonlyArray<Validator> = [
  ...structuredValidators,
  nrbListingValidator,
];