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
// v2 (M3.3-EXT-C): non-person token filter, no invented roles, no block-role borrowing,
// designation-decisive staff-directory suppression. v1 evidence must not be compared to v2.
export const PEOPLE_PARSER_ID = "people-html-v2";
export const PEOPLE_JSON_PARSER_ID = "people-json-v2";

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

/**
 * EXT-C1 - cells that are structurally NOT a designation: a serial number, a
 * date, a bare marker or a placeholder. Used so a name-only board table (which
 * legitimately has no designation column) is not mistaken for a staff listing.
 */
const NON_DESIGNATION_CELLS = new Set([
  "na", "n/a", "none", "nil", "-", "--", "yes", "no", "y", "n", "sr", "sno", "sn",
  "sl", "slno", "serial", "serial no", "date", "remarks", "remark", "photo", "image",
]);
function looksLikeDesignation(cell: string): boolean {
  const t = cell.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (NON_DESIGNATION_CELLS.has(t.toLocaleLowerCase())) return false;
  if (/\d/.test(t) && !/\p{L}{2,}/u.test(t)) return false; // "1", "12", "2024"
  return /\p{L}{2,}/u.test(t);
}

/** Words that make a fragment a sentence rather than a designation. */
const SENTENCE_MARKERS = new RegExp(
  "\\b(he|she|it|they|we|his|her|their|our|its|was|is|are|were|been|has|have|had|will|would|can|could|may|might|must|" +
  "leads?|manages|oversees|heads|works|serves|acts|joined|appointed|elected|named|retired|resigned|since|from|who|which|" +
  "that|and|but|because|after|before|while|when|during)\\b",
  "i",
);

/**
 * EXT-C1 - free text after "Name -" / "Name:" is treated as a stated role when
 * it reads like a designation: a short noun phrase, not a clause. Without this
 * guard a prose line such as "Kiran Thapa Magar - he joined the board in 2019"
 * would be read as a designation, which is the invented-role error EXT-C1
 * exists to remove. Erring toward false is safe: a missed designation costs one
 * person's assertion, while an invented one publishes a role nobody stated.
 */
function roleLooksLikeRole(text: string): boolean {
  const t = text.trim();
  if (!looksLikeDesignation(t)) return false;
  if (/[.,;:!?]/.test(t)) return false;
  if (SENTENCE_MARKERS.test(t)) return false;
  return t.split(/\s+/).length <= 5;
}

const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "er", "prof", "shri", "श्री", "श्रीमती", "डा", "इ", "प्रा"]);

/**
 * EXT-C1 - generic non-person vocabulary.
 *
 * A person name is a short run of NAME tokens. When a candidate carries a token
 * from any of these classes it is describing something that is not a person: a
 * legal form, an organisation, an internal unit, a job title, a document title
 * or a piece of site furniture. Such a candidate is rejected no matter how it
 * is capitalised, how many tokens it has, or which element it was read from.
 *
 * These are CLASSES OF WORDS. Nothing here names a bank, a ministry, an
 * institution, a person or a URL, so the rule is institution-agnostic: it
 * generalises to any page because it describes the shape of the words, not the
 * site they were read from. Missing a real person is the cheap error; publishing
 * a non-person is the expensive one, so every class below is disqualifying.
 */
const NON_PERSON_TOKENS = new Set([
  // --- collective labels: a group of people is not a person -----------------
  "team", "teams", "member", "members", "membership", "staff", "staffs", "employee",
  "employees", "personnel", "workforce", "management", "secretariat", "observer",
  "observers", "auditor", "auditors", "auditee", "audit", "audits", "admin", "administration", "staffing",
  // --- legal / commercial form -------------------------------------------
  "ltd", "limited", "pvt", "private", "inc", "incorporated", "llc", "llp", "plc",
  "corp", "corporation", "company", "co", "gte", "sarl", "ag", "bv", "holdings",
  "holding", "group", "enterprise", "enterprises", "industries", "industry",
  "technologies", "technology", "tech", "solutions", "systems", "labs",
  "consultancy", "international", "global", "worldwide", "trading", "ventures",
  // --- institutions and units of organisation -----------------------------
  "bank", "ministry", "department", "dept", "division", "section", "branch",
  "office", "authority", "commission", "committee", "council", "board",
  "institution", "institute", "foundation", "association", "federation", "union",
  "alliance", "society", "club", "university", "college", "school", "academy",
  "hospital", "cooperative", "co-operative", "savings", "credit", "finance",
  "financial", "insurance", "capital", "trust", "nagar", "palika", "pradesh",
  "sarkar", "bikas", "sanstha", "tatwar", "mahasang", "samiti", "samuh", "sangh",
  "bhandar", "nidhi", "parivar", "sadak", "marg", "kendra", "prabhandal",
  // --- job titles: a title is not a person --------------------------------
  "head", "chief", "manager", "officer", "secretary", "auditor", "accountant",
  "clerk", "staff", "employee", "employees", "personnel", "advisor", "adviser",
  "consultant", "coordinator", "co-ordinator", "supervisor", "inspector",
  "assistant", "deputy", "junior", "senior", "teller", "cashier",
  "representative", "representatives", "monitoring", "incharge", "in-charge",
  "director", "directors", "chairman", "chairperson", "president", "vice",
  "md", "ceo", "cfo", "coo", "executive", "managing", "general", "administrative",
  "coordinator", "directorate", "secretariat", "governor", "treasurer",
  // --- documents, notices and page furniture -------------------------------
  "press", "release", "news", "notice", "circular", "announcement", "bulletin",
  "report", "reports", "annual", "quarterly", "yearly", "monthly", "statement",
  "balance", "sheet", "prospectus", "agenda", "minutes", "meeting", "download",
  "downloads", "form", "forms", "application", "registration", "schedule",
  "policy", "guideline", "guidelines", "act", "rule", "rules", "regulation",
  "regulations", "about", "contact", "home", "welcome", "introduction", "vision",
  "mission", "objective", "objectives", "goal", "goals", "history", "profile",
  "overview", "message", "speech", "address", "latest", "update", "updates",
  "gallery", "photo", "photos", "video", "videos", "event", "events", "newsroom",
  "media", "pressroom", "publication", "publications", "journal", "magazine",
  "newsletter", "resource", "resources", "useful", "quick", "links", "link",
  "site", "sitemap", "map", "faq", "faqs", "job", "jobs", "career", "careers",
  "vacancy", "vacancies", "network", "atm", "product", "products", "account",
  "accounts", "deposit", "loan", "loans", "interest", "rate", "rates", "charge",
  "charges", "fee", "fees", "tariff", "calculator", "complaint", "complaints",
  "grievance", "grievances", "privacy", "terms", "disclaimer", "copyright",
  "login", "signin", "register", "subscribe", "content", "unavailable",
  "moment", "loading", "error", "page", "pages", "more", "read", "view",
  "detail", "details", "number", "total", "name", "names", "designation",
  "position", "title", "role", "remarks", "rank", "level", "grade", "status",
  // --- Devanagari: same classes, generic vocabulary -------------------------
  "विभाग", "शाखा", "कार्यालय", "समिति", "मन्त्रालय", "मंत्रालय", "बैंक",
  "निदेशक", "निर्देशक", "अध्यक्ष", "उपाध्यक्ष", "प्रबन्धक", "प्रबंधक",
  "कर्मचारी", "सहकारी", "संस्था", "समूह", "विश्वविद्यालय", "कलेज", "विद्यालय",
  "उद्योग", "प्रतिष्ठान", "सूचना", "समाचार", "प्रेस", "रिपोर्ट", "विवरण",
  "सूची", "शीर्षक", "सदस्य", "व्यवस्थापन", "व्यवस्थापक", "टोली", "टिम", "टीम",
  "सेवा", "सहयोग", "संचालक", "सञ्चालक", "सभापति", "सहायक", "अनुसन्धान",
]);

/**
 * Does a single token belong to a non-person class?
 *
 * English plurals are folded onto their singular ("officers" -> "officer",
 * "reports" -> "report") so a class is not defeated by number agreement, which
 * is what let "VIEW PROVINCE WISE GRIEVANCE OFFICERS" through as a person.
 */
function isNonPersonToken(rawToken: string): boolean {
  const t = rawToken.toLocaleLowerCase().replace(/[.'’\-]/gu, "");
  if (NON_PERSON_TOKENS.has(t)) return true;
  if (t.length > 3 && t.endsWith("s") && NON_PERSON_TOKENS.has(t.slice(0, -1))) return true;
  return false;
}

/**
 * Is a string plausibly a person's name (Devanagari names have no case)?
 *
 * EXT-C1: this is a NECESSARY shape test, never sufficient proof. A run of
 * capitalised words is not a person - "Nepal Rastra Bank", "Lopho Tech Pvt.
 * Ltd.", "Board of Directors", "Credit Department Head" and "Press Release" are
 * all perfectly shaped runs of capitalised words. Any token from a non-person
 * class disqualifies the string, so the caller still needs a role read from the
 * page before it may assert a person.
 */
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

  // One non-person token in ANY position disqualifies the string.
  const core = tokens.filter((t) => !HONORIFICS.has(t.toLocaleLowerCase()));
  if (core.length === 0) return false;
  if (core.some((t) => isNonPersonToken(t))) return false;

  const hasDevanagari = /[ऀ-ॿ]/u.test(s);
  if (hasDevanagari) {
    if (tokens.some((t) => t.length > 30)) return false;
    const coreText = core.join(" ");
    return coreText.replace(/\s+/g, "").length >= 4;
  }
  const tcs = tokens.filter((t) => HONORIFICS.has(t.toLocaleLowerCase()) || /^\p{Lu}/u.test(t));
  if (tcs.length < 2) return false;
  if (tokens.some((t) => t.length > 24)) return false;
  return true;
}

/** Resolve a text fragment to a people role family, or null. */
export function peopleRoleFamily(raw: string): PeopleCapability | null {
  const s = raw.toLowerCase();
  for (const [fam, words] of ROLE_FAMILIES) {
    if (words.some((w) => s.includes(w))) return fam;
  }
  return null;
}

// ---------------------------------------------------------------------------
// EXT-C1 - governance page vs general staff directory.
//
// A governance page names a handful of accountable people: chair, chief
// executive, directors, board. A staff directory enumerates employees or branch
// personnel. Both are "pages full of name + role", so the ONLY generic way to
// separate them is the shape of the population: a large list whose role labels
// are overwhelmingly NOT leadership titles is a directory, however
// leadership-sounding its URL or its first section heading was.
//
// No site, institution, domain or path is named here. The threshold is a
// population size, the ratio is a property of the page's own role labels.
// ---------------------------------------------------------------------------

/** Titles that denote an accountable leadership position (English + Nepali). */
const LEADERSHIP_TITLE_RE =
  /\b(?:chair(?:man|person)?|president|chief\s+executive|managing\s+director|general\s+manager|board\s+member|independent\s+director|executive\s+director|non-executive\s+director|director|ceo|cfo|coo)\b|अध्यक्ष|निर्देशक|संचालक|सञ्चालक|प्रमुख\s*कार्यकारी|महाप्रबन्धक|महाप्रबंधक/iu;

/** A page needs at least this many name+role units before it can be a directory. */
export const STAFF_DIRECTORY_MIN_ENTRIES = 12;
/** Below this share of leadership-titled entries, a large list is a directory. */
export const STAFF_DIRECTORY_MAX_LEADERSHIP_RATIO = 0.34;

/** Evidence field carrying a suppressed staff-directory entry (never asserted). */
export const PEOPLE_STAFF_DIRECTORY_FIELD = "PEOPLE_STAFF_DIRECTORY";

export type PeoplePageClass = "LEADERSHIP" | "STAFF_DIRECTORY";

/**
 * Classify a page's extracted people population.
 *
 * A pick counts as leadership when a leadership title was actually read from
 * the page (its role text matches), or when its role was inherited from a
 * leadership section heading (an inherited role is only ever produced by a real
 * leadership section, so it is trustworthy as a leadership signal even without
 * per-person role text). A pick whose explicit role text is a non-leadership
 * title is a staff entry, whatever family the enclosing heading gave it.
 */
export function classifyPeoplePage(picks: ReadonlyArray<{ role: PeopleCapability; roleText?: string }>): PeoplePageClass {
  if (picks.length < STAFF_DIRECTORY_MIN_ENTRIES) return "LEADERSHIP";
  let leadership = 0;
  for (const p of picks) {
    const read = p.roleText?.trim() ?? "";
    if (read !== "") {
      // A designation was actually read from the page. That text is decisive: a
      // staff title ("Monitoring Officer") means a staff entry even when the
      // enclosing leadership heading lent it a board/director family, and a
      // leadership title means a governance entry even under a loose family.
      if (LEADERSHIP_TITLE_RE.test(read)) leadership += 1;
      continue;
    }
    // No per-person designation: the role was inherited from a leadership
    // section heading, which only exists on a governance page.
    leadership += 1;
  }
  return leadership / picks.length < STAFF_DIRECTORY_MAX_LEADERSHIP_RATIO ? "STAFF_DIRECTORY" : "LEADERSHIP";
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

export function stripNavigation(html: string): string {
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
/**
 * "heading"        - the original heading-style scan.
 * "headingOrRoleText" - additionally treat an element as a candidate when its own
 *                       short text is a role from the existing vocabulary. Used
 *                       only by the container-roster pairing pass.
 */
type HeadingScanMode = "heading" | "headingOrRoleText";

/** Longest text still treated as a bare designation rather than prose. A card
 *  designation commonly carries its appointing body, e.g. "Director,
 *  Representative from Rastriya Banijya Bank" - long enough that a prose
 *  sentence threshold would silently drop the role. The safety burden stays on
 *  the pairing pass, which only accepts the role when the same container holds
 *  exactly one name that already passed nameLike. */
const ROLE_TEXT_MAX = 100;

function headingElements(html: string, mode: HeadingScanMode = "heading"): HeadingElement[] {
  const out: HeadingElement[] = [];
  const stack: Array<{ tag: string; start: number; contentStart: number; candidate: boolean; attrs: string }> = [];
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
      if (!opened.candidate && mode === "headingOrRoleText") {
        // A designation is very often a bare <span> with no heading/title token
        // in its class, e.g. himalayanlaghubitta.com renders
        //   <h5>Mr. Bijaya Man Nakarmi</h5><span class="text-medium">Chairman</span>
        // The name is a real heading but the role is not, so the pairing pass
        // could never see a role and the whole roster was silently dropped.
        // Rather than trust markup, trust the existing role vocabulary: an
        // element only qualifies when its own short text IS a role we already
        // recognise. This adds no new role words and invents nothing.
        const text = cleanCell(html.slice(opened.contentStart, m.index));
        opened.candidate = text.length > 0 && text.length <= ROLE_TEXT_MAX && peopleRoleFamily(text) !== null;
      }
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
      attrs,
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
  // Roles are scanned with the widened mode because a designation is frequently a
  // bare <span> carrying no heading/title token. The name side deliberately keeps
  // the strict heading scan: a name must still look like a heading-styled element,
  // so this cannot turn arbitrary body text into a person.
  const roleEls = headingElements(blockHtml, "headingOrRoleText").filter(
    (h) => h.text && peopleRoleFamily(h.text) !== null,
  );
  if (nameEls.length === 0 || roleEls.length === 0) return [];

  const nodes = containerNodes(blockHtml);
  const units: Array<{ name: string; role: PeopleCapability; roleText: string }> = [];
  for (const nameEl of nameEls) {
    // Innermost first: page builders wrap each name in its own widget <div>, so
    // the role element sits one or two levels further out. The first container
    // that holds a role wins, which keeps the pairing local to the person.
    const ancestors = nodes
      .filter((n) => n.start < nameEl.start && nameEl.end <= n.end)
      .sort((a, b) => b.start - a.start);
    let role: PeopleCapability | null = null;
    let roleText = "";
    for (const node of ancestors) {
      // A container may resolve a role for a name ONLY when it holds that one
      // name. A row/grid container that wraps ten name cards also contains a
      // neighbour's "Chief Executive Officer" span, so letting it pair everyone
      // with that single role would turn department heads into CEOs. The
      // "exactly one name" rule is what distinguishes a per-person widget from a
      // whole-list container: a named card carries its own designation, a shared
      // row does not. Distinct names are counted: a page builder often wraps a
      // name in a heading AND a heading-titled widget div, so one person appears
      // as several stack frames; those collapse to one name.
      const distinctNamesInside = new Set(
        nameEls.filter((n) => n.start >= node.start && n.end <= node.end).map((n) => n.text.toLocaleLowerCase().replace(/\s+/g, " ").trim()),
      );
      if (distinctNamesInside.size !== 1) continue;
      const hit = roleEls
        .filter((r) => r.start >= node.start && r.end <= node.end && (r.end <= nameEl.start || r.start >= nameEl.end))
        .sort(
          (a, b) =>
            Math.min(Math.abs(a.start - nameEl.end), Math.abs(nameEl.start - a.end)) -
            Math.min(Math.abs(b.start - nameEl.end), Math.abs(nameEl.start - b.end)),
        )[0];
      if (hit) {
        role = peopleRoleFamily(hit.text);
        roleText = hit.text;
        break;
      }
    }
    if (!role) continue;
    units.push({ name: nameEl.text, role, roleText });
  }

  if (units.length < 2) return [];
  return units.map((u) => ({ name: u.name, role: u.role, roleText: u.roleText, confidence: 0.55, roleExplicit: true }));
}

export function cleanCell(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

interface PersonPick {
  name: string;
  role: PeopleCapability;
  /**
   * EXT-C1: the text the role was actually read from (designation cell, card
   * text, list item, role element). Empty when the role was inherited from the
   * enclosing leadership section heading. The page classifier needs this to tell
   * an accountable leadership title from a staff title, because the capability
   * family alone is too coarse ("Monitoring Officer" inside a "Management Team"
   * section resolves to the same family as a real director).
   */
  roleText?: string;
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
    let role = (roleCell && peopleRoleFamily(roleCell)) || blockRole;
    if (role === null) continue;
    // EXT-C1: keep the designation text even when it maps to no role family. A
    // staff roster renders "Monitoring Officer" / "Field Officer", which resolve
    // to no family and would otherwise inherit the section's leadership family
    // and read as a governance page. The raw designation is what tells the two
    // apart, so it is carried through to the page classifier. Only a cell that
    // actually looks like a designation qualifies - a serial number, date or
    // "N/A" remark must not be read as a job title, or a name-only board table
    // would be mistaken for a staff listing and its real directors dropped.
    const designationCell = roleCell ?? cells.find(looksLikeDesignation);
    const nameCells = cells.filter((c) => c !== roleCell && nameLike(c));
    // EXT-C1: a designation cell that maps to no family still proves a role was
    // read from the page, so the person is kept in the generic field. Cells
    // that are not designations (serial numbers, "N/A") are ignored, which is
    // what distinguishes a name-only board table from a staff listing.
    if (role === null && designationCell !== undefined) role = "PEOPLE_BOARD";
    if (role === null) continue;
    for (const name of nameCells) picks.push({ name, role, roleText: designationCell ?? "", confidence: 0.6, roleExplicit: roleCell !== undefined });
  }

  // (1.5) CARDS — self-contained profile blocks (class-hinted card / profile /
  // member / team containers with a single name run).
  for (const card of cardRanges) {
    const name = pickCardName(card.html);
    if (!name || !nameLike(name)) continue;
    const cardText = cleanCell(card.html);
    const explicit = peopleRoleFamily(cardText);
    // EXT-C1: a card that states a designation outside our vocabulary keeps the
    // person in the generic field; a card with no role at all relies on the
    // section heading and yields nothing when the heading names no role.
    const role = explicit ?? (roleLooksLikeRole(cardText) ? "PEOPLE_BOARD" : blockRole);
    if (role === null) continue;
    picks.push({ name, role, roleText: cardText, confidence: 0.55, roleExplicit: explicit !== null });
  }

  // (2) bold/strong runs OUTSIDE tables and list items → structured name runs.
  // EXT-C1: with no role read from the item, the role must come from the
  // leadership section heading. The pass never invents PEOPLE_BOARD.
  const richRe = /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  let rich: RegExpExecArray | null;
  while ((rich = richRe.exec(blockHtml)) !== null) {
    if (inEnclosure(rich.index)) continue;
    const frag = rich[1];
    const t = cleanCell(frag);
    if (nameLike(t) && peopleRoleFamily(t) === null && blockRole !== null) {
      picks.push({ name: t, role: blockRole, roleText: "", confidence: 0.55 });
    }
  }

  // (3) list items → "Name - Role" or plain name under a leadership section.
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;
  while ((li = liRe.exec(blockHtml)) !== null) {
    const t = cleanCell(li[1]);
    const sep = /^(.*?)\s+(?:-|–|—|:)\s+(.*)$/.exec(t);
    if (sep) {
      const namePart = sep[1].trim();
      const rolePart = sep[2].trim();
      if (nameLike(namePart)) {
        const explicit = peopleRoleFamily(t);
        // EXT-C1: a designation the page states but our vocabulary does not
        // cover ("Head of Operations") is still a role that was read, so the
        // person is kept in the generic field with the exact text preserved. A
        // name with no role anywhere on the page yields nothing.
        const role = explicit ?? (roleLooksLikeRole(rolePart) ? "PEOPLE_BOARD" : blockRole);
        if (role !== null) picks.push({ name: namePart, role, roleText: explicit ? t : rolePart, confidence: 0.5, roleExplicit: explicit !== null });
      }
    } else if (nameLike(t) && blockRole !== null) {
      picks.push({ name: t, role: blockRole, roleText: "", confidence: 0.5 });
    }
  }

  // (4) free paragraph: only a direct "Name, <role>" lead — confidence 0.4 so
  // it is recorded as evidence but never becomes an assertion.
  const leadRe = /([\p{Lu}][\p{L}\p{M}.'’ -]{1,50})\s*(?:,|–|:)?\s*(?:chief|chair|director|general|अध्यक्ष|संचालक|सञ्चालक|कार्यकारी)/u;
  const textOnly = blockHtml.replace(/<(?:table|tr|t[hd]|li|strong|b)\b[\s\S]*?<\/(?:table|tr|t[hd]|li|strong|b)>/gi, " ");
  const text = cleanCell(textOnly);
  const m = leadRe.exec(text);
  if (m && nameLike(m[1].trim())) {
    // EXT-C1: resolve the role from the text AFTER the name, not from the regex
    // match. The match stops at the role keyword it keyed on ("... , general"),
    // so reading the role from it missed the stated phrase ("general manager").
    // The old code then fell back to the section heading's family, which invented
    // PEOPLE_BOARD for a heading such as "Our Team" that names no role, and
    // silently lost a real named person. A name with no role read anywhere on
    // the page yields nothing.
    const name = m[1].trim();
    const after = text.slice(m.index + m[1].length).replace(/^[\s,–:-]+/, "");
    const clause = (after.split(/[.;!?]/)[0] ?? "").trim();
    const explicit = peopleRoleFamily(after);
    const role = explicit ?? (roleLooksLikeRole(clause) ? "PEOPLE_BOARD" : blockRole);
    if (role !== null) picks.push({ name, role, roleText: explicit ? `${name}, ${clause}` : clause, confidence: 0.4 });
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

    const candidates: Pick<PersonPick, "name" | "role" | "confidence" | "roleText">[] = [];
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

    // EXT-C1 - staff-directory gate. A general employee / branch-staff listing
    // is recorded as future-candidate evidence but must NOT produce M3.3
    // leadership assertions, however leadership-sounding its URL was. The test
    // is generic: population size plus the share of entries whose role text is
    // an accountable leadership title. No site or path is named.
    const pageClass = classifyPeoplePage(candidates);
    if (pageClass === "STAFF_DIRECTORY") {
      for (const p of candidates) {
        out.push({
          kind: "TEXT",
          capability: cap,
          field: PEOPLE_STAFF_DIRECTORY_FIELD,
          sourceUrl: ctx.url,
          text: p.name,
          confidence: 0.4,
          parserId: PEOPLE_PARSER_ID,
          extractedAt: now,
        });
      }
      return out;
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
// JSON people extraction (people-json-v2) — people ROOTED shape for Data-API
// routes. Same AI-off, deterministic rules as the HTML parser: a name-like
// value plus an optional role family; role-keyed containers (chairman / board /
// ceo / directors) set the role for everything inside them. A name with no role
// anywhere is not asserted (v2 removed the bare-name PEOPLE_BOARD fallback).
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
  const roleText = jsonPickString(rec, JSON_ROLE_KEYS);
  const explicit = peopleRoleFamily(roleText ?? "");
  // EXT-C1: no invented role. A record with no designation at all and no
  // role-keyed container is not a person claim yet, so it yields nothing. A
  // record that DOES state a designation outside our vocabulary keeps the person
  // in the generic field, exactly as the HTML paths do, with the text preserved.
  const stated = roleText !== null && roleLooksLikeRole(roleText);
  const role = explicit ?? (stated ? "PEOPLE_BOARD" : inheritedRole);
  if (role === null) return null;
  return { name, role, roleText: roleText ?? "", confidence: explicit ? 0.6 : 0.55 };
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

/**
 * EXT-C1 - staff-directory validator.
 *
 * Records WHY a page produced no leadership assertions. A general employee or
 * branch-staff listing is legitimate evidence that the institution publishes
 * people data, so the outcome is recorded as a future-candidate signal rather
 * than a failure, and the entries stay visible for a later milestone instead of
 * being asserted as M3.3 leadership.
 */
export const PEOPLE_STAFF_DIRECTORY_RULE_ID = "r-people-staff-directory";

export const peopleStaffDirectoryValidator: Validator = {
  ruleId: PEOPLE_STAFF_DIRECTORY_RULE_ID,
  severity: "info",
  async validate(ctx: ValidationContext) {
    const entries = ctx.evidence.filter((e) => e.kind === "TEXT" && e.field === PEOPLE_STAFF_DIRECTORY_FIELD);
    if (entries.length === 0) {
      return {
        status: "PASS",
        severity: "info",
        ruleId: PEOPLE_STAFF_DIRECTORY_RULE_ID,
        message: "not a staff directory",
        evidence: { staffDirectoryEntries: 0 },
      };
    }
    return {
      status: "PENDING",
      severity: "info",
      ruleId: PEOPLE_STAFF_DIRECTORY_RULE_ID,
      message: `general staff directory: ${entries.length} name+role entr(ies) held as future-candidate evidence, not asserted as M3.3 leadership`,
      evidence: {
        staffDirectoryEntries: entries.length,
        sample: entries.map((e) => e.text).slice(0, 20),
      },
    };
  },
};

export const peopleValidators: ReadonlyArray<Validator> = [peopleDirectoryValidator, peopleStaffDirectoryValidator];