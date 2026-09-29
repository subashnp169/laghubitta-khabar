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
import { isAssertableCard, parseCardRecords } from "./branch-records";
import type { HtmlExtractor } from "./people";

export const BRANCH_DIRECTORY_RULE_ID = "r-branch-directory";
export const VACANCY_RULE_ID = "r-vacancies";
export const FINANCIAL_METADATA_RULE_ID = "r-financial-metadata";

// v2 (M3.4 Phase 5/6): reusable card grammar with evidence strength, adjacent
// branch<->manager contact pairing, table-scoped header selection with multiple
// name columns, and the email/address/manager/mobile/map attributes. The bump is
// deliberate: the grammar changed materially, so evidence must not be recorded
// under the id of the parser that produced the previous numbers.
export const BRANCH_PARSER_ID = "branch-html-v2";
export const VACANCY_PARSER_ID = "vacancy-html-v1";
export const FINMETADATA_PARSER_ID = "finmeta-html-v1";

/** A branch record as the parsers produce it. Every attribute is nullable: a
 *  card can carry an email and no phone, or a phone and no district. Nothing
 *  here is an assertion — the extractor applies the gates. */
interface BranchRow {
  name: string;
  district: string | null;
  place: string | null;
  address: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  manager: string | null;
  map: string | null;
  /** where the name text came from, for provenance in the report */
  nameSource: "table" | "card" | "cell" | "heading" | "body";
  /** true when the name was recovered from a card whose heading was a person */
  nameFromPersonCard: boolean;
  /**
   * true when this name was accepted from a column whose own header declares
   * branch semantics ("Branch Name", "Branch", "Office"). Such a name is still
   * held to the full value gate, but a bare place word in it is a branch rather
   * than a leaked district. Reported separately so this class of name is never
   * mistaken for an unqualified assertion.
   */
  nameFromDeclaredBranchColumn?: boolean;
  /**
   * false only for a card with no contact and no corroboration: the row is
   * reported as evidence but is not allowed to assert. Table and cell grammars
   * are self-evidencing by their repeating column structure and leave it unset.
   */
  assertable?: boolean;
}
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
// M3.4: extended after measuring the committed targets. "Regional Office" and
// "Branch Manager" both sailed through the table-only parser on real pages
// because "regional"/"manager" were missing from this set, so the whole page's
// branch_name column was a repeated heading rather than a location.
const BARE_BRANCH_TOKENS = new Set([
  "branch", "office", "शाखा", "कार्यालय", "केन्द्र", "unit", "एकाइ",
  "province", "प्रदेश", "bittiya", "of", "the", "main", "मुख्य",
  // generic qualifiers: "Regional Office", "Sub Branch Office", "Head Office"
  "regional", "area", "sub", "head", "principal", "central", "सङ्घ", "क्षेत्रीय", "उप",
  // column labels: "Branch Manager", "Branch Name", "Contact", "Designation"
  "manager", "name", "contact", "phone", "mobile", "email", "address",
  "district", "designation", "number", "total", "count", "no", "sn", "serial",
  "प्रबन्धक", "प्रबंधक", "नाम", "जिल्ला", "फोन", "मोबाइल", "ठेगाना", "सम्पर्क",
  "पद", "क्रम", "संख्या",
]);

/**
 * Generic vocabulary that cannot be part of a real branch place-name: office,
 * abstract-department, opening-hours and collection wording that any
 * institution's website uses. Institution-agnostic on purpose — nothing here
 * names a specific MFB, city, or URL pattern.
 */
const NON_PLACE_WORDS = new Set([
  "corporate", "central", "principal", "main", "general", "head", "regional", "sub",
  "primary", "secondary", "tertiary", "divisional", "zonal", "provincial",
  "finance", "financial", "accounts", "accounting", "audit", "credit", "loan", "loans",
  "marketing", "human", "resource", "admin", "administration", "administrative", "legal",
  "compliance", "risk", "treasury", "operation", "operations", "service", "services",
  "customer", "digital", "technology", "planning", "development", "business", "international",
  "overseas", "remittance", "payment", "savings", "deposit", "insurance", "securities",
  "centre", "center", "bank", "company", "limited", "ltd",
  "hours", "hour", "open", "opens", "opening", "close", "closes", "closing", "closed",
  "time", "times", "day", "days", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "am", "pm", "till", "until", "except", "holiday", "holidays",
  "network", "networks", "list", "lists", "directory", "locator", "finder", "map",
  "page", "pages", "details", "detail", "overview", "all", "view", "us", "our", "the",
  "and", "for", "of", "in", "at", "on", "to", "website", "click", "here", "read", "more",
]);

/** A marker followed by one of these is a list heading ("Branch Network"), never
 *  a record. Deliberately excludes "branch"/"office" so real names ending in
 *  "... Branch" still pass. */
const COLLECTION_TAIL_WORDS = new Set([
  "network", "networks", "list", "lists", "directory", "locator", "finder", "map",
  "page", "pages", "details", "detail", "overview", "all", "branches", "outlets",
]);

/** Announcement / event / document nouns. A place name never contains one, so
 *  presence alone is disqualifying. */
const NOTICE_WORDS = new Set([
  "notice", "notices", "circular", "circulars", "announcement", "announcements",
  "press", "release", "releases", "news", "blog", "newsletter", "meeting", "meetings",
  "assembly", "workshop", "seminar", "training", "trainings", "event", "events",
  "result", "results", "vacancy", "vacancies", "recruitment", "tender", "tenders",
  "program", "programme", "campaign", "celebration", "inaugural", "inauguration",
  "orientation", "exam", "examination", "interview", "award", "awards", "ceremony",
  "symposium", "webinar", "report", "reports", "schedule", "timetable", "calendar",
  "syllabus", "form", "download", "downloads", "advertisement", "publicity",
]);

/** Role nouns. A branch is a place, so a job title inside the name disqualifies
 *  it. "Branch Officer" and "Branch In Charge" were both measured asserting. */
const ROLE_WORDS = new Set([
  "officer", "officers", "manager", "managers", "charge", "chief", "deputy",
  "assistant", "executive", "administrator", "operator", "clerk", "cashier",
  "teller", "guard", "peon", "attendant", "supervisor", "engineer", "accountant",
  "coordinator", "receptionist", "counselor", "counsellor", "staff", "employee",
  "staffs", "employees", "worker", "workers", "driver", "monitor", "incharge",
]);

/** Organisational-unit nouns, other than the office/branch markers themselves. */
const UNIT_WORDS = new Set([
  "department", "departments", "division", "divisions", "section", "sections",
  "committee", "committees", "board", "boards", "team", "teams", "cell", "cells",
  "wing", "wings", "directorate", "secretariat", "corps",
]);

/** A cell that is exactly a district/place word, e.g. "Morang" or "काठमाडौँ". */
function isBareDistrictName(raw: string): boolean {
  const lower = cleanCell(raw).toLowerCase();
  if (lower.length === 0) return false;
  return DISTRICT_WORDS.some((d) => lower === d.toLowerCase());
}

/**
 * A registered-company name is an organisation, not a location. Measured on the
 * committed target set: nationalmicrofinance asserted its own
 * "NATIONAL LAGHUBITTA BITTIYA SANSTHA LTD." as a branch_name, because "bittiya"
 * is a branch marker and the value was long enough to look like a place. The
 * legal form is a generic suffix, so this is a value class, not a site rule.
 */
const ENTITY_SUFFIX_RE =
  /\b(?:ltd|limited|company|co|pvt|inc|incorporated|plc|corporation|holding|sanstha|समिति|institute|foundation|association|cooperative)\b\.?\s*$/i;

/**
 * Directory name cells must look like a branch/office location, not any
 * title-case string: a branch/office/unit marker, or a known district/place
 * word. Persons and column labels ("S.No.") never qualify.
 */
/** Crude English singular, so "offices" is judged by the same rule as "office". */
function singularToken(t: string): string {
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** A word that names no place: branch/office/label vocabulary in either number. */
function isLabelToken(t: string): boolean {
  const s = singularToken(t);
  return BARE_BRANCH_TOKENS.has(t) || BARE_BRANCH_TOKENS.has(s) || NON_PLACE_WORDS.has(t) || NON_PLACE_WORDS.has(s);
}

function directoryNameLike(raw: string): boolean {
  const s = cleanCell(raw);
  if (PHONE_RE.test(s) || /@|https?:\/\/|www\./.test(s) || /\d/.test(s)) return false;
  if (s.length < 2 || s.length > 40) return false;
  if (HEADER_LABEL_RE.test(s)) return false;
  if (PERSON_ATTR_RE.test(s)) return false;
  // The institution's own registered name is never one of its branches.
  if (ENTITY_SUFFIX_RE.test(s)) return false;
  const lower = s.toLowerCase();
  if (BRANCH_MARKER_RE.test(lower)) {
      // "Branch Office" / "शाखा कार्यालय" with no place word is a generic
      // section/column heading, not a named branch. The same holds for the plural
      // collective forms a nav menu uses: "Branch Offices", "Our Branches".
      const tokens = s.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter(Boolean);
      if (tokens.length > 0 && tokens.every((t) => isLabelToken(t))) return false;
      // Every word is office vocabulary, so the value names no place at all:
      // "Corporate Office", "Office Hours", "Branch Finance Department".
      if (
        tokens.length > 0 &&
        tokens.every((t) => isLabelToken(t))
      ) {
        return false;
      }
    // An announcement, role or org-unit noun disqualifies the value wherever it
    // appears: "Branch Annual Meeting Notice", "Branch Officer",
    // "Branch Training Department".
    if (tokens.some((t) => NOTICE_WORDS.has(t) || ROLE_WORDS.has(t) || UNIT_WORDS.has(t))) {
      return false;
    }
    // A marker plus a collection noun is a section heading, not a record:
    // "Branch Network", "Branch List", "All Branches".
    const tail = tokens[tokens.length - 1];
    if (tail !== undefined && COLLECTION_TAIL_WORDS.has(tail)) return false;
    // Province with no district word anywhere is a province-only value:
    // "Bagmati Province", "Koshi Province".
    if (
      tokens.includes("province") &&
      !DISTRICT_WORDS.some((d) => lower.includes(d.toLowerCase()))
    ) {
      return false;
    }
    return true;
  }
  if (DISTRICT_WORDS.some((d) => lower === d.toLowerCase())) return true;
  return false;
}

const BRANCH_HEADER_MAP: Record<string, string> = {
  name: "name",
  // Headers that DECLARE branch semantics. Kept distinct from a bare "name"
  // because a table may carry both ("Name" = the manager, "Branch" = the office),
  // and the branch-declaring header is the authoritative name column.
  "branch": "branchname", "branch name": "branchname", "office name": "branchname",
  "branch office": "branchname", "branchname": "branchname", "office": "branchname",
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

/**
 * Value-level gate on a candidate branch_name. Applied at the point where the
 * BRANCH_NAME assertion would be created, so a bad value can never reach an
 * assertion while the row's address/phone/district evidence is still kept.
 *
 * Rejects, all observed on real committed targets:
 *   "Branch Manager"     a repeated column heading, not a location
 *   "Regional Office"    a generic section heading
 *   "Morang" / "Jhapa"   a district column read as the name column
 *
 * A name that is ONLY a district word is withheld rather than asserted: on the
 * measured pages that shape was always a column mix-up, never a branch actually
 * called after its district. The row is still recorded as evidence.
 */
export function isAssertableBranchName(raw: string): boolean {
  const s = cleanCell(raw);
  if (s.length === 0) return false;
  if (!directoryNameLike(s)) return false;
  if (isBareDistrictName(s)) return false;
  return true;
}

/** Placeholders a table uses for an empty cell. Never a branch name. */
const PLACEHOLDER_CELL_RE = /^(?:[-–—_./\\|,:*#\s]*|n\/?a|none|nil|null|unknown|tbd|not available|\d+)$/i;

/**
 * A value read from a column the publisher labelled as a branch column.
 *
 * In such a column the publisher has already stated that each cell is a branch,
 * so the value does not also have to carry branch vocabulary: a branch named
 * after its own village ("Ghorahi", "Amardaha") is legitimately a bare place word
 * and the lexical test can never recognise it. What is still refused is every
 * value that is not a place: contact syntax, numbers and codes, column labels,
 * role labels, placeholders, and the institution's own registered name.
 *
 * Person-shape is deliberately NOT re-tested here. A one-word village name and a
 * one-word given name are the same string, so any test that separated them would
 * be a guess. The protection is structural instead: a branch-declaring header is
 * always preferred over a bare "Name" header (which is usually the person), and
 * these names are reported in their own provenance class for review.
 */
function declaredColumnNameLike(raw: string): boolean {
  const s = cleanCell(raw);
  if (s.length < 2 || s.length > 60) return false;
  if (PHONE_RE.test(s) || /@|https?:\/\/|www\./.test(s)) return false;
  if (/\d/.test(s)) return false; // a serial or ward code is not a name
  if (PLACEHOLDER_CELL_RE.test(s)) return false;
  if (HEADER_LABEL_RE.test(s)) return false;
  if (PERSON_ATTR_RE.test(s)) return false;
  if (ENTITY_SUFFIX_RE.test(s)) return false;
  const lower = s.toLowerCase();
  // A value built only from branch/office/label words is a heading, not a place.
  const tokens = s.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => isLabelToken(t))) return false;
  // A person title, "Mr."/"Mrs."/a Devanagari honorific, is never a branch.
  if (/^(?:mr|mrs|ms|miss|dr|prof)\.?\s/i.test(s)) return false;
  if (/श्री|श्रीमती|सुश्री/.test(s)) return false;
  // A notice, event or collection noun in the cell disqualifies it.
  if (s.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter(Boolean).some((t) => NOTICE_WORDS.has(t)) && !directoryNameLike(s)) return false;
  // Bare branch vocabulary with no place word is still a heading.
  if (BRANCH_MARKER_RE.test(lower) && tokens.length > 0 && tokens.every((t) => isLabelToken(t))) return false;
  return true;
}

/**
 * The value gate, plus the one context in which a bare place word is allowed.
 *
 * `declaresBranch` is true only when the cell sits in a column whose own header
 * says "Branch Name"/"Branch"/"Office". In that case the publisher has declared
 * the column's meaning and the lexical place test is replaced, not removed, by
 * that declaration. It is schema-declared, not positional: no column index, no
 * site knowledge, and it cannot fire on a table whose columns were inferred.
 */
function nameAllowedInColumn(raw: string, declaresBranch: boolean): boolean {
  if (!declaresBranch) return isAssertableBranchName(raw);
  return declaredColumnNameLike(raw);
}

// ---------------------------------------------------------------------------
// Attribute plausibility (M3.4 Phase 3 / 15).
//
// Every branch attribute except the name is evidence-only by confidence, so
// this gate does not decide assertion. It decides whether a value is usable
// evidence at all, and it returns a stable reason code so the quality report
// can group rejections instead of counting a single opaque "invalid" bucket.
// The reason codes are generic value classes, never institution-specific.
// ---------------------------------------------------------------------------

export type BranchAttributeRejection =
  | "EMPTY"
  | "TOO_LONG"
  | "CONTAINS_LETTERS"
  | "CONTAINS_URL"
  | "DATE_LIKE"
  | "DIGIT_COUNT"
  | "REPEATED_DIGITS"
  | "NOT_A_DISTRICT"
  | "GENERIC_LABEL"
  | "EMAIL_FORMAT"
  | "MAP_SCHEME"
  | "MAP_HOST"
  | "UNKNOWN_FIELD";

export type BranchAttributeVerdict =
  | { ok: true; value: string }
  | { ok: false; reason: BranchAttributeRejection };

/** A phone value: digits plus the separators humans write. Nothing else. */
const PHONE_ALLOWED_RE = /^[+(]?[\d][\d\s\-()./]{5,}\d$/;
const DIGIT_RUN_RE = /(\d)\1{5,}/;
const MAP_HOSTS = [
  "google.com", "google.co.in", "goo.gl", "maps.app.goo.gl", "maps.google",
  "openstreetmap.org", "osm.org", "bing.com", "mapquest.com", "here.com",
  "apple.com", "wikimapia.org", "mapy.cz", "google.com.np",
];

function reject(reason: BranchAttributeRejection): BranchAttributeVerdict {
  return { ok: false, reason };
}

/** A person name: not a contact value, not a URL, not a number, not a label. */
function personNameLike(raw: string): boolean {
  const v = cleanCell(raw);
  if (v.length < 3 || v.length > 80) return false;
  if (/https?:\/\/|@|\d/.test(v)) return false;
  if (BARE_BRANCH_TOKENS.has(v.toLowerCase())) return false;
  const tokens = v.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter(Boolean);
  // A value built only from role/org-unit/notice words and branch tokens is a
  // label, not a person: "Branch Manager", "BRANCH MANAGER", "Credit Department".
  const labelish = new Set<string>([...ROLE_WORDS, ...UNIT_WORDS, ...NOTICE_WORDS, ...BARE_BRANCH_TOKENS]);
  if (tokens.length > 0 && tokens.every((t) => labelish.has(t))) return false;
  // English + Devanagari personal names.
  if (/^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,3}$/u.test(v)) return true;
  if (/^[\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){0,3}$/u.test(v)) return true;
  return false;
}

/** A 10-digit national mobile, optionally +977. A landline is not a mobile. */
function mobileLike(raw: string): boolean {
  const digits = cleanCell(raw).replace(/\D/g, "");
  const local = digits.replace(/^977/, "");
  return local.length === 10 && local.startsWith("9");
}

/**
 * Deterministic validation of one branch attribute value. `field` is the
 * BRANCH_* field name. An unknown field is rejected rather than passed
 * through, so a future caller cannot accidentally assert an unvalidated
 * attribute.
 */
export function isAssertableBranchAttribute(
  field: string,
  raw: string,
): BranchAttributeVerdict {
  const v = cleanCell(raw);
  if (v.length === 0) return reject("EMPTY");
  if (v.length > 200) return reject("TOO_LONG");
  switch (field) {
    case "BRANCH_DISTRICT": {
      const hit = DISTRICT_WORDS.find((d) => d.toLowerCase() === v.toLowerCase());
      return hit ? { ok: true, value: hit } : reject("NOT_A_DISTRICT");
    }
    case "BRANCH_PLACE": {
      if (/https?:\/\//i.test(v)) return reject("CONTAINS_URL");
      if (PHONE_RE.test(v)) return reject("DIGIT_COUNT");
      if (/^\d+$/.test(v)) return reject("DIGIT_COUNT");
      if (BARE_BRANCH_TOKENS.has(v.toLowerCase())) return reject("GENERIC_LABEL");
      return { ok: true, value: v };
    }
    case "BRANCH_PHONE": {
      if (/[A-Za-zऀ-ॿ]/.test(v)) return reject("CONTAINS_LETTERS");
      if (!PHONE_ALLOWED_RE.test(v)) return reject("CONTAINS_LETTERS");
      if (DATE_RE.test(v) || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v)) {
        return reject("DATE_LIKE");
      }
      const digits = v.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return reject("DIGIT_COUNT");
      if (DIGIT_RUN_RE.test(digits)) return reject("REPEATED_DIGITS");
      return { ok: true, value: v };
    }
    case "BRANCH_EMAIL": {
      if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return reject("EMAIL_FORMAT");
      const tld = v.slice(v.lastIndexOf(".") + 1);
      if (!/^[A-Za-z]{2,}$/.test(tld)) return reject("EMAIL_FORMAT");
      return { ok: true, value: v };
    }
    case "BRANCH_MOBILE": {
      // A mobile is a mobile: the same digit hygiene as a phone, plus the
      // national-mobile shape. Keeps a manager's mobile from being recorded as
      // the branch line, and a landline from being recorded as a mobile.
      if (/[A-Za-zऀ-ॿ]/.test(v) || !PHONE_ALLOWED_RE.test(v)) return reject("CONTAINS_LETTERS");
      if (DATE_RE.test(v)) return reject("DATE_LIKE");
      if (!mobileLike(v)) return reject("DIGIT_COUNT");
      return { ok: true, value: v };
    }
    case "BRANCH_ADDRESS": {
      if (/https?:\/\//i.test(v)) return reject("CONTAINS_URL");
      if (v.includes("@")) return reject("CONTAINS_URL");
      if (PHONE_RE.test(v) || /^\d+$/.test(v)) return reject("DIGIT_COUNT");
      if (BARE_BRANCH_TOKENS.has(v.toLowerCase())) return reject("GENERIC_LABEL");
      if (ENTITY_SUFFIX_RE.test(v)) return reject("GENERIC_LABEL");
      return { ok: true, value: v };
    }
    case "BRANCH_MANAGER": {
      // Only an explicit, name-shaped person is a manager. Never inferred from
      // proximity, and never an organisation or a contact value.
      if (/https?:\/\//i.test(v) || v.includes("@")) return reject("CONTAINS_URL");
      if (/^\d+$/.test(v)) return reject("DIGIT_COUNT");
      if (!personNameLike(v)) return reject("GENERIC_LABEL");
      return { ok: true, value: v };
    }
    case "BRANCH_MAP_URL": {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return reject("MAP_SCHEME");
      }
      if (u.protocol !== "https:") return reject("MAP_SCHEME");
      const host = u.hostname.toLowerCase();
      const known = MAP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
      if (!known) return reject("MAP_HOST");
      return { ok: true, value: u.href };
    }
    default:
      return reject("UNKNOWN_FIELD");
  }
}

function bestName(cells: string[]): string | null {
  const candidates = cells.filter((c) => directoryNameLike(c) && !PHONE_RE.test(c));
  if (candidates.length === 0) return null;
  // Prefer a cell that names a location over a cell that is only a district
  // word. This is what a name-column/district-column mix-up looks like: the
  // district cell appears first and used to win outright.
  return candidates.find((c) => !isBareDistrictName(c)) ?? candidates[0] ?? null;
}

/**
 * Header cells of a table, or [] when the table has no header row.
 *
 * The header is not always the first row: several layouts print a sentence of
 * preamble ("...21 working branch offices mentioned below:") in a row of its own
 * before the real column labels. So the first few rows are scanned and the first
 * one that actually declares columns wins. The number of rows skipped is
 * returned as `preamble` so the caller can drop exactly those rows and nothing
 * else - no positional guessing about where data starts.
 */
function tableHeaderCells(tableHtml: string): { cells: string[]; preamble: number } {
  const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const noHeader = { cells: [] as string[], preamble: 0 };
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const isTh = /<th\b/i.test(rows[i]);
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rows[i])) !== null) {
      cells.push(cleanCell(cm[1]).toLowerCase().replace(/\s+/g, " ").trim());
    }
    if (cells.length === 0) continue;
    // A row is a header when it uses <th>, or when at least one of its cells is a
    // recognised column label. Without that test a headerless table's first DATA
    // row becomes the header, its values are treated as column names, and every
    // row of the table is then read against the wrong column semantics.
    const labelled = cells.some((c) => c.length > 0 && mapHeader(c) !== null);
    if (!isTh && !labelled) continue;
    return { cells, preamble: i };
  }
  return noHeader;
}

/** How many leading rows may be scanned before giving up on finding a header. */
const HEADER_SCAN_ROWS = 3;

/**
 * Choose the branch-name column for ONE table, from its own header row.
 *
 * This is table-scoped on purpose. Measured on forwardmfbank: the page carries a
 * branch table ("S.No. | Branch Name | Province | Province District | Local
 * Bodies | Ward | Address") AND a district summary table. Parsing every <tr> in
 * the document and picking a name-shaped cell per row pulled district names out
 * of the summary table and offered them as branch names; the gate then correctly
 * refused 48 of them. A table whose header has no name column contributes
 * nothing, which is the generic statement of "don't read a district list as a
 * branch list".
 *
 * When several header cells map to "name" — aatmanirbhar has both "Name" (the
 * manager) and "Branch" (the location) — the FIRST assertable value across those
 * columns wins. The manager is refused by the person gate, the location is not.
 * That resolution is by value, not by column position, so it transfers to any
 * table with the same semantics.
 */
  function selectNameColumn(header: string[]): number[] {
    // A header that declares branch semantics is the authoritative name column.
    // It is preferred over a bare "Name", because a directory table may carry
    // both: "Name" is frequently the person, and "Branch" is the office. Falling
    // back to whichever came first is how a manager column becomes 16 identical
    // "Branch Manager" values.
    const declared: number[] = [];
    const generic: number[] = [];
    header.forEach((h, i) => {
      if (h.length === 0) return;
      const role = mapHeader(h);
      if (role === "branchname") declared.push(i);
      else if (role === "name") generic.push(i);
    });
    if (declared.length > 0) return declared;
    if (generic.length > 0) return generic;
    // No recognised name header: fall back to a header cell that carries branch
    // vocabulary. A "Province"/"District" column is not a name column, so a header
    // that is exactly a region word is excluded.
    const cols: number[] = [];
    header.forEach((h, i) => {
      if (h.length === 0) return;
      if (DISTRICT_WORDS.some((d) => h.toLowerCase() === d.toLowerCase())) return;
      if (BRANCH_MARKER_RE.test(h)) cols.push(i);
    });
    return cols;
  }

  function parseBranchRows(html: string): BranchRow[] {
    const rows: BranchRow[] = [];
    const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tableRe.exec(html)) !== null) {
      const tableHtml = tm[1];
      const { cells: header, preamble } = tableHeaderCells(tableHtml);
      // Column semantics come from the header, and apply to every row of this
      // table. A table with no name-bearing header is not a branch table.
      const nameCols = header.length > 0 ? selectNameColumn(header) : [];
      const headerMapped = header.map((h) => mapHeader(h));
      const hasHeaderSchema = headerMapped.some((m) => m !== null);
      // True when the chosen name column's own header declares branch semantics.
      const nameColumnDeclaresBranch = nameCols.some((i) => headerMapped[i] === "branchname");

      const allRows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
      for (let rowIndex = preamble; rowIndex < allRows.length; rowIndex++) {
        const rm = { 1: allRows[rowIndex].replace(/^<tr\b[^>]*>/i, "").replace(/<\/tr>$/i, "") };
        const cells: string[] = [];
        const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
        let cm: RegExpExecArray | null;
        while ((cm = cellRe.exec(rm[1])) !== null) cells.push(cleanCell(cm[1]));
        if (cells.length < 2) continue;
        if (cells.some((c) => HEADER_LABEL_RE.test(c))) continue; // header/sequence row
        // Skip the header row itself when it is a <td> row.
        if (cells.length === header.length && cells.every((c, i) => c.toLowerCase().trim() === header[i])) continue;

        let name: string | null = null;
        let fromDeclaredColumn = false;
        if (nameCols.length > 0) {
          for (const i of nameCols) {
            const c = cells[i];
            if (c === undefined || c.length === 0) continue;
            if (nameAllowedInColumn(c, nameColumnDeclaresBranch)) { name = c; break; }
            if (name === null) name = c; // remember for the "all refused" case
          }
          // Every name column held an unassertable value: keep it as a candidate so
          // the report can show the refusal, but never as an assertion.
        } else if (!hasHeaderSchema) {
          // No header at all: fall back to value shape within the row.
          name = bestName(cells);
        }
        if (name === null) continue;
        if (nameCols.length > 0 && nameColumnDeclaresBranch) {
          // The chosen name column's own header declares branch semantics, so the
          // publisher stated each cell is a branch. Recorded on the row so this
          // class of name is reported separately and never mistaken for a name
          // that passed the lexical gate on its own.
          fromDeclaredColumn = true;
        }

      const namedCols = headerMapped.filter((m) => m !== null).length;
      const columnMap = header.map((h) => mapHeader(h));
      const by = (f: string): string | null => {
        const idx = columnMap.indexOf(f);
        return idx >= 0 ? (cells[idx] ?? null) : null;
      };
      const nameIdx = cells.indexOf(name);
      // A district must be a different cell from the name. "Head Office Butwal"
      // ends with a district word, so without this guard a branch named after a
      // district becomes its own district and the real district cell is missed.
      const district =
        by("district") ||
        (cells.find(
          (c, i) =>
            i !== nameIdx && c !== name && !PHONE_RE.test(c) && DISTRICT_WORDS.some((d) => c === d || c.endsWith(` ${d}`)),
        ) ??
          null);
      const phone = by("phone") || (cells.find((c) => PHONE_RE.test(c)) ?? null);
      const address = by("place");
      const emailCell = cells.find((c) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(c)) ?? null;
      const mapHref = (/<a\b[^>]*href\s*=\s*["']([^"']*(?:google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|openstreetmap|osm\.org)[^"']*)["']/i.exec(rm[1]) ?? [])[1] ?? null;
      const place =
        address ||
        (cells.find(
          (c, i) =>
            i !== nameIdx &&
            c !== name &&
            c !== district &&
            c !== phone &&
            c !== emailCell &&
            c.length <= 60 &&
            !PHONE_RE.test(c) &&
            /^[\p{L}\p{M}.'\s-]+$/u.test(c),
        ) ?? null);
      rows.push({
        name,
        district: district ?? null,
        place: place ?? null,
        address: address ?? null,
        phone: phone ?? null,
        mobile: null,
        email: emailCell,
        manager: null,
        map: mapHref,
        nameSource: "table",
        nameFromPersonCard: false,
        nameFromDeclaredBranchColumn: fromDeclaredColumn,
      });
      void namedCols;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// M3.4 — card-grid / record-block fallbacks.
//
// Two real branch directories in the committed target set do not use a record
// table at all, and both are ordinary CMS output rather than anything unusual:
//   A) heading-delimited card grid: <h4>Mahuli Branch</h4> followed by a 2-column
//      label->value table (address / phone / email / branch manager)
//   B) many records per cell: one <td> holding <br>-separated blocks of
//      "Branch Office" / "Birtamod, Jhapa" / "Contact: ..." / "Email: ..."
//
// Both are handled generically, and ONLY as a fallback: the record-table path
// always runs first and keeps priority, so no page that already parses is
// affected. No CSS class, no site, no institution.
// ---------------------------------------------------------------------------
const PHONE_SEARCH_RE = /(?:\+?\d[\d\s\-/()]{6,}\d)/;
/** Every word allowed in a line that starts a <br>-separated record. The line
 *  must also contain "office" or "branch" to open a record, so a stray "Branch"
 *  inside a sentence cannot start one. */
const OFFICE_TYPE_WORDS = new Set([
  "sub", "branch", "area", "regional", "head", "principal", "central", "field",
  "main", "office", "unit", "ward", "division", "zonal",
]);
function isOfficeTypeLine(line: string): boolean {
  const words = line.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 3) return false;
  if (!words.every((w) => OFFICE_TYPE_WORDS.has(w))) return false;
  return words.includes("office") || words.includes("branch");
}

/** The second line of a record is its distinguishing place. Without a comma or
 *  a known district, a line like "Office Hours" would otherwise turn into
 *  "Branch Office Hours" and assert as a branch name. */
function isPlaceLine(line: string): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (line.includes("@") || PHONE_SEARCH_RE.test(line)) return false;
  if (PERSON_ATTR_RE.test(line)) return false;
  return line.includes(",") || districtIn(line) !== null;
}

function firstPhoneIn(text: string): string | null {
  const m = text.match(PHONE_SEARCH_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function districtIn(text: string): string | null {
  const lower = text.toLowerCase();
  return DISTRICT_WORDS.find((d) => lower.includes(d.toLowerCase())) ?? null;
}

const EMAIL_SCAN_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const MOBILE_SCAN_RE = /(?:\+?977[-\s]?)?9\d{9}/g;

function firstOfMatches(text: string, re: RegExp): string | null {
  const m = new RegExp(re.source, re.flags).exec(text);
  return m ? m[0].trim() : null;
}

/** Shape A: a repeated card grid anchored on a heading.
 *
 *  M3.4 Phase 5: the heading is the record BOUNDARY, not necessarily the name.
 *  Measured on the committed target set, three of the four large card targets
 *  print the branch name in a heading with a serial code
 *  ("Simara Branch (001)", "[003]-Waling Branch"), and the fourth
 *  (sampadalaghubitta) puts the MANAGER in the heading and the branch name in the
 *  body of the same card. Delegating to parseCardRecords handles both, and keeps
 *  the plausibility gate here so this function cannot loosen it.
 */
function parseBranchBlockCandidates(html: string): { rows: BranchRow[]; weak: number } {
  const out: BranchRow[] = [];
  let weak = 0;
  for (const rec of parseCardRecords(html)) {
    const nameText = rec.name;
    if (nameText === null) continue;
    // A card with no contact and no corroboration is evidence, not a record: it
    // is counted and reported but never asserted, because a lone heading cannot
    // be told apart from a person, a department or a nav label.
    const assertable = isAssertableCard(rec);
    if (!assertable) weak++;
    // Geography is read from the labelled address, then from the contact-free
    // card text. Never from `text` itself: a mailbox such as
    // "butwal.branch@example.com" spells a district and would be mined as one.
    const chunkDistrict = districtIn(rec.address ?? rec.place ?? "") || districtIn(rec.freeText);
    out.push({
      name: nameText,
      district: chunkDistrict,
      place: rec.place ?? rec.address ?? null,
      address: rec.address,
      phone: rec.phone,
      mobile: rec.mobile,
      email: rec.email,
      manager: rec.manager,
      map: rec.map,
      nameSource: rec.nameSource === "body" ? "body" : "card",
      nameFromPersonCard: rec.nameFromPersonCard,
      assertable,
    });
  }
  return { rows: out, weak };
}

/** Shape B: <br>-separated record groups inside a single cell. */
function parseBranchCells(html: string): BranchRow[] {
  const out: BranchRow[] = [];
  const cre = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cre.exec(html)) !== null) {
    const inner = m[1];
    if (!/<br\s*\/?\s*>/i.test(inner)) continue;
    const lines = inner
      .split(/<br\s*\/?\s*>/i)
      .map((l) => cleanCell(l).replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 0);
    let cur: string[] = [];
    const flush = (): void => {
      const taken = cur;
      cur = [];
      if (taken.length < 2) return;
      const [typeLine, placeLine, ...rest] = taken;
      if (!isOfficeTypeLine(typeLine) || !isPlaceLine(placeLine)) return;
      // The office type alone is generic ("Branch Office"); the place line is
      // what makes it a record, so the name is the pair.
      const name = `${typeLine} ${placeLine}`;
      if (!isAssertableBranchName(name)) return;
      const tail = rest.join(" ");
      out.push({
        name,
        district: districtIn(placeLine),
        place: placeLine,
        address: null,
        phone: firstPhoneIn(tail),
        mobile: firstOfMatches(tail, MOBILE_SCAN_RE),
        email: firstOfMatches(tail, EMAIL_SCAN_RE),
        manager: null,
        map: null,
        nameSource: "cell",
        nameFromPersonCard: false,
      });
    };
    for (const line of lines) {
      const isType = isOfficeTypeLine(line);
      if (isType && cur.length > 0) flush();
      if (cur.length === 0 && !isType) continue; // ignore any preamble
      cur.push(line);
    }
    flush();
  }
  return out;
}

/**
 * Which grammar produced the rows, and the rows themselves. Table grammar is
 * tried first and is only abandoned when it yields no assertable name; the two
 * card grammars are fallbacks, and a fallback is only adopted on the same test.
 *
 * Exported so the Phase 4 inventory can report "how the parser read the page"
 * without re-implementing the choice, and so path selection has exactly one
 * implementation.
 */
export type BranchPath = "table" | "card" | "cell" | "none";

export function selectBranchRows(html: string): { path: BranchPath; rows: BranchRow[]; weak: number; refusedCards: string[] } {
  const table = parseBranchRows(html);
  // Path choice uses the SAME predicate the extractor asserts with, so a name that
  // qualifies only because its column declares branch semantics is not thrown
  // away by a stricter test used for the decision.
  const tableOk = (r: BranchRow): boolean => nameAllowedInColumn(r.name, r.nameFromDeclaredBranchColumn === true);
  if (table.some(tableOk)) return { path: "table", rows: table, weak: 0, refusedCards: [] };
  // Path choice uses the CANDIDATES, including cards that are too weak to
  // assert, and only the returned rows are filtered. Choosing the path after
  // filtering would report a page of evidence-only cards as "none" and lose the
  // very candidates worth reporting.
  const cards = parseBranchBlockCandidates(html);
  // Candidates the value gate refused are reported even when the page asserts
  // nothing, so a "Contact Us" or "Credit Department" page leaves a trace of why
  // it produced no branch instead of looking like a page that was never read.
  const refusedCards = [...new Set(cards.rows.filter((r) => !isAssertableBranchName(r.name)).map((r) => r.name))];
  if (cards.rows.some((r) => isAssertableBranchName(r.name))) {
    return { path: "card", rows: cards.rows.filter((r) => r.assertable !== false), weak: cards.weak, refusedCards };
  }
  const cells = parseBranchCells(html);
  if (cells.some((r) => isAssertableBranchName(r.name))) return { path: "cell", rows: cells, weak: cards.weak, refusedCards };
  return { path: "none", rows: table, weak: cards.weak, refusedCards };
}

export const branchDirectoryExtractor: HtmlExtractor = {
  parserId: BRANCH_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    if (ctx.capability !== "BRANCH_DIRECTORY") return [];
    const html = new TextDecoder().decode(ctx.body);
    const cap = ctx.capability as ExtractedEvidence["capability"];
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    const { rows } = selectBranchRows(html);
    for (const row of rows) {
      // Value gate: never create a branch_name assertion from a value that is a
      // repeated column heading, a generic "Branch Office"-style phrase, or a
      // bare district word. The row's attribute evidence below is still kept.
      // A name taken from a column the publisher labelled as a branch column is
      // held to the same test with the one documented exception.
      if (nameAllowedInColumn(row.name, row.nameFromDeclaredBranchColumn === true)) {
        out.push({ kind: "FIELD", capability: cap, field: "BRANCH_NAME", sourceUrl: ctx.url, text: row.name, confidence: 0.6, parserId: BRANCH_PARSER_ID, extractedAt: now });
      }
      // Attributes are evidence-only (0.45 < the 0.5 assertion gate). Each is
      // validated on its own, so an invalid phone never invalidates the name and
      // a valid name is never withheld because an attribute was refused.
      const attrs: Array<[string, string | null]> = [
        ["BRANCH_DISTRICT", row.district],
        ["BRANCH_PLACE", row.place],
        ["BRANCH_ADDRESS", row.address],
        ["BRANCH_PHONE", row.phone],
        ["BRANCH_MOBILE", row.mobile],
        ["BRANCH_EMAIL", row.email],
        ["BRANCH_MANAGER", row.manager],
        ["BRANCH_MAP_URL", row.map],
      ];
      for (const [field, raw] of attrs) {
        if (!raw) continue;
        const v = isAssertableBranchAttribute(field, raw);
        if (!v.ok) continue;
        // PLACE and ADDRESS are the same evidence from two grammars; keep one.
        if (field === "BRANCH_ADDRESS" && out.some((e) => e.field === "BRANCH_PLACE" && e.text === v.value)) continue;
        out.push({ kind: "FIELD", capability: cap, field, sourceUrl: ctx.url, text: v.value, confidence: 0.45, parserId: BRANCH_PARSER_ID, extractedAt: now });
      }
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
      // Value-level backstop. A "directory" whose single value repeats across
      // most rows is a column heading that got read as data, not a set of
      // distinct records. Measured case: a genuine 24-branch page where the
      // name column resolved to "Branch Manager" sixteen times.
      const texts = rows.map((r) => (r.text ?? "").trim()).filter((t) => t.length > 0);
      const counts = new Map<string, number>();
      for (const t of texts) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
      let topValue = "";
      let topCount = 0;
      for (const [v, c] of counts) {
        if (c > topCount) {
          topValue = v;
          topCount = c;
        }
      }
      const distinct = counts.size;
      if (rows.length >= 3 && topCount >= 3 && topCount * 2 >= rows.length) {
        return {
          status: "PENDING",
          severity: "warning",
          ruleId,
          message: `${fieldPrefix.toLowerCase()} column is a repeated heading, not distinct records`,
          evidence: { count: rows.length, distinct, repeatedValue: topValue, repeatedCount: topCount },
        };
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
// ---------------------------------------------------------------------------
// M3.4 Phase 4 / 14 — parser-result analysis.
//
// Reports what the parser did to a page without writing anything: which grammar
// won, how many candidate records it produced, how many the value gate refused,
// how many survived, and per-attribute extracted/valid/refused tallies broken
// down by reason code. Pure function of the HTML.
// ---------------------------------------------------------------------------

export interface AttributeTally {
  extracted: number;
  valid: number;
  refused: number;
  /** value -> reason code, only for refused values */
  reasons: Record<string, number>;
}

export interface BranchPageAnalysis {
  path: BranchPath;
  candidateRecords: number;
  validNames: number;
  rejectedNames: number;
  /** rows that were refused as names but still contributed attribute evidence */
  evidenceOnlyRows: number;
  /** names whose text came from a card body because the heading was a person */
  namesFromPersonCards: number;
  /** cards kept as evidence only, because a name alone is not enough */
  weakCardCandidates: number;
  /** card candidates the value gate refused, reported even on a zero-assert page */
  refusedCardCandidates: string[];
  attributes: Record<string, AttributeTally>;
  rejectedNameSamples: string[];
  nameSamples: string[];
  /** attribute values found on accepted records, for the quality matrix */
  accepted: Array<{
    name: string;
    nameSource: string;
    nameFromPersonCard: boolean;
    district: string | null;
    place: string | null;
    address: string | null;
    phone: string | null;
    mobile: string | null;
    email: string | null;
    manager: string | null;
    map: string | null;
  }>;
}

const NAME_REJECTED_SAMPLE_CAP = 12;
const ACCEPTED_SAMPLE_CAP = 4000;

function tally(): AttributeTally {
  return { extracted: 0, valid: 0, refused: 0, reasons: {} };
}

export function analyzeBranchPage(html: string): BranchPageAnalysis {
  const { path, rows, weak, refusedCards } = selectBranchRows(html);
  const attributes: Record<string, AttributeTally> = {
    BRANCH_DISTRICT: tally(),
    BRANCH_PLACE: tally(),
    BRANCH_ADDRESS: tally(),
    BRANCH_PHONE: tally(),
    BRANCH_MOBILE: tally(),
    BRANCH_EMAIL: tally(),
    BRANCH_MANAGER: tally(),
    BRANCH_MAP_URL: tally(),
  };
  let validNames = 0;
  let rejectedNames = 0;
  let evidenceOnlyRows = 0;
  let namesFromPersonCards = 0;
  const rejectedNameSamples: string[] = [];
  const nameSamples: string[] = [];
  const accepted: BranchPageAnalysis["accepted"] = [];

  for (const row of rows) {
    if (nameAllowedInColumn(row.name, row.nameFromDeclaredBranchColumn === true)) {
      validNames++;
      if (row.nameFromPersonCard) namesFromPersonCards++;
      if (nameSamples.length < NAME_REJECTED_SAMPLE_CAP) nameSamples.push(row.name);
      if (accepted.length < ACCEPTED_SAMPLE_CAP) accepted.push({ name: row.name, nameSource: row.nameSource, nameFromPersonCard: row.nameFromPersonCard, district: row.district, place: row.place, address: row.address, phone: row.phone, mobile: row.mobile, email: row.email, manager: row.manager, map: row.map });
    } else {
      rejectedNames++;
      const seen = new Set(rejectedNameSamples);
      if (rejectedNameSamples.length < NAME_REJECTED_SAMPLE_CAP && !seen.has(row.name)) {
        rejectedNameSamples.push(row.name);
      }
      if (row.district || row.place || row.phone) evidenceOnlyRows++;
    }
    const pairs: Array<[string, string | null]> = [
      ["BRANCH_DISTRICT", row.district],
      ["BRANCH_PLACE", row.place],
      ["BRANCH_ADDRESS", row.address],
      ["BRANCH_PHONE", row.phone],
      ["BRANCH_MOBILE", row.mobile],
      ["BRANCH_EMAIL", row.email],
      ["BRANCH_MANAGER", row.manager],
      ["BRANCH_MAP_URL", row.map],
    ];
    for (const [field, raw] of pairs) {
      if (!raw) continue;
      const t = attributes[field];
      t.extracted++;
      const verdict = isAssertableBranchAttribute(field, raw);
      if (verdict.ok) t.valid++;
      else {
        t.refused++;
        t.reasons[verdict.reason] = (t.reasons[verdict.reason] ?? 0) + 1;
      }
    }
  }
  return { path, candidateRecords: rows.length, validNames, rejectedNames, evidenceOnlyRows, namesFromPersonCards, weakCardCandidates: weak, refusedCardCandidates: refusedCards.slice(0, NAME_REJECTED_SAMPLE_CAP), attributes, rejectedNameSamples, nameSamples, accepted };
}
