// ============================================================================
// Phase R3 — deterministic People/Leadership extraction (AI OFF).
//
// Institution-agnostic, structure-driven HTML parsing: locates leadership
// sections (English + Nepali), reads name/role cells and structured name runs,
// and emits people evidence that flows through the EXISTING pipeline as
// UNVERIFIED assertions + validation rows. NO per-MFB code, NO AI, NO OCR, NO
// browser automation, NO schema change.
//
// Honesty floors (never over-claim):
//   - table cell name  → confidence 0.60   (structured, asserted)
//   - bold/strong name → confidence 0.55   (asserted)
//   - list item name   → confidence 0.50   (asserted)
//   - free paragraph   → confidence 0.40   (NOT asserted; evidence only)
//   The engine only persists assertions at confidence ≥ 0.50, so unstructured
//   prose never creates a people assertion. Extracted names still surface to
//   validation/audit for review.
// ============================================================================

import type { ExtractedEvidence } from "./types";
import type { Validator, ValidationContext } from "./contract";

/** Assertion field-name family prefixes emitted by this parser. */
export const PEOPLE_CAPABILITIES = ["PEOPLE_CHAIR", "PEOPLE_CEO", "PEOPLE_DIRECTOR", "PEOPLE_BOARD"] as const;
export type PeopleCapability = (typeof PEOPLE_CAPABILITIES)[number];

export const PEOPLE_DIRECTORY_RULE_ID = "r-people-directory";
export const PEOPLE_PARSER_ID = "people-html-v1";

/** Engine-compatible extractor shape (a single context carrying the body). */
export interface HtmlExtractor {
  parserId: string;
  extract(ctx: {
    sourceId: string;
    institutionId?: string;
    capability: string;
    url: string;
    parserId: string;
    contentHash: string;
    body: Uint8Array;
  }): Promise<ExtractedEvidence[]>;
}

// ---------------------------------------------------------------------------
// Role vocabulary (English + Nepali). Generic; role families map to the four
// people capabilities above. Matching is lowercase-contains on section
// headings, designation cells, or inline role markers.
// ---------------------------------------------------------------------------

const ROLE_FAMILIES: Array<[PeopleCapability, string[]]> = [
  ["PEOPLE_CHAIR", ["chairperson", "chairman", "बोर्ड अध्यक्ष", "अध्यक्ष", "सभापति", "उपाध्यक्ष", "उप-अध्यक्ष", "vice chair"]],
  ["PEOPLE_CEO", ["chief executive", "ceo", "general manager", "प्रमुख कार्यकारी", "मुख्य कार्यकारी", "कार्यकारी प्रमुख", "कार्यकारी निर्देशक", "महाप्रबन्धक", "महाप्रबंधक"]],
  ["PEOPLE_DIRECTOR", ["director", "संचालक", "सञ्चालक", "निर्देशक", "स्वतन्त्र संचालक", "स्वतन्त्र सञ्चालक"]],
  ["PEOPLE_BOARD", ["board member", "executive committee", "management team", "management", "committee member", "member", "सदस्य", "समिति", "व्यवस्थापन", "व्यवस्थापक", "प्रबन्धक", "प्रबंधक", "टिम", "टीम", "कार्य समिति"]],
];

/** Section-heading labels that mark a leadership section for scanning. */
const SECTION_HINTS = [
  "board of directors", "our board", "board members", "leadership", "our team",
  "management team", "senior management", "management", "executive committee",
  "governing body", "committee", "directors",
  "संचालक समिति", "सञ्चालक समिति", "कार्यकारी समिति", "व्यवस्थापन समिति", "प्रबन्ध समिति",
  "हाम्रो टिम", "हाम्रो टीम", "अध्यक्ष", "कार्यसमिति", "कार्य समिति",
];

/** Header-row labels (name/designation columns); a row of all-label cells is skipped. */
const HEADER_CELLS = new Set([
  "name", "names", "designation", "position", "title", "role", "board", "remarks",
  "नाम", "पद", "दायरा", "होदा", "तह", "जिम्मेवारी",
]);

const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "er", "prof", "shri", "श्री", "श्रीमती", "डा", "इ", "प्रा"]);
const STOP_TOKENS = new Set([
  "board", "team", "committee", "management", "directors", "director", "chairman",
  "chairperson", "leadership", "executive", "staff", "group", "member", "members",
  "समिति", "सदस्य", "टिम", "टीम", "व्यवस्थापन",
]);

/** Is a string plausibly a person's name (Devangari names have no case)? */
export function nameLike(raw: string): boolean {
  const s = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 4 || s.length > 80) return false;
  if (/\d/.test(s)) return false;
  if (/@|https?:\/\/|www\./.test(s)) return false;
  const tokens = s.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 6) return false;
  if (tokens.every((t) => t.length === 1)) return false;
  const tokenRe = /^[\p{L}\p{M}][\p{L}\p{M}.'’ -]*$/u;
  if (tokens.some((t) => !tokenRe.test(t))) return false;
  const hasDevanagari = /[\u0900-\u097f]/u.test(s);
  if (hasDevanagari) {
    if (tokens.some((t) => t.length > 30)) return false;
    const core = tokens.filter((t) => !HONORIFICS.has(t.toLocaleLowerCase())).join(" ");
    return core.replace(/\s+/g, "").length >= 4;
  }
  const tcs = tokens.filter((t) => HONORIFICS.has(t.toLocaleLowerCase()) || /^\p{Lu}/u.test(t));
  if (tcs.length < 2) return false;
  if (tokens.some((t) => t.length > 24)) return false;
  const nonHonorific = tokens.filter((t) => !HONORIFICS.has(t.toLocaleLowerCase()));
  return !(nonHonorific.length <= 2 && nonHonorific.every((t) => STOP_TOKENS.has(t.toLocaleLowerCase())));
}

/** Resolve a text fragment to a people role family, or null. */
function roleFamily(raw: string): PeopleCapability | null {
  const s = raw.toLowerCase();
  for (const [fam, words] of ROLE_FAMILIES) {
    if (words.some((w) => s.includes(w))) return fam;
  }
  return null;
}

/** Is a heading/reference markering a leadership section to scan? */
function isSectionHeading(raw: string): boolean {
  const s = raw.toLowerCase();
  return SECTION_HINTS.some((h) => s.includes(h));
}

export function cleanCell(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

interface PersonPick {
  name: string;
  role: PeopleCapability;
  confidence: number;
}

/** Parse name+role pairs out of an HTML block belonging to a leadership section. */
function pickPeopleFromBlock(blockHtml: string, blockRole: PeopleCapability | null): PersonPick[] {
  const picks: PersonPick[] = [];

  // Enclosure ranges (table rows / list items) whose children must not be
  // re-reported by the bold-run pass.
  const enclosed: Array<[number, number]> = [];
  const liRe0 = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liM0: RegExpExecArray | null;
  while ((liM0 = liRe0.exec(blockHtml)) !== null) enclosed.push([liM0.index, liRe0.lastIndex]);
  const tdRe0 = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let tdM0: RegExpExecArray | null;
  while ((tdM0 = tdRe0.exec(blockHtml)) !== null) enclosed.push([tdM0.index, tdRe0.lastIndex]);
  const inEnclosure = (pos: number): boolean => enclosed.some(([a, b]) => pos > a && pos < b);

  // (1) TABLE rows: designation cell (role keyword) + name cell, or name-only rows.
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(blockHtml)) !== null) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(row)) !== null) cells.push(cleanCell(cellMatch[1]));
    if (cells.length === 0) continue;
    if (cells.every((c) => HEADER_CELLS.has(c.toLowerCase()))) continue; // header row
    // Preference: any cell carrying a role compound ("Chairman", "Independent
    // Director") is the designation column; others are name candidates.
    const roleCell = cells.find((c) => roleFamily(c) !== null);
    const role = (roleCell && roleFamily(roleCell)) || blockRole;
    if (role === null) continue;
    const nameCells = cells.filter((c) => c !== roleCell && nameLike(c));
    for (const name of nameCells) picks.push({ name, role: role, confidence: 0.6 });
  }

  // (2) bold/strong runs OUTSIDE tables and list items → structured name runs.
  const richRe = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  let rich: RegExpExecArray | null;
  while ((rich = richRe.exec(blockHtml)) !== null) {
    if (inEnclosure(rich.index)) continue;
    const frag = rich[1];
    const t = cleanCell(frag);
    if (nameLike(t) && roleFamily(t) === null) {
      const role = blockRole ?? "PEOPLE_BOARD";
      picks.push({ name: t, role, confidence: 0.55 });
    }
  }

  // (3) list items → "Name - Role" or plain name.
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;
  while ((li = liRe.exec(blockHtml)) !== null) {
    const t = cleanCell(li[1]);
    const sep = /^(.*?)\s+(?:-|–|—|:)\s+(.*)$/.exec(t);
    if (sep) {
      const namePart = sep[1].trim();
      if (nameLike(namePart)) {
        picks.push({ name: namePart, role: roleFamily(t) ?? blockRole ?? "PEOPLE_BOARD", confidence: 0.5 });
      }
    } else if (nameLike(t)) {
      picks.push({ name: t, role: blockRole ?? "PEOPLE_BOARD", confidence: 0.5 });
    }
  }

  // (4) free paragraph: only a direct "Name, <role>" lead — confidence 0.4 so
  // it is recorded as evidence but never becomes an assertion.
  const leadRe = /([\p{Lu}][\p{L}\p{M}.'’ -]{1,50})\s*(?:,|–|:)?\s*(?:chief|chair|director|general|अध्यक्ष|संचालक|सञ्चालक|कार्यकारी)/u;
  const textOnly = blockHtml.replace(/<(?:table|tr|t[hd]|li|strong|b)\b[\s\S]*?<\/(?:table|tr|t[hd]|li|strong|b)>/gi, " ");
  const text = cleanCell(textOnly);
  const m = leadRe.exec(text);
  if (m && nameLike(m[1].trim())) {
    picks.push({ name: m[1].trim(), role: roleFamily(text) ?? blockRole ?? "PEOPLE_BOARD", confidence: 0.4 });
  }

  // Dedupe by (name, role) keeping the highest confidence.
  const seen = new Map<string, PersonPick>();
  for (const p of picks) {
    const key = `${p.role}|${p.name.toLocaleLowerCase().replace(/\s+/g, " ")}`;
    const prev = seen.get(key);
    if (!prev || p.confidence > prev.confidence) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * Deterministic HTML people extractor (Phase R3).
 * parserId PEOPLE_PARSER_ID. Emits FIELD evidence per person: `capability`
 * stays the page capability (page-shaped), `field` names the role
 * (PEOPLE_CHAIR / PEOPLE_CEO / PEOPLE_DIRECTOR / PEOPLE_BOARD) which drives
 * the UNVERIFIED assertion field name.
 */
export const peopleExtractor: HtmlExtractor = {
  parserId: PEOPLE_PARSER_ID,
  async extract(ctx): Promise<ExtractedEvidence[]> {
    const text = new TextDecoder().decode(ctx.body);
    const out: ExtractedEvidence[] = [];
    const now = new Date().toISOString();
    const cap = (ctx.capability as ExtractedEvidence["capability"]) || "WEBSITE";

    // Slice the document into blocks between consecutive headings.
    const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings: Array<{ level: number; text: string; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(text)) !== null) {
      headings.push({
        level: Number(m[1]),
        text: cleanCell(m[2]),
        start: m.index,
        end: headingRe.lastIndex,
      });
    }

    const candidates: Pick<PersonPick, "name" | "role" | "confidence">[] = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (!isSectionHeading(h.text)) continue;
      const blockStart = h.end;
      const blockEnd = i + 1 < headings.length ? headings[i + 1].start : text.length;
      const blockHtml = text.slice(blockStart, blockEnd);
      const blockRole = roleFamily(h.text);
      for (const p of pickPeopleFromBlock(blockHtml, blockRole)) candidates.push(p);
    }

    for (const p of candidates) {
      out.push({
        kind: "FIELD",
        capability: cap,
        field: p.role,
        sourceUrl: ctx.url,
        text: p.name,
        confidence: p.confidence,
        parserId: PEOPLE_PARSER_ID,
        extractedAt: now,
      });
    }
    return out;
  },
};

/** Compose two extractors into one (evidence concatenated, parserId joined). */
export function composeExtractors(a: HtmlExtractor, b: HtmlExtractor): HtmlExtractor {
  return {
    parserId: `${a.parserId}+${b.parserId}`,
    async extract(ctx): Promise<ExtractedEvidence[]> {
      return [...(await a.extract(ctx)), ...(await b.extract(ctx))];
    },
  };
}

/**
 * Deterministic people-directory validator.
 * PASS when at least one people field was extracted on this snapshot (with the
 * extracted roster in evidence); PENDING when the snapshot had no people
 * evidence (disambiguation from "found nothing", not a defect); FAIL only on a
 * genuinely malformed people value (defensive; never expected in practice).
 */
export const peopleDirectoryValidator: Validator = {
  ruleId: PEOPLE_DIRECTORY_RULE_ID,
  severity: "warning",
  async validate(ctx: ValidationContext) {
    const people = ctx.evidence.filter((e) => e.kind === "FIELD" && (e.field ?? "").startsWith("PEOPLE_"));
    const junk = people.filter((e) => !nameLike(e.text ?? ""));
    if (junk.length > 0) {
      return {
        status: "FAIL",
        severity: "warning",
        ruleId: PEOPLE_DIRECTORY_RULE_ID,
        message: `junk people value: ${junk[0].text}`,
        evidence: { peopleCount: people.length, junk: junk.map((j) => j.text) },
      };
    }
    if (people.length === 0) {
      return {
        status: "PENDING",
        severity: "info",
        ruleId: PEOPLE_DIRECTORY_RULE_ID,
        message: "no people evidence on this snapshot",
        evidence: { peopleCount: 0 },
      };
    }
    const roles: Record<string, number> = {};
    for (const p of people) {
      const r = String(p.field);
      roles[r] = (roles[r] ?? 0) + 1;
    }
    return {
      status: "PASS",
      severity: "warning",
      ruleId: PEOPLE_DIRECTORY_RULE_ID,
      message: `${people.length} people name(s) extracted (UNVERIFIED)`,
      evidence: { peopleCount: people.length, roles, names: people.map((p) => p.text).slice(0, 20) },
    };
  },
};

export const peopleValidators: ReadonlyArray<Validator> = [peopleDirectoryValidator];