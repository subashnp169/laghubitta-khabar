// M3.4 Phase 5/6 — generic branch CARD record layer.
//
// This module answers one question: given a block of HTML that is structured as
// repeated peer cards, what does each card actually say? It performs NO
// plausibility judgement. It returns raw, normalized candidate text plus the
// contact evidence found in the same card, and it deliberately keeps
// `nameSource` so the caller can tell a name that came from the heading from one
// that came from the body of a card whose heading was a person.
//
// It is institution-agnostic by construction: no class names, ids, URLs or
// institution names appear anywhere below. The only site-specific knowledge that
// could sneak in is a CSS/HTML shape, so the shape tests are all semantic
// (heading vs body, label/value, mailto, tel, map href).
//
// The plausibility gate (isAssertableBranchName) and the attribute validators
// live in structured.ts and are applied by the caller, so this layer can never
// loosen them.

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Serial/bracket codes are an INDEPENDENT identifier, not part of the place name.
 * "Simara Branch (001)", "[003]-Waling Branch" and "BELBARI BRANCH- [47]" all
 * name one location each; the digits are a row counter. Stripping them is
 * normalization of a single field, NOT a loosening of the plausibility gate: the
 * gate still sees the whole cleaned string and can still refuse it.
 */
const SERIAL_CODE_RE = /[\(\[]\s*\d{1,4}\s*[\)\]]/g;
/** A code may also trail a dash, or lead one once removed ("[003]-Waling"). */
const LONE_DASH_RE = /^\s*[-–—:]\s*|\s*[-–—:]\s*$/g;

export function normalizeBranchLabel(raw: string): string {
  return raw
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(SERIAL_CODE_RE, " ")
    .replace(LONE_DASH_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Person / role discrimination
// ---------------------------------------------------------------------------

/** Explicit courtesy + role titles. Proximity alone is never used. */
const PERSON_TITLE_RE = /^(?:mr|mrs|ms|miss|dr|prof)\.?\s+/i;
/** A heading that carries a role word is a role, not a place. */
const ROLE_WORD_RE =
  /\b(?:branch\s*(?:manager|in-?charge|chief|head)|area\s*(?:manager|in-?charge)|office\s*(?:in-?charge|manager)|(?:manager|md|chairman|president|director|teller|cashier|officer|accountant|operator|supervisor|coordinator|staff|employee|receptionist)\b|शाखा\s*प्रबन्धक|प्रबन्धक|अध्यक्ष|निर्देशक)/i;
/** "RIMA TIMALSINA", "Bikash Thapa" — two or more capitalised words, no digits,
 *  no branch marker, no place punctuation. English + Devanagari. */
const PERSON_NAME_SHAPE_RE =
  /^(?:[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3})$/u;
const DEVANAGARI_NAME_RE = /^[\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){1,3}$/u;

/**
 * Web-section and organisational vocabulary. A heading built from these words is
 * a page section, a department or a nav label, never a person, even though
 * "Contact Us" and "Credit Department" are Title Case and would otherwise look
 * exactly like a personal name. Matching is whole-token, so a real name that
 * merely contains one of these words ("Usha Gurung", "Nirmala Office") is
 * unaffected.
 *
 * The error direction matters: a section word missing from this list makes a
 * section heading look like a person, which costs a record; a section word
 * wrongly listed only moves a candidate name, which the plausibility gate then
 * refuses anyway. So the list is deliberately generous.
 */
const WEB_SECTION_WORDS = new Set(
  (
    "about contact info information us our you welcome home faq help support search login register sitemap quick links " +
    "career careers job jobs employment vacancy vacancies news notice notices announcement announcements gallery " +
    "download downloads privacy policy policies terms team staff management mission vision profile history about-us " +
    "network directory department departments division divisions section sections unit units service services " +
    "products product loan loans savings remittance transfer payment media press blog event events form forms " +
    "feedback location locations branch branches office offices bank banks company ltd pvt contactus"
  ).split(" "),
);

/** Tokens that mark a Title Case heading as an organisational heading. */
function looksOrganisational(t: string): boolean {
  return t
    .toLowerCase()
    .split(/[^a-zऀ-ॿ]+/)
    .filter(Boolean)
    .some((w) => WEB_SECTION_WORDS.has(w));
}

/**
 * True when a heading names a person or a role rather than a location.
 *
 * This is the single most important predicate in the card layer. Measured on the
 * four committed email-card targets, treating every heading as a branch would
 * assert 155 person names on sampadalaghubitta and 90 on samata, because those
 * pages put the manager in a heading above the branch it belongs to.
 */
export function isPersonOrRoleHeading(raw: string): boolean {
  const t = normalizeBranchLabel(raw);
  if (t.length === 0) return false;
  if (PERSON_TITLE_RE.test(t)) return true;
  if (ROLE_WORD_RE.test(t)) return true;
  // A heading with digits or punctuation is a code or a label, not a person.
  if (/[0-9]/.test(t) || /[,.;:()[\]/]/.test(t)) return false;
  if (DEVANAGARI_NAME_RE.test(t)) return true;
  // "Contact Us" / "Credit Department" are Title Case but are not people.
  if (looksOrganisational(t)) return false;
  if (PERSON_NAME_SHAPE_RE.test(t)) {
    // "Branch Office Birtamod" is also Title Case; require that it is NOT office
    // vocabulary to call it a person.
    const words = t.toLowerCase().split(/\s+/);
    const officeish = words.some((w) =>
      /^(?:branch|office|area|regional|head|main|sub|central|principal|field|unit|province|ward|division|zonal|branch)$/.test(w),
    );
    return !officeish;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Contact evidence patterns
// ---------------------------------------------------------------------------

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
export const PHONE_SCAN_RE = /(?:\+?\d[\d\s\-/()]{6,}\d)/g;
export const MAILTO_HREF_RE = /href\s*=\s*["']\s*mailto:([^"'?]+)/gi;
export const TEL_HREF_RE = /href\s*=\s*["']\s*tel:([^"']+)/gi;
export const MAP_HREF_RE =
  /href\s*=\s*["']([^"']*(?:google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap|osm\.org\/|bing\.com\/maps|mapquest|here\.com\/maps|wikimapia|mapy\.cz)[^"']*)["']/gi;

/** Label/value pairs: "Email:", "E-mail :", "Phone No.", "Mobile", "मोबाइल". */
const LABEL_EMAIL_RE = /(?:e[-\s]?mail|इमेल)\s*[:：]?\s*([^\s<]{3,80}@[^\s<]{2,80})/gi;
const LABEL_PHONE_RE =
  /(?:phone|tel(?:ephone)?|contact|mobile|फोन|मोबाइल|सम्पर्क)\s*(?:no\.?|number)?\s*[:：]?\s*((?:\+?\d[\d\s\-/()]{6,}\d))/gi;
const LABEL_MANAGER_RE =
  /(?:branch\s*(?:manager|in-?charge|head)|(?:manager|in-?charge)|प्रबन्धक|अध्यक्ष)\s*[:：]?\s*([^\n<]{2,80})/gi;
const LABEL_ADDRESS_RE = /(?:address|ठेगाना)\s*[:：]?\s*([^\n<]{4,140})/gi;

function uniq(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter((s) => s.length > 0))];
}

// ---------------------------------------------------------------------------
// Card records
// ---------------------------------------------------------------------------

export type CardNameSource = "heading" | "body" | "none";

export interface CardEvidence {
  email: boolean;
  phone: boolean;
  mobile: boolean;
  address: boolean;
  map: boolean;
  manager: boolean;
  /** 1 when this card is one of a run of structurally similar peers. */
  peers: number;
}

export interface RawCardRecord {
  /** heading text, normalized; the record's structural anchor */
  heading: string;
  headingTag: string;
  /** whether the anchor heading is a person/role rather than a place */
  headingIsPerson: boolean;
  /** candidate place name, or null when the card yields none */
  name: string | null;
  nameSource: CardNameSource;
  /** true when the name had to be recovered from the body because the heading
   *  was a person; the caller may treat this as weaker provenance */
  nameFromPersonCard: boolean;
  place: string | null;
  address: string | null;
  district: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  manager: string | null;
  map: string | null;
  evidence: CardEvidence;
  /** the card's text, for diagnostics only */
  text: string;
  /**
   * the card's text with every contact value removed. Geography must be read
   * from this, not from `text`: an address line is a legitimate place source,
   * while "butwal.branch@example.com" is a mailbox whose local part happens to
   * spell a district and would otherwise be mined as one.
   */
  freeText: string;
}

/** How long a heading may own before it stops being a card. */
export const MAX_CARD_SPAN = 5000;

function collect(pattern: RegExp, text: string, group = 0): string[] {
  const out: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push((m[group] ?? m[0]).trim());
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function firstOf(list: string[]): string | null {
  for (const v of list) if (v && v.length > 0) return v;
  return null;
}

/** A body line that can carry a place name: no contact syntax, not a role, not a
 *  pure number, short enough to be a title rather than a sentence. */
function bodyNameCandidate(line: string): string | null {
  const t = line.trim();
  if (t.length < 3 || t.length > 70) return null;
  // These are read with .test, so they must NOT be the shared /g constants: a
  // stateful lastIndex would make the answer depend on how many times the regex
  // ran before, which is not deterministic.
  if (new RegExp(EMAIL_RE.source).test(t)) return null;
  if (new RegExp(PHONE_SCAN_RE.source).test(t)) return null;
  if (new RegExp(MAP_HREF_RE.source).test(t)) return null;
  if (ROLE_WORD_RE.test(t)) return null;
  if (/^\d[\d\s\-/().]*$/.test(t)) return null;
  return t;
}

/** Split a card body into display lines on the usual separators. */
function bodyLines(chunk: string): string[] {
  return chunk
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|td|tr|h[1-6])\s*>/gi, "\n")
    .split("\n")
    .map((l) => l.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/**
 * Extract repeated peer cards from a document.
 *
 * The record boundary is a heading that owns a bounded span, which is the same
 * generic boundary M3.4 already used; the novelty is that the heading is NOT
 * required to be the name. When the heading is a person or a role, the name is
 * looked for in the first body line of the card, because that is where those
 * layouts put the location.
 */
export function parseCardRecords(html: string): RawCardRecord[] {
  const marks: Array<{ text: string; tag: string; from: number; to: number; isPerson: boolean }> = [];
  const hre = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = hre.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length === 0 || text.length > 120) continue;
    const norm = normalizeBranchLabel(text);
    if (norm.length === 0) continue;
    marks.push({
      text: norm,
      tag: m[1].toLowerCase(),
      from: m.index,
      to: m.index + m[0].length,
      isPerson: isPersonOrRoleHeading(norm),
    });
  }

  const records: RawCardRecord[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].to;
    const nextFrom = i + 1 < marks.length ? marks[i + 1].from : html.length;
    // A page title owns the rest of the document and is not a record.
    if (nextFrom - start > MAX_CARD_SPAN) continue;
    const chunk = html.slice(start, nextFrom);
    const text = chunk
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const emails = uniq([...collect(MAILTO_HREF_RE, chunk, 1), ...collect(LABEL_EMAIL_RE, text, 1), ...collect(EMAIL_RE, text)]);
    const tels = uniq([...collect(TEL_HREF_RE, chunk, 1), ...collect(LABEL_PHONE_RE, text, 1)]);
    const scanned = uniq(collect(PHONE_SCAN_RE, text));
    const maps = uniq(collect(MAP_HREF_RE, chunk, 1));
    const managers = uniq(collect(LABEL_MANAGER_RE, text, 1)).map((v) => v.replace(/^[:：\s]+/, "").trim());
    const addresses = uniq(collect(LABEL_ADDRESS_RE, text, 1)).map((v) => v.replace(/^[:：\s]+/, "").trim());

    // Mobile vs landline: a mobile is a 10-digit national number, optionally
    // +977. Keeping them apart stops a manager's mobile being reported as the
    // branch phone and vice versa.
    const mobiles = tels.filter((t) => /^(\+?977[-\s]?)?9\d{9}$/.test(t.replace(/\D/g, "")) || /mobile|मोबाइल/i.test(t));
    const phones = tels.filter((t) => !mobiles.includes(t));
    const phone = firstOf(phones) ?? firstOf(scanned);

    const lines = bodyLines(chunk);
    // Only the first few lines are title-like; later lines are addresses and
    // contact values.
    const nameFromBody = marks[i].isPerson
      ? (lines.slice(0, 2).map(bodyNameCandidate).find((v): v is string => v !== null) ?? null)
      : null;

    // An address is often printed with no "Address:" label, as a bare line under
    // a branch heading (icon column + value cell, or a plain <br> line). That
    // free text is the card's address evidence, so read it as such instead of
    // waiting for a label that many layouts never use. Every line that produced
    // some other value (contact, person, the recovered name) is excluded, so an
    // address can never be harvested out of a phone or an email.
    const has = (re: RegExp, s: string): boolean => new RegExp(re.source, re.flags.replace("g", "")).test(s);
    const addressFromBody =
      addresses[0] ??
      (lines.find((l) => {
        if (l === nameFromBody) return false;
        if (l.length < 6 || l.length > 140) return false;
        if (/@/.test(l)) return false;
        if (has(PHONE_SCAN_RE, l)) return false;
        if (has(LABEL_MANAGER_RE, l)) return false;
        if (has(LABEL_EMAIL_RE, l)) return false;
        if (has(LABEL_ADDRESS_RE, l)) return false;
        if ((l.match(/\p{L}/gu) ?? []).length < 3) return false;
        return true;
      }) ??
        null);
    const address = addressFromBody;

    records.push({
      heading: marks[i].text,
      headingTag: marks[i].tag,
      headingIsPerson: marks[i].isPerson,
      name: marks[i].isPerson ? nameFromBody : marks[i].text,
      nameSource: marks[i].isPerson ? (nameFromBody ? "body" : "none") : "heading",
      nameFromPersonCard: marks[i].isPerson,
      place: nameFromBody,
      address,
      district: null,
      phone,
      mobile: firstOf(mobiles),
      email: firstOf(emails),
      manager: firstOf(managers) ?? (marks[i].isPerson ? marks[i].text : null),
      map: firstOf(maps),
      evidence: {
        email: emails.length > 0,
        phone: tels.length > 0 || scanned.length > 0,
        mobile: mobiles.length > 0,
        address: address !== null,
        map: maps.length > 0,
        manager: managers.length > 0,
        peers: 0,
      },
      text: text.slice(0, 400),
      freeText: text
        .replace(new RegExp(EMAIL_RE.source, "gi"), " ")
        .replace(new RegExp(PHONE_SCAN_RE.source, "g"), " ")
        .replace(new RegExp(MAP_HREF_RE.source, "gi"), " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  // Peer count: cards that carry the same evidence signature are peers of each
  // other. Used as generic corroboration ("this is a directory, not one office").
  const sig = new Map<string, number>();
  for (const r of records) {
    const k = [r.evidence.email, r.evidence.phone, r.evidence.address, r.evidence.map].map((b) => (b ? 1 : 0)).join("");
    sig.set(k, (sig.get(k) ?? 0) + 1);
  }
  for (const r of records) {
    const k = [r.evidence.email, r.evidence.phone, r.evidence.address, r.evidence.map].map((b) => (b ? 1 : 0)).join("");
    r.evidence.peers = sig.get(k) ?? 0;
  }
  return attachAdjacentContacts(records);
}

// ---------------------------------------------------------------------------
// Adjacent branch <-> manager pairing
// ---------------------------------------------------------------------------

/**
 * Give a branch card the contact block that the layout put in the NEXT heading.
 *
 * Three of the four committed email-card targets print the branch name and its
 * address/phone in one heading card, then the manager and the branch's email in
 * a following heading ("Mr. X, Branch Manager" + mailto). The email is therefore
 * real branch evidence but belongs to the record whose name was printed first.
 *
 * The rule is document order + nearest preceding branch card, which is a
 * structural property of the page, not a site fact. Values already present on
 * the branch card always win, so nothing is overwritten and the result does not
 * depend on iteration order. Person cards that find no preceding branch keep
 * their evidence but stay nameless, so they never assert a branch.
 */
function attachAdjacentContacts(records: RawCardRecord[]): RawCardRecord[] {
  let lastBranch: RawCardRecord | null = null;
  for (const r of records) {
    if (r.name !== null) {
      lastBranch = r;
      continue;
    }
    if (lastBranch === null) continue;
    if (r.email !== null && lastBranch.email === null) lastBranch.email = r.email;
    if (r.manager !== null && lastBranch.manager === null) lastBranch.manager = r.manager;
    if (r.mobile !== null && lastBranch.mobile === null) lastBranch.mobile = r.mobile;
    if (r.map !== null && lastBranch.map === null) lastBranch.map = r.map;
    if (r.phone !== null && lastBranch.phone === null) lastBranch.phone = r.phone;
    if (r.email !== null) lastBranch.evidence.email = true;
    if (r.manager !== null) lastBranch.evidence.manager = true;
  }
  return records;
}

// ---------------------------------------------------------------------------
// Evidence strength
// ---------------------------------------------------------------------------

export type CardStrength = "strong" | "moderate" | "weak" | "none";

/**
 * How much a card proves that it is a branch, before any name plausibility test.
 *
 *   strong   a contact AND a second independent signal: name+email+address,
 *            email+phone, map+address, address+phone
 *   moderate a single usable contact (email or map), or address/phone on a card
 *            that has >= 3 structurally identical peers
 *   weak     a name and nothing else — a heading, or a body line recovered from
 *            a person heading, with no contact and no corroboration
 *   none     no candidate name
 *
 * A weak card is real evidence and is reported, but it is NOT auto-asserted: a
 * lone heading cannot distinguish a branch from a person, a department or a
 * navigation label. Requiring evidence here is what stops 155 manager headings
 * on one target from becoming 155 branches.
 */
export function cardStrength(r: RawCardRecord): CardStrength {
  if (r.name === null) return "none";
  const e = r.evidence;
  if ((e.email && e.address) || (e.email && e.phone) || (e.map && e.address) || (e.address && e.phone)) return "strong";
  if (e.email || e.map) return "moderate";
  if ((e.address || e.phone) && e.peers >= 3) return "moderate";
  return "weak";
}

/** Only strong and moderate cards may become branch assertions. */
export function isAssertableCard(r: RawCardRecord): boolean {
  const s = cardStrength(r);
  return s === "strong" || s === "moderate";
}

// ---------------------------------------------------------------------------
// Deterministic branch identity (Phase 11)
//
// Identity is institution + normalized name + geographic discriminator. It is
// deliberately NOT built from email, phone, map URL, document order or array
// position: those change when an institution republishes a contact, and using
// them would split one branch into two. Normalization is a pure function of the
// name text, so the same name always yields the same key.
// ---------------------------------------------------------------------------

const IDENTITY_KEEP_RE = /[^\p{L}\p{M}\p{N}]+/gu;

/** Normalized, comparable form of a branch name. Serial codes are removed by
 *  normalizeBranchLabel first, so "Waling Branch (003)" and "Waling Branch"
 *  are the same branch. */
export function branchNameKey(raw: string): string {
  return normalizeBranchLabel(raw)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(IDENTITY_KEEP_RE, " ")
    .trim();
}

export interface BranchIdentityGeo {
  district?: string | null;
  place?: string | null;
  address?: string | null;
}

/** The geographic discriminator, or null when the page gave none. */
export function branchGeoKey(geo: BranchIdentityGeo | null | undefined): string | null {
  if (!geo) return null;
  const parts = [geo.district, geo.place]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.toLowerCase().replace(IDENTITY_KEEP_RE, " ").trim());
  const uniq = [...new Set(parts)];
  return uniq.length > 0 ? uniq.join(" / ") : null;
}

/**
 * The deterministic identity of one branch.
 * Same institution + same name + same geography always produces this exact
 * string, regardless of which run, which order, or which contact values.
 */
export function branchIdentityKey(institutionId: string, rawName: string, geo?: BranchIdentityGeo | null): string {
  const name = branchNameKey(rawName);
  const g = branchGeoKey(geo);
  return `${institutionId.trim().toLowerCase()}|${name}|${g ?? "-"}`;
}

export interface BranchIdentityGroup {
  /** the shared normalized name */
  nameKey: string;
  /** the raw names that normalized to it, for reporting */
  names: string[];
  /** distinct geographies seen for this name inside the institution */
  geoKeys: string[];
  /** one identity per distinct geography */
  keys: string[];
  /**
   * true when one name maps to more than one geography, so the name alone is
   * ambiguous and the geographic discriminator is required to keep branches
   * apart. A caller that cannot supply geography must hold rather than merge.
   */
  ambiguous: boolean;
}

/**
 * Group candidate rows of ONE institution by name and report where a name alone
 * is ambiguous. Pure function of the rows; no I/O, no ordering dependence.
 */
export function groupBranchIdentities(
  institutionId: string,
  rows: ReadonlyArray<{ name: string } & BranchIdentityGeo>,
): BranchIdentityGroup[] {
  const byName = new Map<string, { names: Set<string>; geos: Set<string> }>();
  for (const row of rows) {
    const nameKey = branchNameKey(row.name);
    if (nameKey.length === 0) continue;
    const bucket = byName.get(nameKey) ?? { names: new Set<string>(), geos: new Set<string>() };
    bucket.names.add(row.name);
    const geo = branchGeoKey(row);
    if (geo !== null) bucket.geos.add(geo);
    byName.set(nameKey, bucket);
  }
  const out: BranchIdentityGroup[] = [];
  for (const [nameKey, bucket] of [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const geoKeys = [...bucket.geos].sort();
    out.push({
      nameKey,
      names: [...bucket.names].sort(),
      geoKeys,
      keys: geoKeys.map((g) => `${institutionId.trim().toLowerCase()}|${nameKey}|${g}`),
      ambiguous: geoKeys.length > 1,
    });
  }
  return out;
}
