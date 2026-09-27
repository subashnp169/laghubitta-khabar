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
export const PEOPLE_JSON_PARSER_ID = "people-json-v1";

/** Engine-compatible extractor shape (a single context carrying the body). */
export interface HtmlExtractor {
  parserId: string;
  extract(ctx: {
    sourceId: string;
    institutionId?: string;
    sourceType?: string;
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
  "board of directors", "our board", "board members", "board", "leadership", "our team",
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
export function peopleRoleFamily(raw: string): PeopleCapability | null {
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

/**
 * Site navigation subtrees: <nav>, <footer> and role="navigation" regions.
 * A leadership block must never read a person out of a menu or a footer, so
 * these subtrees are REMOVED from the block before any pass looks at it.
 *
 * Removal (not truncation) is deliberate and evidence-driven: on a real
 * leadership page the site menu precedes the people markup and the footer
 * follows it, so cutting the block at the first <nav> would delete the very
 * content we came for. Dropping the subtrees satisfies the safety requirement
 * ("a menu label can never become a person") without depending on document
 * order, and legitimate leadership lists outside navigation are untouched.
 */
const NAV_SUBTREE_RE =
  /<(nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>|<\w+\b[^>]*\brole\s*=\s*["']?navigation["']?[^>]*>[\s\S]*?<\/\w+\s*>/gi;

function stripNavigation(html: string): string {
  return html.replace(NAV_SUBTREE_RE, " ");
}

interface HeadingElement {
  start: number;
  end: number;
  text: string;
}

/**
 * Heading-style elements: real h1..h6, plus any element whose class carries a
 * heading/title token. Page builders routinely render a person's name in a
 * styled <span>/<div> rather than a heading tag, so the class token is the
 * generic signal - no vendor, class or selector is named anywhere.
 *
 * Ranges are resolved with a nesting-aware scan: a page-builder name sits two
 * or three elements deep (container > widget > h4), and a flat regex would let
 * the outer <div> swallow the inner heading entirely.
 */
function headingElements(html: string): HeadingElement[] {
  const out: HeadingElement[] = [];
  const stack: Array<{ tag: string; start: number; contentStart: number; candidate: boolean }> = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { idx = i; break; }
      }
      if (idx === -1) continue; // stray close tag
      const opened = stack.splice(idx, 1)[0];
      if (opened.candidate) {
        out.push({ start: opened.start, end: m.index, text: cleanCell(html.slice(opened.contentStart, m.index)) });
      }
      continue;
    }
    const attrs = m[3] ?? "";
    stack.push({
      tag,
      start: m.index,
      contentStart: re.lastIndex,
      candidate: /^h[1-6]$/.test(tag) || /\b(heading|title)\b/i.test(attrs),
    });
  }
  return out;
}

interface ContainerNode {
  start: number;
  end: number;
}

/** Flat div nesting ranges - the only structure the container pass needs. */
function containerNodes(html: string): ContainerNode[] {
  const nodes: ContainerNode[] = [];
  const open: number[] = [];
  const re = /<(\/?)div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      const idx = open.pop();
      if (idx !== undefined) nodes[idx].end = m.index;
    } else {
      open.push(nodes.length);
      nodes.push({ start: m.index, end: html.length });
    }
  }
  return nodes;
}

/**
 * Generic page-builder roster pass.
 *
 * Target structure (relationships only, never a site/selector):
 *   repeated structural container
 *       -> heading-style element whose text is a name
 *       -> a sibling heading/span element whose text is a role
 *
 * A unit is emitted only when the enclosing container actually holds BOTH the
 * name and a role element, so an unrelated heading never becomes a person. Two
 * or more such units in one leadership block are treated as a roster; a single
 * lone unit is left to the other passes, because one ambiguous heading is more
 * likely prose than a person. Missing people is the cheaper error here, so the
 * pass stays strict and never invents a role it did not read from the page.
 */
function pickContainerRoster(blockHtml: string): PersonPick[] {
  const headings = headingElements(blockHtml);
  const nameEls = headings.filter((h) => h.text && nameLike(h.text) && peopleRoleFamily(h.text) === null);
  const roleEls = headings.filter((h) => h.text && peopleRoleFamily(h.text) !== null);
  if (nameEls.length === 0 || roleEls.length === 0) return [];

  const nodes = containerNodes(blockHtml);
  const units: Array<{ name: string; role: PeopleCapability }> = [];
  for (const nameEl of nameEls) {
    // Innermost first: page builders wrap each name in its own widget <div>, so
    // the role element sits one or two levels further out. The first container
    // that holds a role wins, which keeps the pairing local to the person.
    const ancestors = nodes
      .filter((n) => n.start < nameEl.start && nameEl.end <= n.end)
      .sort((a, b) => b.start - a.start);
    let role: PeopleCapability | null = null;
    for (const node of ancestors) {
      const hit = roleEls
        .filter((r) => r.start >= node.start && r.end <= node.end && (r.end <= nameEl.start || r.start >= nameEl.end))
        .sort(
          (a, b) =>
            Math.min(Math.abs(a.start - nameEl.end), Math.abs(nameEl.start - a.end)) -
            Math.min(Math.abs(b.start - nameEl.end), Math.abs(nameEl.start - b.end)),
        )[0];
      if (hit) {
        role = peopleRoleFamily(hit.text);
        break;
      }
    }
    if (!role) continue;
    units.push({ name: nameEl.text, role });
  }

  if (units.length < 2) return [];
  return units.map((u) => ({ name: u.name, role: u.role, confidence: 0.55, roleExplicit: true }));
}

export function cleanCell(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

interface PersonPick {
  name: string;
  role: PeopleCapability;
  confidence: number;
  /** True when the role came from the item itself, not the section heading. */
  roleExplicit?: boolean;
}

// ---------------------------------------------------------------------------
// Card/profile pass — self-contained profile blocks in a leadership section.
// A class-hinted container (card/profile/member/team) that holds exactly one
// name-bearing run is treated as one person: name from an inner heading,
// strong, or name-marked element; role from the card text or the block heading.
// Multi-person containers (those wrapping lists/tables) are left to their own
// passes. confidence 0.55.
// ---------------------------------------------------------------------------

const CARD_CLASS_TOKEN = /(?:^|[\s_-])(?:card|profile|member|team|board_?member)(?:[\s_-]|$)/i;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface CardRange {
  html: string;
  start: number;
  end: number;
}

/** Depth-1 class-hinted containers: nested same-tag cards are rejected, so a
 * card grid `card > cards` never double-reports (inner cards still match
 * independently, which is what we want). */
function findCardRanges(blockHtml: string): CardRange[] {
  const ranges: CardRange[] = [];
  const openRe = /<([a-zA-Z][\w-]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(blockHtml)) !== null) {
    const tag = m[1].toLowerCase();
    if (VOID_TAGS.has(tag)) continue;
    const classMatch = /class\s*=\s*"([^"]*)"/i.exec(m[0]);
    if (!classMatch || !CARD_CLASS_TOKEN.test(classMatch[1])) continue;
    const innerStart = openRe.lastIndex;
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    const remainder = blockHtml.slice(innerStart);
    const cm = closeRe.exec(remainder);
    if (!cm) continue;
    const inner = remainder.slice(0, cm.index);
    if (new RegExp(`<${tag}\\b`, "i").test(inner)) continue; // nested → skip
    ranges.push({ html: inner, start: m.index, end: innerStart + cm.index + cm[0].length });
  }
  return ranges;
}

/** The single name carried by a card, or null (multi-name/multi-role runs
 * belong to the list/table passes; never guess a wrapper heading name). */
function pickCardName(inner: string): string | null {
  if (/<(?:ul|ol|table|tr|t[hd])[\s>]/i.test(inner)) return null;
  const cands: string[] = [];
  const headingRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(inner)) !== null) {
    const t = cleanCell(hm[1]);
    if (t && !peopleRoleFamily(t)) cands.push(t);
  }
  const strongRe = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = strongRe.exec(inner)) !== null) {
    const t = cleanCell(sm[1]);
    if (t && nameLike(t) && !peopleRoleFamily(t)) cands.push(t);
  }
  if (cands.length > 0) {
    return new Set(cands.map((c) => c.toLocaleLowerCase())).size === 1 ? cands[0] : null;
  }
  const nameElRe = /<(span|div|p|h[1-6])\b[^>]*class\s*=\s*"([^"]*\bname\b[^"]*)"[^>]*>([\s\S]*?)<\/\1>/i;
  const nel = nameElRe.exec(inner);
  if (nel) {
    const t = cleanCell(nel[3]);
    if (t && nameLike(t) && !peopleRoleFamily(t)) return t;
  }
  return null;
}

/** Parse name+role pairs out of an HTML block belonging to a leadership section. */
/** Exported for fixtures: pure per-block name/role picking, deduped by name. */
export function pickPeopleFromBlock(blockHtml: string, blockRole: PeopleCapability | null): PersonPick[] {
  // Navigation/footer subtrees are removed first, so no pass below can read a
  // person out of a menu, a footer widget or a role="navigation" region.
  blockHtml = stripNavigation(blockHtml);
  const picks: PersonPick[] = [];

  // Enclosure ranges (table rows / list items / cards) whose children must not
  // be re-reported by the bold-run pass.
  const enclosed: Array<[number, number]> = [];
  const liRe0 = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liM0: RegExpExecArray | null;
  while ((liM0 = liRe0.exec(blockHtml)) !== null) enclosed.push([liM0.index, liRe0.lastIndex]);
  const tdRe0 = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let tdM0: RegExpExecArray | null;
  while ((tdM0 = tdRe0.exec(blockHtml)) !== null) enclosed.push([tdM0.index, tdRe0.lastIndex]);
  const cardRanges = findCardRanges(blockHtml);
  for (const c of cardRanges) enclosed.push([c.start, c.end]);
  const inEnclosure = (pos: number): boolean => enclosed.some(([a, b]) => pos > a && pos < b);

  // (0) PAGE-BUILDER container roster: a repeated structural container that
  // holds a heading-style name plus a sibling heading/span role. Generic
  // relationships only - see pickContainerRoster.
  picks.push(...pickContainerRoster(blockHtml));

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
    const roleCell = cells.find((c) => peopleRoleFamily(c) !== null);
    const role = (roleCell && peopleRoleFamily(roleCell)) || blockRole;
    if (role === null) continue;
    const nameCells = cells.filter((c) => c !== roleCell && nameLike(c));
    for (const name of nameCells) picks.push({ name, role: role, confidence: 0.6, roleExplicit: roleCell !== undefined });
  }

  // (1.5) CARDS — self-contained profile blocks (class-hinted card / profile /
  // member / team containers with a single name run).
  for (const card of cardRanges) {
    const name = pickCardName(card.html);
    if (!name || !nameLike(name)) continue;
    const role = peopleRoleFamily(cleanCell(card.html)) ?? blockRole;
    if (role === null) continue;
    picks.push({ name, role, confidence: 0.55, roleExplicit: peopleRoleFamily(cleanCell(card.html)) !== null });
  }

  // (2) bold/strong runs OUTSIDE tables and list items → structured name runs.
  const richRe = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  let rich: RegExpExecArray | null;
  while ((rich = richRe.exec(blockHtml)) !== null) {
    if (inEnclosure(rich.index)) continue;
    const frag = rich[1];
    const t = cleanCell(frag);
    if (nameLike(t) && peopleRoleFamily(t) === null) {
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
        picks.push({ name: namePart, role: peopleRoleFamily(t) ?? blockRole ?? "PEOPLE_BOARD", confidence: 0.5, roleExplicit: peopleRoleFamily(t) !== null });
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
    picks.push({ name: m[1].trim(), role: peopleRoleFamily(text) ?? blockRole ?? "PEOPLE_BOARD", confidence: 0.4 });
  }

  // Dedupe by PERSON (not by name+role): a person listed twice on one page must
  // yield ONE claim, otherwise a single page would manufacture a role
  // self-conflict. An explicit role from the item itself beats a role merely
  // inherited from the section heading; confidence breaks the remaining ties.
  const seen = new Map<string, PersonPick>();
  for (const p of picks) {
    const key = p.name.toLocaleLowerCase().replace(/\s+/g, " ").trim();
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, p);
      continue;
    }
    if ((p.roleExplicit && !prev.roleExplicit) || (Boolean(p.roleExplicit) === Boolean(prev.roleExplicit) && p.confidence > prev.confidence)) {
      seen.set(key, p);
    }
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

    // Slice the document into blocks between consecutive headings. A section
    // extends until the next heading of the SAME OR HIGHER level (HTML outline
    // semantics), so card layouts whose names sit in their own <h4> stay inside
    // the surrounding <h2> leadership section instead of being cut away.
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
      let blockEnd = text.length;
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= h.level) {
          blockEnd = headings[j].start;
          break;
        }
      }
      const blockHtml = stripNavigation(text.slice(blockStart, blockEnd));
      const blockRole = peopleRoleFamily(h.text);
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

// ---------------------------------------------------------------------------
// JSON people extraction (people-json-v1) — people ROOTED shape for Data-API
// routes. Same AI-off, deterministic rules as the HTML parser: a name-like
// value plus an optional role family; role-keyed containers (chairman / board /
// ceo / directors) set the role for everything inside them. confidence 0.60
// when a role is explicit, 0.55 when inherited from a role-keyed container.
// ---------------------------------------------------------------------------

const JSON_NAME_KEYS = ["name", "fullName", "full_name", "nameEn", "name_en", "personName", "person_name", "memberName", "member_name"];
const JSON_ROLE_KEYS = ["designation", "designation_en", "position", "positionName", "position_name", "role", "post", "title"];

function jsonPickString(node: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = node[k];
    if (typeof v === "string" && v.trim().length > 0) return cleanCell(v);
  }
  return null;
}

function personFromJsonValue(node: unknown, inheritedRole: PeopleCapability | null): PersonPick | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  const name = jsonPickString(rec, JSON_NAME_KEYS);
  if (!name || !nameLike(name)) return null;
  const explicit = peopleRoleFamily(jsonPickString(rec, JSON_ROLE_KEYS) ?? "");
  const role = explicit ?? inheritedRole ?? "PEOPLE_BOARD";
  return { name, role, confidence: explicit ? 0.6 : 0.55 };
}

/**
 * Deterministic JSON people extractor (AI OFF). Walks a JSON payload
 * recursively: role-keyed entries label their children ("chairman": {...},
 * "board": [...]); otherwise each value that looks like a person record
 * (has a name field) becomes one pick. parserId PEOPLE_JSON_PARSER_ID.
 */
export function extractPeopleJson(payload: unknown, sourceUrl: string, extractedAt?: string): ExtractedEvidence[] {
  const now = extractedAt ?? new Date().toISOString();
  const picks: PersonPick[] = [];
  const walk = (node: unknown, inheritedRole: PeopleCapability | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inheritedRole);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const asPerson = personFromJsonValue(rec, inheritedRole);
    if (asPerson) picks.push(asPerson);
    for (const [k, v] of Object.entries(rec)) {
      const fam = peopleRoleFamily(k);
      if (fam !== null && typeof v === "string" && nameLike(v)) {
        picks.push({ name: v.trim(), role: fam, confidence: 0.55 });
      } else if (v !== null && typeof v === "object") {
        walk(v, fam ?? inheritedRole);
      }
    }
  };
  walk(payload, null);

  const seen = new Map<string, PersonPick>();
  for (const p of picks) {
    const key = `${p.role}|${p.name.toLocaleLowerCase().replace(/\s+/g, " ")}`;
    const prev = seen.get(key);
    if (!prev || p.confidence > prev.confidence) seen.set(key, p);
  }

  const out: ExtractedEvidence[] = [];
  for (const p of seen.values()) {
    out.push({
      kind: "FIELD",
      capability: "PEOPLE",
      field: p.role,
      sourceUrl,
      text: p.name,
      confidence: p.confidence,
      parserId: PEOPLE_JSON_PARSER_ID,
      extractedAt: now,
    });
  }
  return out;
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