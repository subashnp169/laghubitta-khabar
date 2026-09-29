// Deterministic page-SHAPE signals for the M3.4 branch work.
//
// PURE MODULE: no I/O, no network, no database, no product behaviour. It exists so
// the shape taxonomy has exactly one definition shared by the shape inventory and
// the branch URL discovery script, instead of two copies drifting apart.
//
// The governing rule, carried over from M3.3: a CAPABILITY is not CONTENT. A page
// labelled BRANCH_DIRECTORY is not assumed to contain branch records, and a page
// that cannot actually be read is never recorded as a negative finding.

import { nameLike, STAFF_DIRECTORY_MIN_ENTRIES, stripNavigation } from "./people";

/**
 * Generic branch vocabulary, English + Nepali. LEXICAL SIGNAL ONLY - never
 * sufficient to assert a record on its own.
 */
export const BRANCH_VOCAB =
  /\b(?:branch(?:es)?|branch\s+office|sub-?office|field\s+office|regional\s+office|unit|outlet|network|locator|list\s+of\s+branches|contact\s+us|address|à¤¶à¤¾à¤–à¤¾|à¤¶à¤¾à¤–à¤¾à¤¹à¤°à¥‚|à¤•à¤¾à¤°à¥à¤¯à¤¾à¤²à¤¯|à¤‰à¤ªà¤¶à¤¾à¤–à¤¾|à¤•à¥à¤·à¥‡à¤¤à¥à¤°à¥€à¤¯|à¤œà¤¿à¤²à¥à¤²à¤¾|à¤ªà¥à¤°à¤¦à¥‡à¤¶|à¤¨à¤•à¥à¤¸à¤¾|à¤¨à¤œà¤¿à¤•|à¤ à¥‡à¤—à¤¾à¤¨à¤¾|à¤¸à¤®à¥à¤ªà¤°à¥à¤•|à¤¸à¥‚à¤šà¥€)\b/iu;

/** A locator usually needs script to render its rows. These are the tell-tales. */
export const LOCATOR_MARKERS =
  /(?:<select\b|id=["'][^"']*(?:district|province|branch|jilla|province)[^"']*["']|<option\b|leaflet|google\.maps|mapbox|lat(?:itude)?\s*[:=]|lng|longitude|find\s+(?:nearest|nearby)|near\s+me|district\s*(?:filter|select)|select\s+(?:district|province))/iu;

const PHONE_RE = /(?:\+?\d[\d\s\-()]{7,}\d)/u;

const ADDRESS_RE =
  /(?:p\.?\s*o\.?\s*box|post\s*office|street|road|ward|à¤ªà¥‹à¤¸à¥à¤Ÿ|à¤ªà¥‹\.?à¤¸à¤Ÿ|à¤ª\s*o\.?\s*à¤¬à¤•à¥à¤¸)/iu;

/** District / province names, English + Nepali. Coverage signal only. */
export const DISTRICT_RE =
  /\b(?:Kathmandu|Lalitpur|Bhaktapur|Pokhara|Biratnagar|Bharatpur|Butwal|Chitwan|Baneshwor|Dhangadhi|Nepalgunj|Birgunj|Janakpur|Hetauda|Dharan|Bardibas|Gorkha|Lamjung|Tansen|Baglung|Myagdi|Salyan|Dang|Khotang|Saptari|Siraha|Sarlahi|Dhanusha|Morang|Jhapa|Udayapur|Sunsari|Ilam|Panchthar|Taplejung|Sindhuli|Makwanpur|Ramechhap|Sindhu|Barshaot|Salyan|Pyuthan|Rolpa|Rukum|Jajarkot|Dolpa|Mustang|Humla|Mugu|Sankhuwasabha|Solukhumbu|Kailali|Kanchanpur|Baitadi|Bajhang|Dadeldhura|Darchula|Kathmandu|à¤²à¤¾à¤—à¤¹à¥à¤|à¤­à¤•à¥à¤•à¤²|à¤•à¤¾à¤ à¤®à¤¾à¤¡à¥Œà¤|à¤­à¤•à¥à¤¤à¤ªà¥à¤°|à¤²à¤²à¤¿à¤¤à¤ªà¥à¤°|à¤ªà¥‹à¤–à¤°à¤¾|à¤µà¤¿à¤°à¤¾à¤Ÿà¤¨à¤—à¤°|à¤­à¤°à¤¤à¤ªà¥à¤°|à¤¬à¥à¤Ÿà¤µà¤²|à¤šà¤¿à¤¤à¤µà¤¨|à¤§à¤¨à¤•à¥à¤Ÿà¤¾|à¤¨à¥ˆà¤ªà¤¾à¤²à¤—à¤žà¥à¤œ|à¤µà¤¿à¤°à¤—à¤¨à¥à¤œ|à¤œà¤¨à¤•à¤ªà¥à¤°|à¤¹à¥‡à¤Ÿà¥Œà¤‚à¤¡à¤¾|à¤§à¤¾à¤°à¤¾à¤¨à¤¾|à¤¬à¤°à¥à¤¦à¤¿à¤¯à¤¾|à¤—à¥‹à¤°à¤–à¤¾|à¤²à¤®à¤œà¥à¤™|à¤¤à¤¾à¤¨à¥‡à¤ªà¥|à¤¸à¤²à¥à¤¯à¤¾à¤¨|à¤¦à¤¾à¤™|à¤•à¥‹à¤Ÿà¤¹à¤¾à¤¡|à¤¸à¤ªà¥à¤¤à¤°à¥€|à¤¸à¤¿à¤°à¤¾à¤¹à¤¾|à¤¸à¤°à¥à¤²à¤¾à¤¹à¥€|à¤§à¤¨à¥à¤·à¤¾|à¤®à¥‹à¤°à¤™|à¤à¤¾à¤ªà¤¾|à¤‰à¤¦à¤¯à¤ªà¥à¤°|à¤¸à¥à¤¨à¤¸à¤°à¥€|à¤‡à¤²à¤¾à¤®|à¤ªà¤žà¥à¤šà¤¥à¤¾à¤°|à¤¤à¤¾à¤ªà¥à¤²à¥‡à¤œà¥à¤™|à¤¸à¤¿à¤¨à¥à¤§à¥à¤²à¥€|à¤®à¤•à¤µà¤¾à¤¨à¤ªà¥à¤°|à¤°à¤¾à¤®à¥‡à¤›à¤¾à¤¨à¤¾|à¤¸à¤¿à¤¨à¥à¤§à¥|à¤¬à¤°à¥à¤¸à¥Œà¤¤|à¤…à¤°à¥à¤§à¤¾à¤šà¤¾à¤à¤šà¥€|à¤°à¥à¤ªà¤¾à¤¨à¥à¤¦à¥‡à¤¹à¥€|à¤¸à¥à¤°à¥à¤–à¥‡à¤¤|à¤•à¥ˆà¤²à¤¾à¤²à¥€|à¤¬à¤¾à¤œà¥à¤°à¤¾|à¤¡à¤¡à¥‡à¤²à¥à¤§à¥à¤°à¤¾|à¤¦à¤¾à¤°à¥à¤šà¥à¤²à¤¾|à¤¬à¥ˆà¤¤à¤¡à¥€|à¤•à¤žà¥à¤šà¤¨à¤ªà¥à¤°)\b/iu;

/** Strip tags/scripts and collapse whitespace, for counting only. */
export function textOf(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countMatches(hay: string, re: RegExp): number {
  const m = hay.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`));
  return m ? m.length : 0;
}

export type Shape =
  | "FETCH_FAILED"
  | "UNRESOLVED_REDIRECT"
  | "NOT_A_BRANCH_PAGE"
  | "STAFF_LISTING"
  | "SINGLE_LOCATION_CONTACT"
  | "BRANCH_LOCATOR_UNRENDERED"
  | "BRANCH_DIRECTORY_TABLE"
  | "BRANCH_REPEATED_BLOCKS"
  | "BRANCH_INTENT_UNCONFIRMED";

export interface Signals {
  branchVocabHits: number;
  locatorMarkers: number;
  tableCount: number;
  tableRowCount: number;
  /**
   * Table rows that individually carry address/phone/district evidence. This is
   * the structural test for a REPEATED block of locations, and it is what
   * separates a real directory from a stats table: a homepage row reading
   * "Number of Branch Office | 5" has branch vocabulary but NO address, phone or
   * district, so it scores 0 here.
   */
  branchRows: number;
  phoneHits: number;
  addressHits: number;
  districtHits: number;
  /**
   * Structural units passing nameLike(). DIAGNOSTIC ONLY - never a classifier
   * input. M3.3 is explicit that nameLike() is necessary but never sufficient,
   * and measurement showed these are overwhelmingly mega-menu items
   * ("Corporate Governance", "Surakshyan Bachat"), not people.
   */
  nameLikeUnits: number;
  bodyTextLength: number;
}

/** Structural units worth testing as person-name candidates. */
export function candidateUnits(html: string): string[] {
  const out: string[] = [];
  const push = (re: RegExp): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) out.push(textOf(m[1]));
  };
  push(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi);
  push(/<li\b[^>]*>([\s\S]*?)<\/li>/gi);
  push(/<p\b[^>]*>([\s\S]*?)<\/p>/gi);
  push(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Count table rows whose own text carries address/phone/district evidence. */
export function countBranchRows(body: string): number {
  let hits = 0;
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const rowText = textOf(m[1]);
    if (!rowText) continue;
    if (ADDRESS_RE.test(rowText) || PHONE_RE.test(rowText) || DISTRICT_RE.test(rowText)) hits++;
  }
  return hits;
}

export function signalsOf(html: string): Signals {
  const body = stripNavigation(html);
  const text = textOf(body);
  return {
    branchVocabHits: countMatches(text, BRANCH_VOCAB),
    locatorMarkers: countMatches(body, LOCATOR_MARKERS),
    tableCount: countMatches(body, /<table\b/iu),
    tableRowCount: countMatches(body, /<tr\b/iu),
    branchRows: countBranchRows(body),
    phoneHits: countMatches(text, PHONE_RE),
    addressHits: countMatches(text, ADDRESS_RE),
    districtHits: countMatches(text, DISTRICT_RE),
    nameLikeUnits: candidateUnits(body).filter((u) => nameLike(u)).length,
    bodyTextLength: text.length,
  };
}

// ---------------------------------------------------------------------------
// M3.4 Phase 4 â€” objective structural evidence.
//
// These are measurements of the HTML itself, with no parser output mixed in.
// The inventory report prints them in their own section so a reader can never
// mistake "the parser read 212 names" for "the page is a 212-row record table".
// ---------------------------------------------------------------------------

export interface StructuralEvidence {
  /** record-ish <table> elements and how many carry branch-like rows */
  tableCount: number;
  recordTableCount: number;
  /** <tr> elements that individually carry address/phone/district evidence */
  branchRowCount: number;
  /** h1..h6 elements, and how many look like a branch name */
  headingCount: number;
  branchHeadingCount: number;
  /** repeated content blocks (div/li/article/section) that each carry a phone */
  containerCount: number;
  phoneBlocks: number;
  /** <br>-separated groups inside a single cell */
  brGroupCount: number;
  /** anchor hrefs to a known mapping provider */
  mapLinkCount: number;
  emailCount: number;
  phoneCount: number;
  addressCount: number;
  /** visible text length after navigation is stripped */
  visibleTextLength: number;
  /** script/noscript markers that indicate client-side rendering */
  scriptCount: number;
  noscriptCount: number;
  jsRenderedIndicators: number;
  /** the page's own <title> */
  title: string;
}

const MAP_LINK_RE =
  /href\s*=\s*["'][^"']*(?:google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap|osm\.org|bing\.com\/maps|mapquest|here\.com\/maps|wikimapia|mapy\.cz)[^"']*["']/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BRANCH_HEADING_RE = BRANCH_VOCAB;
const JS_INDICATOR_RE =
  /<noscript\b|enable\s+javascript|please\s+enable|document\.getElementById\(\s*["'](?:root|app|__next|__nuxt)["']|id\s*=\s*["'](?:root|app|__next)["']/gi;

/** A container element that carries a phone number is the generic signature of a
 *  repeated branch card. Deliberately class-agnostic. */
function countPhoneBlocks(body: string): { containerCount: number; phoneBlocks: number } {
  const re = /<(div|li|article|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let containers = 0;
  let withPhone = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // only leaf-ish blocks: a block containing another block is a container
    if (/<(div|li|article|section)\b/i.test(m[2])) continue;
    containers++;
    if (PHONE_RE.test(textOf(m[2]))) withPhone++;
  }
  return { containerCount: containers, phoneBlocks: withPhone };
}

/** <br>-separated record groups: a cell with >=2 <br> and a branch marker. */
function countBrGroups(body: string): number {
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let groups = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    if ((inner.match(/<br\s*\/?\s*>/gi) ?? []).length < 2) continue;
    if (BRANCH_VOCAB.test(textOf(inner))) groups++;
  }
  return groups;
}

export function structuralEvidence(html: string): StructuralEvidence {
  const body = stripNavigation(html);
  const text = textOf(body);
  const blocks = countPhoneBlocks(body);
  let branchHeadings = 0;
  const hre = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  let headings = 0;
  while ((m = hre.exec(body)) !== null) {
    const t = textOf(m[2]);
    if (!t) continue;
    headings++;
    if (BRANCH_HEADING_RE.test(t)) branchHeadings++;
  }
  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    tableCount: countMatches(body, /<table\b/iu),
    recordTableCount: countBranchRows(body) > 0 ? countMatches(body, /<table\b/iu) : 0,
    branchRowCount: countBranchRows(body),
    headingCount: headings,
    branchHeadingCount: branchHeadings,
    containerCount: blocks.containerCount,
    phoneBlocks: blocks.phoneBlocks,
    brGroupCount: countBrGroups(body),
    mapLinkCount: countMatches(body, MAP_LINK_RE),
    emailCount: countMatches(text, EMAIL_RE),
    phoneCount: countMatches(text, PHONE_RE),
    addressCount: countMatches(text, ADDRESS_RE),
    visibleTextLength: text.length,
    scriptCount: countMatches(body, /<script\b/giu),
    noscriptCount: countMatches(body, /<noscript\b/giu),
    jsRenderedIndicators: countMatches(body, JS_INDICATOR_RE),
    title: titleM ? textOf(titleM[1]).slice(0, 160) : "",
  };
}

/** Densities are per 1k visible characters, so a big page cannot look
 *  "record-dense" purely by having more text. */
export function structuralDensities(s: StructuralEvidence): {
  phonePer1k: number;
  emailPer1k: number;
  addressPer1k: number;
  brGroupsPer1k: number;
} {
  const k = Math.max(1, s.visibleTextLength) / 1000;
  const r = (n: number): number => Math.round((n / k) * 100) / 100;
  return {
    phonePer1k: r(s.phoneCount),
    emailPer1k: r(s.emailCount),
    addressPer1k: r(s.addressCount),
    brGroupsPer1k: r(s.brGroupCount),
  };
}

/**
 * A page whose body we never received is NOT a negative finding. Callers must
 * not record "not a branch page" for a fetch that produced no readable body.
 */
export function isUnreadable(httpStatus: number | null, bodyBytes: number): boolean {
  if (bodyBytes === 0) return true;
  return httpStatus !== null && httpStatus >= 300 && httpStatus < 400;
}

/**
 * Classify the SHAPE of a page. Ordered, deterministic, count-based.
 *
 * `roleBearingPeople` is the count of peopleExtractor FIELD items, i.e. a name
 * WITH a role read from the page. Bare name-shaped strings never promote a page
 * to STAFF_LISTING.
 */
export function classifyShape(s: Signals, dryRunBranchNames: number, roleBearingPeople: number): Shape {
  // A page that is really a people roster is never a branch directory.
  if (roleBearingPeople >= STAFF_DIRECTORY_MIN_ENTRIES) return "STAFF_LISTING";
    // A page the parser can actually read. NOT a claim that the page uses a
    // record table: as of M3.4 branch-html-v1 also reads heading-delimited card
    // grids and <br>-delimited cells. Use classifyShape(s, 0, people) for the
    // structural shape when the distinction matters.
    if (dryRunBranchNames >= 2) return "BRANCH_DIRECTORY_TABLE";
  // Branch intent, but the rows need script to exist.
  if (s.branchVocabHits > 0 && s.locatorMarkers > 0) return "BRANCH_LOCATOR_UNRENDERED";
  // Repeated address/phone blocks without a table (card grid, definition list).
  if (s.branchVocabHits > 0 && s.phoneHits >= 2 && s.addressHits >= 1) return "BRANCH_REPEATED_BLOCKS";
  // One location block and nothing directory-like: a contact page.
  if (s.branchVocabHits > 0 && s.phoneHits >= 1) return "SINGLE_LOCATION_CONTACT";
  if (s.branchVocabHits > 0) return "BRANCH_INTENT_UNCONFIRMED";
  return "NOT_A_BRANCH_PAGE";
}

// ---------------------------------------------------------------------------
// M3.4 Phase 4 ï¿½ coverage classification.
//
// Deliberately NOT named "shape". A shape is what the HTML is; a coverage class
// is what our pipeline achieves on it. Keeping them apart stops a parser result
// from being read back as a structural finding.
//
// The inputs are only measurements (counts), so the class is a pure function of
// the report and is reproducible byte-for-byte from the same inputs.
// ---------------------------------------------------------------------------

export type BranchCoverage =
  | "UNREADABLE_BODY"
  | "NOT_A_BRANCH_PAGE"
  | "BRANCH_LOCATOR_UNRENDERED"
  | "VERIFIED_BRANCH_DIRECTORY"
  | "PARTIAL_BRANCH_DIRECTORY"
  | "BRANCH_STRUCTURE_UNREAD"
  | "SINGLE_LOCATION_CONTACT"
  | "BRANCH_INTENT_NO_STRUCTURE";

/** The structural test, before any parser is involved. */
export type StructureKind =
  | "record_table"
  | "branch_headings"
  | "br_groups"
  | "phone_cards"
  | "single_block"
  | "none";

export interface CoverageInput {
  structural: StructuralEvidence;
  densities: ReturnType<typeof structuralDensities>;
  /** `isAssertableBranchName`-passing names from the dry run. */
  validNames: number;
  /** rows the parser produced before the value gate. */
  candidateRecords: number;
  /** rows the value gate refused. */
  rejectedNames: number;
  branchVocabHits: number;
  /** peopleExtractor FIELD items, i.e. names read with a role. */
  roleBearingPeople: number;
  httpStatus: number | null;
  bodyBytes: number;
}

export interface CoverageVerdict {
  coverage: BranchCoverage;
  structureKind: StructureKind;
  /** how many separate location records the structure itself shows */
  structuralRecords: number;
  reason: string;
  /** largest structural estimate, when the page presents records more than one way */
  structuralRecordsMax: number;
}

/** Ordered structural test lives inside classifyCoverage; the row count itself
 *  is part of StructuralEvidence so the report can print it. */

/** Branch talk at navigation scale rather than directory scale. A site whose
 *  header or footer links to its branch page says the word a handful of times; a
 *  page that enumerates offices says it dozens of times (measured: single-location
 *  pages 1-5 mentions, unread directory slbsl 99). */
const SINGLE_LOCATION_MAX_BRANCH_MENTIONS = 12;

/** A page with no record structure and no assertable name that still carries the
 *  contact details of exactly one place is a single-location contact page, not an
 *  unreadable directory. The test is "how many places does this page give
 *  coordinates or a phone number for", not "does it contain the word branch": a
 *  navigation link to a branch directory must not make a contact page look like a
 *  directory we failed to read. Only reachable when nothing was parsed, so it can
 *  never override a directory that was actually read. */
function isSingleLocationContact(i: CoverageInput): boolean {
  const s = i.structural;
  return i.branchVocabHits <= SINGLE_LOCATION_MAX_BRANCH_MENTIONS
    && s.addressCount + s.phoneCount + s.emailCount >= 1;
}

/** Single return point: the class, the structure that produced it, and the
 *  record count it was measured against. */
export function classifyCoverage(i: CoverageInput): CoverageVerdict {
  const s = i.structural;
  const done = (coverage: BranchCoverage, structureKind: StructureKind, structuralRecords: number, reason: string, structuralRecordsMax = 0): CoverageVerdict =>
    ({ coverage, structureKind, structuralRecords, reason, structuralRecordsMax });

  if (isUnreadable(i.httpStatus, i.bodyBytes)) {
    return done("UNREADABLE_BODY", "none", 0, `http=${i.httpStatus} bytes=${i.bodyBytes}`);
  }
  // A client-rendered shell must NEVER produce a negative class. A 200 response
  // whose visible text is only the language switcher is not a page without
  // branches; it is a page whose rows need script to exist. Recording it as
  // NOT_A_BRANCH_PAGE would be a false negative that wrongly justifies dropping
  // the target, so it is tested before the vocabulary and roster tests.
  if (s.visibleTextLength < 200 && (s.jsRenderedIndicators > 0 || s.scriptCount >= 3)) {
    return done("BRANCH_LOCATOR_UNRENDERED", "none", 0,
      `client-rendered shell: text=${s.visibleTextLength} scripts=${s.scriptCount} noscript=${s.noscriptCount} jsMarkers=${s.jsRenderedIndicators}`);
  }
  if (i.roleBearingPeople >= STAFF_DIRECTORY_MIN_ENTRIES) {
    return done("NOT_A_BRANCH_PAGE", "none", 0, `people roster: ${i.roleBearingPeople} role-bearing names`);
  }
  if (i.branchVocabHits === 0) {
    return done("NOT_A_BRANCH_PAGE", "none", 0, "no branch vocabulary in visible text");
  }

  // Structural tests. A page can present the same records several ways at once:
  // a table row per field group, one heading per branch, <br> groups inside a
  // cell. Each estimate is only an UPPER bound on how many branches exist,
  // because layouts inflate them (mslbsl: 115 table rows but 65 headings for 63
  // branches; aarambha: 134 rows but 269 headings for 132 branches).
  //
  // The smallest applicable estimate is the record count, because a page cannot
  // list fewer branches than its own most compact enumeration shows. The largest
  // is carried alongside: a wide spread is evidence that the layout interleaves
  // fields across rows, not that records are missing.
  const estimates: Array<{ kind: StructureKind; records: number }> = [];
  if (s.tableCount > 0 && s.recordTableCount > 0) estimates.push({ kind: "record_table", records: s.branchRowCount });
  if (s.branchHeadingCount >= 2) estimates.push({ kind: "branch_headings", records: s.branchHeadingCount });
  if (s.brGroupCount > 0) estimates.push({ kind: "br_groups", records: s.brGroupCount });
  if (s.phoneBlocks >= 2) estimates.push({ kind: "phone_cards", records: s.phoneBlocks });

  let kind: StructureKind = "none";
  let records = 0;
  let recordsMax = 0;
  if (estimates.length > 0) {
    const sorted = [...estimates].sort((a, b) => a.records - b.records);
    kind = sorted[0].kind;
    records = sorted[0].records;
    recordsMax = sorted[sorted.length - 1].records;
  } else if (s.phoneBlocks === 1) {
    kind = "single_block";
    records = 1;
    recordsMax = 1;
  }

  if (kind === "single_block") {
    if (i.validNames >= 1) return done("SINGLE_LOCATION_CONTACT", kind, 1, "one location block");
    if (isSingleLocationContact(i)) return done("SINGLE_LOCATION_CONTACT", kind, 1, "one location block, one contact location");
    return done("BRANCH_INTENT_NO_STRUCTURE", kind, 1, "one location block, no assertable name");
  }
  if (kind === "none") {
    // The parser read a name but the structure shows no repeated records: a single
    // location at best, never a directory.
    if (i.validNames >= 1) {
      return done("SINGLE_LOCATION_CONTACT", kind, 0, `${i.validNames} assertable name(s), no repeated record structure`);
    }
    if (s.visibleTextLength < 400 && (s.jsRenderedIndicators > 0 || s.mapLinkCount > 0)) {
      return done("BRANCH_LOCATOR_UNRENDERED", kind, 0, `map=${s.mapLinkCount} js=${s.jsRenderedIndicators} text=${s.visibleTextLength}`);
    }
    if (isSingleLocationContact(i)) {
      return done("SINGLE_LOCATION_CONTACT", kind, 0, "contact details for one place, no location records");
    }
    return done("BRANCH_INTENT_NO_STRUCTURE", kind, 0, "branch vocabulary without location records");
  }

  // A real record structure exists. Only now does the parser result decide.
  if (i.validNames === 0) {
    return done("BRANCH_STRUCTURE_UNREAD", kind, records, `${records} ${kind} record(s) in HTML, 0 assertable names`, recordsMax);
  }
  if (i.validNames < 2) {
    // "Few assertable names" is only evidence of a single location when the page
    // actually shows a single location. A 142-row table where 1 name survives the
    // value gate is a directory that is mostly being refused, not one office: the
    // structural count is the floor on how many branches the page lists, and 142
    // is nowhere near a single contact block.
    if (records <= 2) return done("SINGLE_LOCATION_CONTACT", kind, records, `1 of ${records} ${kind} record(s) assertable`, recordsMax);
    return done("PARTIAL_BRANCH_DIRECTORY", kind, records, `1 of ${records} ${kind} record(s) assertable`, recordsMax);
  }
  if (records > 0 && i.validNames < Math.max(2, Math.ceil(records * 0.6))) {
    return done("PARTIAL_BRANCH_DIRECTORY", kind, records,
      `${i.validNames} assertable of ${records} ${kind} record(s) (${i.rejectedNames} refused)`, recordsMax);
  }
  return done("VERIFIED_BRANCH_DIRECTORY", kind, records,
    `${i.validNames} assertable names from ${records} ${kind} record(s)`, recordsMax);
}
