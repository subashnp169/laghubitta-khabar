// ============================================================================
// M3.5 — Generic deterministic careers / vacancies: shapes, grammar, identity.
//
// Everything here is a pure function of bytes. There is no network call, no
// database, no AI, no OCR and no DOM. Given the same HTML this module returns the
// same records in the same order, which is what makes the whole milestone
// testable without a network.
//
// Three ideas do most of the work:
//
//   1. A VACANCY must be ANCHORED. A section label, a nav item, a phone number
//      and a bare announcement are not vacancies. This rule already exists for
//      the M1 `vacancy-html-v1` parser (`JOB_ROLE_RE` in structured.ts) and it is
//      kept, because it is why a junk career page asserts nothing.
//
//   2. A field is ASSERTED only when its structure justifies it. A deadline in a
//      cell under a `Deadline` header has structural support. The same date found
//      in a sentence does not. That single distinction is the difference between
//      a usable pipeline and a plausible-looking fabrication.
//
//   3. IDENTITY is not the URL. A vacancy moved from /career/123 to /notice/456
//      is the same vacancy, so the URL cannot be part of the key. Dates are
//      excluded too, because a deadline gets extended and an extension must
//      supersede rather than fork.
//
// A sibling of branch-records.ts, not an edit to it. M3.4 is frozen.
// ============================================================================

import { extractEndpointCandidates, isRequestCallPattern } from "./career-endpoints";

// ---------------------------------------------------------------------------
// Normalization primitives
// ---------------------------------------------------------------------------

/** NFKC, strip tags, collapse whitespace, trim. Never executes anything. */
export function cleanText(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&#x?[0-9a-f]+;?/gi, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Casefolded, punctuation-stripped key form used for identity and dedupe. */
export function identityKeyPart(raw: string | null | undefined): string {
  return cleanText(raw)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Page shape taxonomy
// ---------------------------------------------------------------------------

export type CareerShape =
  | "UNREADABLE_BODY"
  | "CLIENT_RENDERED_SHELL"
  | "CAREER_CONTENT_CLIENT_LOADED"
  | "NOT_A_CAREER_PAGE"
  | "RECRUITMENT_RESULT_PAGE"
  | "VACANCY_DOCUMENT"
  | "VACANCY_LIST"
  | "SINGLE_VACANCY_DETAIL"
  | "CAREER_VOCABULARY_ONLY";

export interface CareerShapeCounts {
  visibleTextLength: number;
  scriptCount: number;
  noscriptCount: number;
  jsRenderedIndicators: number;
  /**
   * Requests this page makes for content that could be its vacancies, read
   * statically from its own script. Zero means the page's HTML is the whole of what
   * it knows, so an empty career page here really is empty.
   */
  clientDataLoadHits: number;
  /**
   * Every request call found, including captchas, search and subscriptions. Kept so
   * the count above can be audited rather than trusted.
   */
  requestCallCount: number;
  tableCount: number;
  recordTableCount: number;
  /** Candidate vacancy records the grammar found, asserted or not. */
  candidateVacancies: number;
  /**
   * Strong recruitment words present anywhere in the visible text.
   */
  careerVocabHits: number;
  /**
   * The same words outside navigation, header, footer and aside. A "Career" menu
   * label is not a career section: a homepage whose only career word is a nav link
   * has a Career page to be followed, not vacancies to be reported.
   */
  careerSectionHits: number;
  /** Words meaning a finished process: result, merit list, shortlisted. */
  resultVocabHits: number;
  /** Job-role nouns in the visible text. The strongest single signal there is. */
  jobRoleHits: number;
  /**
   * The response was a JSON document already parsed into items. The text-length
   * and vocabulary gates describe prose and do not apply: a JSON array has almost
   * no visible text, and its field names are not page vocabulary. Whether it is a
   * vacancy source is decided by whether it yields titled records.
   */
  structuredJson: boolean;
  /** Whether the response itself is a document rather than a page. */
  isDocument: boolean;
  httpStatus: number;
}

/** Below this, a page with scripts and no noscript is an unrendered shell. */
export const UNREADABLE_TEXT_MAX = 3;
export const CLIENT_SHELL_TEXT_MAX = 200;
export const CLIENT_SHELL_INDICATORS_MIN = 2;

/**
 * A page that asks its own server for the content it displays.
 *
 * This began as a search for `$(document).ready`, which was a mistake the live pages
 * exposed. That call fires on nearly every jQuery site and means only "the DOM
 * exists" — on the seven pages first reported as dynamic it opened a hover menu, slid
 * a carousel, showed a modal, and fetched a captcha image. Four institutions were
 * labelled as having vacancies we could not see when their pages are static HTML.
 *
 * Only a real request counts now, and only one whose target is not a known
 * non-content purpose. `$(document).ready` remains useful as evidence that scripting
 * is present, and is still measured, but it no longer implies anything is missing.
 *
 * Only the call and its URL are read. The response's contents are not predicted, and
 * nothing in the script is executed.
 */
const REQUEST_CALL_RE =
  /\bfetch\s*\(|\$\s*\.\s*(?:ajax|get|getJSON|post)\s*\(|\baxios\s*(?:\.\s*(?:get|post)\s*)?\(|\.open\s*\(\s*(?:'|")(?:GET|POST)(?:'|")\s*,/gi;

/**
 * Requests a page makes that are never its own content: session plumbing and
 * interaction endpoints. Generic by nature — captcha, subscription, search, contact,
 * authentication, comments, maps — so no institution is named. A page whose only
 * requests are these is a static page, and saying otherwise invents a blocker that
 * does not exist.
 *
 * Matching is on path-ish boundaries rather than `\b`, because the real name on one
 * pilot site is `refreshcaptcha` — one word, no boundary, and a `\bcaptcha\b` pattern
 * misses it while correctly refusing to be fooled by it.
 *
 * A URL that names a career, vacancy, job or recruitment is never excluded here,
 * whatever else it contains. Under-excluding costs a page that could have been
 * checked; over-excluding would report a vacancy page as empty, and that error
 * publishes a false statement about a real institution.
 */
const NON_CONTENT_REQUEST_RE =
  /(?:^|[/?&=._-])(?:captcha|email[-_]?subscription|subscribe|subscription|newsletter|unsubscribe|contact|enquir|feedback|comment|search|login|logout|signin|auth|csrf|token|share|rating|vote|poll|chat|bookmark)(?:$|[/?&=._-])|refresh\s*captcha/i;

const CONTENT_REQUEST_HINT_RE = /career|vacanc|job|recruit|hiring|\bpost\b|apply/i;

const CHROME_TAG_NAMES = ["nav", "header", "footer", "aside"] as const;
const CHROME_CLASS_RE =
  /\b(?:nav|navbar|navigation|menu|mainmenu|main-menu|topmenu|top-menu|breadcrumb|masthead|sidebar)\b/i;

/**
 * Remove page furniture whose only "career" is a menu label.
 *
 * Four pilot homepages — nirdhan, chhimekbank, swbbl, ulbsl — carry exactly one
 * career word, in a menu, and a jQuery `document.ready` for that menu or a chat
 * widget. Counted as they were, each read as a career page whose vacancies arrive
 * by script, which would have sent four institutions to "we cannot see their
 * vacancies" when the right next step is to open the Career menu item, which the
 * pilot already does.
 *
 * The semantic tags are stripped first, then a list or div whose class or id names a
 * menu, because plenty of older sites build their navigation out of
 * `<ul class="menu">` and never use `<nav>` at all.
 *
 * Only the same-name closing tag is matched, so nesting inside the removed element
 * is preserved and cannot cut the page short. An element with no close tag is left
 * alone. And if any pass removes more than 60% of the text, the markup is assumed
 * to be unbalanced and the original is kept: a mis-parse must never silently become
 * the reason a career page looks empty.
 */
function stripChrome(html: string): string {
  let out = html;
  for (const tag of CHROME_TAG_NAMES) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  }
  for (const tag of ["ul", "ol", "div", "section"] as const) {
    const withClass = new RegExp(
      `<${tag}\\b[^>]*(?:class|id)\\s*=\\s*["'][^"']*${CHROME_CLASS_RE.source}[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi",
    );
    const next = out.replace(withClass, " ");
    if (next.length >= out.length * 0.4) out = next;
  }
  return out;
}

/** Career words in page prose. Distinct from link hints, which are URL-shaped. */
const CAREER_VOCAB: readonly string[] = [
  "career", "vacanc", "job", "recruit", "hiring", "employment", "position",
  "applicant", "application", "रोजगारी", "खाली", "भर्ती", "पद",
];

const RESULT_VOCAB: readonly string[] = [
  "merit list", "merit-list", "shortlist", "shortlisted", "successful applicant",
  "selected candidate", "interview result", "exam result", "result of",
  "result notice", "final result", "selected candidates", "successful candidates",
  "merit", "qualified candidate", "waiting list", "प्रकाशित नतिजा", "नतिजा", "छनोट",
];

/**
 * A table column that holds people, not posts. A result table names candidates in
 * the same row as a position, so a position column alone cannot make it a vacancy
 * table. Detected on the header, never on cell values, because cell values are
 * the thing being judged.
 */
const RESULT_HEADER_RE =
  /(?:^|\b)(?:name|full\s*name|candidate|applicant|roll\s*(?:no|number)|reg(?:istration)?\s*(?:no|number)|serial\s*of\s*candidate|merit\s*(?:no|number|rank)|result\s*(?:date|status)|marks|score|obtained)(?:\b|$)/i;

function countHits(text: string, vocab: readonly string[]): number {
  const t = text.toLowerCase();
  let n = 0;
  for (const v of vocab) if (t.includes(v)) n += 1;
  return n;
}

/**
 * Classify a career page from measured structure alone.
 *
 * Precedence is fixed, and the order carries meaning:
 *
 *   UNREADABLE_BODY first, always. A 0-byte or 3xx response is a transport fact,
 *   not a finding about the page. Same rule as `isUnreadable` in shape-signals.ts.
 *   RECRUITMENT_RESULT_PAGE before VACANCY_LIST, because a published merit list
 *   contains rows of candidate names that look exactly like a vacancy table, and
 *   reporting those as open jobs would be the worst possible error here.
 */
export function classifyCareerShape(c: CareerShapeCounts): { shape: CareerShape; reason: string } {
  if (c.httpStatus >= 300 && c.httpStatus < 400) {
    return { shape: "UNREADABLE_BODY", reason: `http ${c.httpStatus} is a redirect, not content` };
  }
  // A PDF has no extractable text by design, but it is a readable document. It
  // must be classified before the text-length gates, or every notice PDF is
  // filed as unreadable and never becomes a retained snapshot.
  if (c.isDocument) {
    return { shape: "VACANCY_DOCUMENT", reason: "response is a document, not a page" };
  }
  // A parsed JSON payload is judged on its items, not on its text. A bare array
  // like `[]` or `[{"id":1}]` has almost no visible text, so the length gate below
  // would file every real JSON endpoint as unreadable.
  if (c.structuredJson) {
    return c.candidateVacancies > 0
      ? { shape: "VACANCY_LIST", reason: `${c.candidateVacancies} record(s) from a JSON endpoint` }
      : { shape: "NOT_A_CAREER_PAGE", reason: "JSON endpoint yielded no titled vacancy" };
  }
  if (c.visibleTextLength <= UNREADABLE_TEXT_MAX) {
    return { shape: "UNREADABLE_BODY", reason: `visible text ${c.visibleTextLength} chars` };
  }
  if (
    c.visibleTextLength < CLIENT_SHELL_TEXT_MAX &&
    c.jsRenderedIndicators >= CLIENT_SHELL_INDICATORS_MIN &&
    c.noscriptCount > 0
  ) {
    return {
      shape: "CLIENT_RENDERED_SHELL",
      reason: `text ${c.visibleTextLength} with ${c.scriptCount} scripts and ${c.jsRenderedIndicators} client-render indicators`,
    };
  }
  if (c.resultVocabHits > c.careerVocabHits && c.resultVocabHits > 0) {
    return { shape: "RECRUITMENT_RESULT_PAGE", reason: `result vocabulary (${c.resultVocabHits}) outweighs career vocabulary (${c.careerVocabHits})` };
  }
  if (c.candidateVacancies > 0) {
    // One record with no table and no list structure is a single posting written
    // in prose, not a list of one. The distinction is the reader's: a detail page
    // describes a post, a list page enumerates them.
    if (c.candidateVacancies === 1 && c.recordTableCount === 0 && c.tableCount === 0) {
      return { shape: "SINGLE_VACANCY_DETAIL", reason: "one anchored record and no list structure" };
    }
    return {
      shape: "VACANCY_LIST",
      reason: `${c.candidateVacancies} anchored vacancy record(s)`,
    };
  }
  if (c.careerVocabHits > 0) {
    // A single posting described in prose. Vocabulary alone is not enough: a
    // contact page whose email or URL contains "jobs" also matches, so a real
    // job-role noun must appear before a page is called a vacancy.
    if (c.jobRoleHits > 0 && c.recordTableCount === 0 && c.candidateVacancies === 0 && c.tableCount === 0) {
      return { shape: "SINGLE_VACANCY_DETAIL", reason: `career vocabulary and ${c.jobRoleHits} job-role noun(s), no list structure` };
    }
    // A page that fetches its own rows has vacancies this response does not carry.
    // A real laghubitta `/page/careers/7/vacancy/17` renders nothing but the word
    // "Vacancy" and then populates a table from an inline `$(document).ready`
    // request. Calling that "no current vacancy" states a fact about the
    // institution that the response cannot support, so the vacancy state is
    // reported as unknown instead.
    if (c.clientDataLoadHits > 0 && c.careerSectionHits > 0) {
      return {
        shape: "CAREER_CONTENT_CLIENT_LOADED",
        reason: `career section text (${c.careerSectionHits}) with ${c.clientDataLoadHits} client-side data load(s); this response carries no vacancy rows`,
      };
    }
    return { shape: "CAREER_VOCABULARY_ONLY", reason: `career vocabulary (${c.careerVocabHits}) but no anchored record` };
  }
  return { shape: "NOT_A_CAREER_PAGE", reason: "no career vocabulary and no vacancy structure" };
}

// ---------------------------------------------------------------------------
// Field vocabulary
// ---------------------------------------------------------------------------

export const JOB_TITLE = "JOB_TITLE";
export const LOCATION = "LOCATION";
export const DEPARTMENT = "DEPARTMENT";
export const EMPLOYMENT_TYPE = "EMPLOYMENT_TYPE";
export const PUBLISHED_DATE = "PUBLISHED_DATE";
export const DEADLINE = "DEADLINE";
export const REQUIREMENTS = "REQUIREMENTS";
export const EDUCATION = "EDUCATION";
export const EXPERIENCE = "EXPERIENCE";
export const APPLICATION_METHOD = "APPLICATION_METHOD";
export const APPLICATION_URL = "APPLICATION_URL";
export const CONTACT_EMAIL = "CONTACT_EMAIL";
export const SOURCE_DOCUMENT = "SOURCE_DOCUMENT";

/** The complete, deliberately small vocabulary. No speculative HR fields. */
export const VACANCY_FIELDS: readonly string[] = [
  JOB_TITLE, LOCATION, DEPARTMENT, EMPLOYMENT_TYPE, PUBLISHED_DATE, DEADLINE,
  REQUIREMENTS, EDUCATION, EXPERIENCE, APPLICATION_METHOD, APPLICATION_URL,
  CONTACT_EMAIL, SOURCE_DOCUMENT,
];

/**
 * Confidence per field, following the frozen convention
 * (structured.ts: identity >= 0.5 asserts, volatile stays evidence at 0.45).
 *
 * `DEADLINE` has two entries because it has two provenances and they are not
 * equally supported: see `deadlineSupport`.
 */
export const FIELD_CONFIDENCE: Readonly<Record<string, number>> = {
  [JOB_TITLE]: 0.6,
  [LOCATION]: 0.5,
  [DEPARTMENT]: 0.5,
  [EMPLOYMENT_TYPE]: 0.5,
  [PUBLISHED_DATE]: 0.5,
  [DEADLINE]: 0.5, // from a declared column
  [DEADLINE + ":text"]: 0.45, // from prose — evidence only
  [REQUIREMENTS]: 0.5,
  [EDUCATION]: 0.5,
  [EXPERIENCE]: 0.5,
  [APPLICATION_METHOD]: 0.5,
  [APPLICATION_URL]: 0.5,
  [CONTACT_EMAIL]: 0.5,
  [SOURCE_DOCUMENT]: 0.5,
};

export type DeadlineSupport = "column" | "text";

/** The confidence a deadline is actually publishable at. */
export function deadlineConfidence(support: DeadlineSupport): number {
  return support === "column" ? FIELD_CONFIDENCE[DEADLINE] : FIELD_CONFIDENCE[DEADLINE + ":text"];
}

/** True when the field may become an assertion. */
export function isAssertableField(field: string): boolean {
  return fieldConfidenceOf(field) >= 0.5;
}

function fieldConfidenceOf(field: string): number {
  if (field === DEADLINE) return FIELD_CONFIDENCE[DEADLINE];
  return FIELD_CONFIDENCE[field] ?? 0;
}

// ---------------------------------------------------------------------------
// Title plausibility
// ---------------------------------------------------------------------------

/** Role nouns. Kept in step with the M1 parser's JOB_ROLE_RE, plus a few. */
export const JOB_ROLE_RE =
  /(?:officer|manager|assistant|supervisor|trainee|trainees|engineer|accountant|chief|coordinator|operator|analyst|receptionist|attendant|peon|guard|cashier|clerk|surveyor|counselor|executive|administrator|officer-in-charge|महाप्रबन्धक|प्रबन्धक|व्यवस्थापक|अधिकृत|सहायक|कर्मचारी|पर्यवेक्षक|लेखापाल|लेखा|रेखदेख|क्याशियर|गार्ड|पियन)/i;

/** Section labels and chrome that are never a job title. */
const TITLE_SKIP = new Set([
  "position", "positions", "post", "posts", "title", "vacancy", "vacancies",
  "designation", "job", "jobs", "s.n", "sn", "no", "sr no", "serial",
  "career", "careers", "vacancy announcement", "vacancy notice", "recruitment",
  "news", "notice", "download", "apply", "view details", "details", "read more",
  "समाचार", "पद", "जागिर", "स्थान", "विज्ञापन", "आवेदन",
  // Contact and navigation headings. A contact page has a phone, an email and a
  // URL, and every one of those can look like an anchor to a careless parser.
  "contact", "contacts", "contact us", "contact info", "get in touch",
  "about us", "about", "home", "menu", "navigation", "search", "help",
  "quick links", "useful links", "related links", "footer", "header",
  "संपर्क", "सम्पर्क",
]);

const TITLE_MIN = 3;
const TITLE_MAX = 90;
const PHONE_SHAPE = /(?:\+?\d[\d\s\-/()]{6,}\d)/;

export type TitleRejection =
  | "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "SKIP_LABEL" | "URL_LIKE"
  | "PHONE_LIKE" | "DATE_LIKE" | "GENERIC_SENTENCE" | "REQUIREMENTS_BLOCK"
  | "RESULT_NOTICE" | "DOCUMENT_NOTICE" | "PROCESS_NOTICE"
  | "ORGANISATION_NAME";

/**
 * A heading that names a FINISHED process rather than an opening.
 *
 * The live pilot read homepages whose first heading was a shortlist, an interview
 * notice or a share-sale notice. Every one of those is a real, published notice
 * and none of them is a vacancy, so a title carrying that vocabulary is refused
 * before it can become a record. The vocabulary is intentionally the same one
 * `RESULT_VOCAB` uses, because "a merit list is not a job" is one idea, not two.
 */
const RESULT_NOTICE_RE =
  /(?:shortlist|shortlisted|merit\s*list|selected\s+candidates?|successful\s+(?:applicants?|candidates?)|interview\s+(?:result|notice)|exam\s+result|final\s+result|written\s+(?:exam|result)|waiting\s+list|नतिजा|छनोट)/i;

/**
 * A heading that names a document or a form rather than a post: "Application
 * Form", "Vacancy Form", "Annual Report", "Notice". These are links to files, and
 * a file is stored as a document, never asserted as a vacancy title.
 */
const DOCUMENT_NOTICE_RE =
  /^(?:.*\b)?(?:application|vacancy|job|recruitment)\s+(?:form|notice|notice\s+download|details?|download|apply)\b.*$/i;

/**
 * A heading that opens with a file-type label. "PDF Notice Regarding Recruitment of
 * Assistant Trainees" is the label of a link to a PDF, not a post, and the pilot
 * read it as a vacancy on a real bank page. No position is named "PDF", so the
 * label is decisive on its own, and the document itself is still recorded and
 * classified from its own URL.
 */
const FILE_LABEL_RE = /^\s*(?:pdf|docx?|xlsx?|pptx?|zip|file|download)\b/i;

/**
 * A heading that OPENS with the name of a document rather than a post. The pilot
 * read "Notice Regarding Recruitment of Assistant Trainees" on a real bank's
 * `/vacancy` page and scored the bank as a verified vacancy source, while the page
 * in fact holds two vacancy PDFs and nothing this system can read.
 *
 * The rule is anchored to the start deliberately. "Notice of Vacancy" and "Vacancy
 * Notice" are both real announcement titles, and refusing either would hide a
 * recruitment; but a title that BEGINS with "Notice" or "Announcement" is naming a
 * document, and the linked file is then recorded and classified from its own URL
 * instead. The page that carries it is still reported as vacancy evidence, so the
 * recruitment is not lost — it is reported as a document this system cannot read.
 */
const DOCUMENT_HEAD_RE =
  /^\s*(?:notice|announcement|public\s+notice|press\s+release|advisory|circular|bulletin|office\s+order|आदेश|सूचना|प्रेस)\b/i;

/**
 * A heading that names a STAGE of a recruitment rather than an opening: an exam
 * plan, a syllabus, an interview notice, a question paper.
 *
 * The live pilot produced eight of these from real pages. `/careers/syllabus` on a
 * cooperative's site yielded "Plan, syllabus and full marks of the trainee assistant
 * examination", and a microfinance `/career` page yielded four headings, of which
 * three were interview notices and one was "Syllabus - Assistant Manager". All
 * eight are genuine published documents about a recruitment that has already been
 * advertised; not one of them is a post someone can apply for. Announcing a process
 * and opening a position are different facts.
 */
const PROCESS_NOTICE_RE =
  /(?:syllabus|curriculum|question\s*paper|exam(?:ination)?\s+(?:plan|schedule|notice|date|syllabus|form)|written\s+exam|interview\s+(?:notice|schedule|call|date)|interview|interview\s*(?:|sr$)|syllabus|अन्तरवार्ता|वार्तालाप|पाठ्यक्रम|परीक्षा|प्रश्नपत्र|योजना)/i;

/**
 * A heading that is the organisation's own REGISTERED NAME rather than a post.
 *
 * `parseVacancyDetail` has always refused this case — its `detailAnchored` comment
 * records the pilot reading a homepage's `<h1>` as a vacancy title — but the card
 * path had no equivalent check and so still produced one. On the live run,
 * `swmfi.com.np/careers` yielded a card titled "Suryodaya Womi Laghubitta Bittiya
 * Sanstha Ltd." with a deadline and a contact email, and the pilot scored the
 * institution as a verified vacancy source. No posting is named after the legal
 * entity that employs it, so a title carrying a registration suffix is refused.
 *
 * This is deliberately a suffix rule, not a substring rule: the same words appear
 * inside genuine notice titles ("... Sanstha Ltd. Vacancy Notice ...") where the
 * ROLE and the DOCUMENT rules below already decide, and refusing any title
 * containing "Sanstha" would hide a real recruitment.
 */
const ORGANISATION_NAME_RE =
  /\b(?:ltd\.?|limited|llp|plc|pvt\.?|private\s+ltd|co\.?\s*-?\s*operative|cooperative|co-?op|sanstha|sanskrit|समुदाय|सहकारी)\.?\s*$/i;

/** Why a candidate title cannot be asserted. Empty string means assertable. */
export function titleRejection(raw: string | null | undefined): TitleRejection | "" {
  const t = cleanText(raw);
  if (t.length === 0) return "EMPTY";
  if (t.length < TITLE_MIN) return "TOO_SHORT";
  if (t.length > TITLE_MAX) return "TOO_LONG";
  const key = t.toLowerCase();
  if (TITLE_SKIP.has(key)) return "SKIP_LABEL";
  if (/https?:\/\//i.test(t) || /www\./i.test(t)) return "URL_LIKE";
  if (PHONE_SHAPE.test(t)) return "PHONE_LIKE";
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{2,4}$/.test(t)) return "DATE_LIKE";
  if (t.includes("@")) return "URL_LIKE";
  // A published result or a downloadable form is not an open post.
  if (RESULT_NOTICE_RE.test(t)) return "RESULT_NOTICE";
  if (FILE_LABEL_RE.test(t)) return "DOCUMENT_NOTICE";
  if (DOCUMENT_HEAD_RE.test(t)) return "DOCUMENT_NOTICE";
  if (DOCUMENT_NOTICE_RE.test(t)) return "DOCUMENT_NOTICE";
  if (PROCESS_NOTICE_RE.test(t)) return "PROCESS_NOTICE";
  // The employing organisation's own name, however it is punctuated, is never a
  // vacancy title. Checked after the notice rules so that a real notice whose
  // title ends in the entity name is still judged as a notice.
  if (ORGANISATION_NAME_RE.test(t)) return "ORGANISATION_NAME";
  // A multi-clause sentence is prose, not a position.
  if (t.split(/[.!?]/).filter((s) => s.trim().length > 0).length > 2) return "GENERIC_SENTENCE";
  if (t.length > TITLE_MAX) return "TOO_LONG";
  // A wall of text is a requirements block that leaked into the title slot.
  if (t.split(/\s+/).length > 14) return "REQUIREMENTS_BLOCK";
  return "";
}

export function isAssertableJobTitle(raw: string | null | undefined): boolean {
  return titleRejection(raw) === "";
}

/**
 * Remove HTML comments before any structure is read.
 *
 * Commented-out markup is not rendered, so it cannot be a vacancy. The live
 * pilot found a footer template on a real microfinance site where the entire
 * `Chief Information Officer` block — name, mobile, phone, email — sat inside
 * `<!-- ... -->`, and the parser read the dead template as a posting. Stripping
 * comments is a correctness requirement for reading any real page, not a
 * workaround for that one site.
 */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * An honorific followed by a name. The pilot read this on two real pages as
 * "vacancies": a News Highlights card titled `Information Officer` whose body
 * read `Mr. Jagya Prasad Panta`, and a footer block titled `Information/Grievance
 * Officer` naming the current holder with a mobile and email. Both announce who
 * HOLDS a statutory role. A posting says which role is OPEN, so an honorific
 * plus a name is evidence the record is a person announcement.
 */
export const PERSON_ANNOUNCEMENT_RE =
  /(?:^|\W)(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Shri|Sri|श्री|श्रीमती|श्रीमान)(?:\s+[A-Z][\p{L}']+){1,3}/u;

/**
 * Vocabulary that actually recruits. A record must declare at least one of these
 * to be an opening, rather than only naming a role. This is the second half of
 * the anchoring rule, and it exists because of the two real pages above: both
 * named a plausible role and neither said anything about how to apply.
 */
const APPLICATION_INVITATION_RE =
  /(?:applications?\s+(?:are\s+|is\s+)?(?:invited|invite[ds]?|called|sought|requested|open|accepted|welcomed)|invite[ds]?\s+(?:applications?|candidates?|qualified)|interested\s+(?:candidates|applicants)|apply\s+(?:by|on|for|now|to)|submit\s+(?:your\s+)?application|how\s+to\s+apply|applications?\s+open|योग्य\s+उम्मेदवार|आवेदन\s+(?:गर्न|का\s+लागि|निम्न)|रुचि\s+भएका)/i;

/**
 * Fields that describe an opening rather than merely naming a role. A posting
 * that says where, or to which department, or how to apply, has declared an
 * opening even when its title is generic.
 */
const RECRUITING_FIELDS: ReadonlySet<string> = new Set([
  LOCATION, DEPARTMENT, EMPLOYMENT_TYPE, REQUIREMENTS,
  EDUCATION, EXPERIENCE, APPLICATION_METHOD, APPLICATION_URL,
]);

/**
 * True when the record declares a recruiting attribute. A title alone is not one:
 * the live pilot turned a person's appointment into a vacancy purely from the
 * role noun in its heading.
 */
function recruitingSignal(rec: VacancyRecord, pageText?: string): boolean {
  if (rec.deadline !== null) return true;
  if (rec.application_url !== null) return true;
  if (rec.fields.some((f) => !f.rejection && RECRUITING_FIELDS.has(f.field))) return true;
  return pageText !== undefined && APPLICATION_INVITATION_RE.test(pageText);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Devanagari digits, so a Nepali notice is not silently unparseable. */
const NEPALI_DIGITS = "०१२३४५६७८९";

function toAsciiDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const i = NEPALI_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/**
 * Parse a date to ISO `YYYY-MM-DD`, or return null.
 *
 * `d1/d2/d2or4` is genuinely ambiguous, so the rule is stated rather than
 * guessed: a first component above 12 can only be a day, so it is read as
 * DD/MM. Otherwise the first component is read as the month. That is the
 * convention Nepali notices use, and it is deterministic either way.
 *
 * Returns null for anything unparseable, including "TBD", "31-02-2026" and
 * "2026-13-01". A malformed date is a validation failure, never a crash and
 * never a fabricated value.
 */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = toAsciiDigits(cleanText(raw)).replace(/[.\s]+$/, "").trim();
  if (!s) return null;

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const [d, mo] = a > 12 ? [a, b] : [b, a];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }

  // 15 Oct 2026 / Oct 15, 2026
  m = /^(\d{1,2})\s*([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) { const d = +m[1], y = +m[3];
      return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null; }
  }
  m = /^([A-Za-z]{3,9})\.?\s*(\d{1,2})\s*,?\s*(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) { const d = +m[2], y = +m[3];
      return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null; }
  }
  return null;
}

/** Any date-ish token, for finding a deadline in prose. */
export const DATE_TOKEN_RE =
  /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s*,?\s*\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}\s*,?\s*\d{4})/;

/**
 * A *validated* date token, and the only date test allowed to gate a record.
 *
 * `DATE_TOKEN_RE` alone is a trap: a Kathmandu phone number such as
 * `+977-1-5551234` contains the substring `7-1-555`, which the regex accepts
 * and `isRealDate` then rejects on the year. Gating on the regex therefore let a
 * contact page anchor a "vacancy" titled `Contact`. Gating on this function
 * cannot: it only reports a token that parses to a real date.
 */
export function hasPlausibleDate(text: string): boolean {
  const m = DATE_TOKEN_RE.exec(text);
  return m !== null && parseIsoDate(m[0]) !== null;
}

/**
 * Words that introduce a deadline. English + Devanagari.
 *
 * `मिति` on its own is NOT one of them. It means "date", not "closing date", and
 * the live pilot showed the cost of pretending otherwise: a cooperative's
 * `/careers/syllabus` page titles its exam plan with "परीक्षाको योजना, पाठ्यक्रम"
 * and dates the EXAM with `परीक्षा मिति`, which this marker read as an application
 * deadline. The deadline is now required to be a final date, an application date, a
 * submission date, or `म्याद`. An exam date is not a closing date.
 */
export const DEADLINE_MARKER_RE =
  /(?:deadline|last\s+date(?:\s+of\s+(?:submission|application))?|apply\s+by|closing\s+date|application\s+deadline|अन्तिम\s+मिति|अंतिम\s+मिति|आवेदन\s+म्याद|आवेदन\s+मिति|जमा\s+मिति|म्याद)/i;

// ---------------------------------------------------------------------------
// Email / URL
// ---------------------------------------------------------------------------

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Same shape the branch parser accepts, plus a 2+ letter TLD. */
export function isValidEmail(raw: string | null | undefined): boolean {
  const e = cleanText(raw).toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  const tld = e.slice(e.lastIndexOf(".") + 1);
  return /^[a-z]{2,}$/.test(tld);
}

export function extractEmail(text: string): string | null {
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.exec(cleanText(text));
  if (!m) return null;
  const candidate = m[0].toLowerCase();
  return isValidEmail(candidate) ? candidate : null;
}

/**
 * Accept only absolute https URLs. Rejecting http matters: the fetcher is
 * https-only, so an http application link could never be verified by this
 * pipeline and must not be presented as a working destination.
 */
export function isAssertableApplicationUrl(raw: string | null | undefined): boolean {
  const u = cleanText(raw);
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" && parsed.hostname.length > 0 && !parsed.hostname.includes(" ");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Employment type
// ---------------------------------------------------------------------------

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN";

/**
 * Map a raw token to the frozen four-value enum, or null.
 *
 * Returns null rather than defaulting to FULL_TIME. The `jobs` table defaults
 * that column, but defaulting invents an employment type nobody published.
 */
export function parseEmploymentType(raw: string | null | undefined): EmploymentType | null {
  const t = cleanText(raw).toLowerCase();
  if (!t) return null;
  if (/\b(full[\s-]?time|permanent|regular|नियमित)\b/.test(t)) return "FULL_TIME";
  if (/\b(part[\s-]?time|अंशिक\s*कालीन)\b/.test(t)) return "PART_TIME";
  if (/\b(contract|temporary|fixed[\s-]?term|contractual)\b/.test(t)) return "CONTRACT";
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "INTERN";
  return null;
}

export type ApplicationMethod = "EMAIL" | "ONLINE" | "IN_PERSON";

export function parseApplicationMethod(raw: string | null | undefined): ApplicationMethod | null {
  const t = cleanText(raw).toLowerCase();
  if (!t) return null;
  if (/\be-?mail\b|इमेल/.test(t)) return "EMAIL";
  if (/\bon-?line\b|वेबसाइट|अनलाइन/.test(t)) return "ONLINE";
  if (/\bin-?person\b|direct|office|कार्यालय/.test(t)) return "IN_PERSON";
  return null;
}

// ---------------------------------------------------------------------------
// Vacancy record
// ---------------------------------------------------------------------------

/** How a value was obtained. `column` values may assert; `text` may not. */
export interface VacancyField {
  field: string;
  value: string;
  support: "column" | "text" | "structure";
  /** Set when support === "text" and the value is deliberately unasserted. */
  evidenceOnly?: boolean;
  rejection?: string;
}

export interface VacancyRecord {
  title: string;
  location: string | null;
  department: string | null;
  employment_type: EmploymentType | null;
  published_date: string | null;
  deadline: string | null;
  deadline_support: DeadlineSupport | null;
  requirements: string | null;
  education: string | null;
  experience: string | null;
  application_method: ApplicationMethod | null;
  application_url: string | null;
  contact_email: string | null;
  /** URL the record was read from. Evidence, never identity. */
  page_url: string;
  /** Which grammar shape produced this record. */
  shape: "table" | "card" | "list" | "detail" | "json";
  /** Field-level values with their support, for planning writes. */
  fields: VacancyField[];
  /** Rejections, so a refused value is auditable instead of invisible. */
  rejections: { field: string; value: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Deterministic vacancy identity.
 *
 *   institution | normalized title | normalized location
 *
 * Not the URL (a vacancy moves). Not the date (a deadline gets extended, and an
 * extension must supersede, not fork; dates are also frequently absent). Not the
 * source (two sources must agree on one logical vacancy while keeping separate
 * provenance).
 *
 * Location is present when the source published it. A vacancy that first appears
 * with no location and later gains one forks into a new identity, because a
 * shared title alone does not prove they are the same posting. That is recorded
 * rather than smoothed over; merging on title alone is how two different jobs
 * become one.
 */
export function vacancyIdentityKey(
  institutionId: string,
  title: string,
  location?: string | null,
): string {
  const loc = identityKeyPart(location);
  return `${institutionId}|${identityKeyPart(title)}|${loc}`;
}

/** Stable id for a vacancy, matching the `branch-<entity>` convention. */
export function vacancyId(institutionId: string, title: string, location?: string | null): string {
  return `vacancy-${vacancyIdentityKey(institutionId, title, location)}`;
}

export function vacancySlug(title: string, location?: string | null): string {
  const base = [identityKeyPart(title), identityKeyPart(location)].filter(Boolean).join("-");
  return base || "vacancy";
}

/**
 * Fingerprint over the whole observed record, used to decide whether an
 * unchanged identity is actually unchanged. Dates are in here and deliberately
 * not in the identity: that is what lets a revised deadline be detected as a
 * change to an existing vacancy.
 */
export function vacancyFingerprint(r: VacancyRecord): string {
  return [
    r.title, r.location ?? "", r.department ?? "", r.employment_type ?? "",
    r.published_date ?? "", r.deadline ?? "", r.requirements ?? "",
    r.education ?? "", r.experience ?? "", r.application_method ?? "",
    r.application_url ?? "", r.contact_email ?? "",
  ].map((x) => identityKeyPart(x)).join("|");
}

// ===========================================================================
// Extraction grammar
//
// Six page shapes, one rule: a record is a vacancy only if it is ANCHORED
// (role noun, deadline, declared column, or detail structure) and yields an
// assertable title. Everything else is either page-level evidence or nothing.
// ===========================================================================

/** Table header text -> field. Longest/most specific labels first. */
const HEADER_FIELDS: ReadonlyArray<{ re: RegExp; field: string }> = [
  { re: /^(?:s\.?\s?n\.?|sr\.?\s*(?:no|number)|serial|क्र\.?\s*सं|क्रम)/i, field: "" }, // index, ignored
  { re: /(?:position|designation|post|job\s*title|title\s*of\s*post|p\.?\s*post|पद|पदनाम)/i, field: JOB_TITLE },
  { re: /(?:location|office|place|city|district|work\s*station|ठेगाना|स्थल|शहर)/i, field: LOCATION },
  { re: /(?:department|dept\.?|division|unit|section|विभाग|इकाई)/i, field: DEPARTMENT },
  { re: /(?:employment\s*type|job\s*type|type\s*of\s*employment|पद\s*प्रकार|प्रकार)/i, field: EMPLOYMENT_TYPE },
  { re: /(?:last\s*date(?:\s*of\s*(?:submission|application))?|deadline|apply\s*by|closing\s*date|अन्तिम\s*मिति|अंतिम\s*मिति|म्याद)/i, field: DEADLINE },
  { re: /(?:published(?:\s*date)?|posted(?:\s*(?:on|date))?|notice\s*date|प्रकाशन|प्रकाशित)/i, field: PUBLISHED_DATE },
  { re: /(?:requirement|qualification|योग्यता|आवश्यकता)/i, field: REQUIREMENTS },
  { re: /(?:education|academic(?:\s*qualification)?|शिक्षा|शैक्षिक)/i, field: EDUCATION },
  { re: /(?:experience|exp\.?|अनुभव)/i, field: EXPERIENCE },
  { re: /(?:how\s*to\s*apply|application\s*(?:method|process|mode)|apply\s*(?:at|to|via)|आवेदन\s*गतिविधि|आवेदन\s*विधि)/i, field: APPLICATION_METHOD },
  { re: /(?:email|e-?mail|इमेल|इमैल)/i, field: CONTACT_EMAIL },
  { re: /(?:apply|application|notice|download|विज्ञापन|आवेदन|डाउनलोड)/i, field: "NOTICE_LINK" },
];

/** Inline "Label: value" patterns, for cards and detail pages. */
const LABELLED: ReadonlyArray<{ re: RegExp; field: string }> = [
  { re: DEADLINE_MARKER_RE, field: DEADLINE },
  { re: /(?:published|posted|notice\s*date|प्रकाशन|प्रकाशित)\s*(?:date|on)?\s*[:：]/i, field: PUBLISHED_DATE },
  { re: /(?:location|office|work\s*station|ठेगाना|स्थल)\s*[:：]/i, field: LOCATION },
  { re: /(?:department|dept|division|विभाग)\s*[:：]/i, field: DEPARTMENT },
  { re: /(?:employment\s*type|job\s*type|पद\s*प्रकार)\s*[:：]/i, field: EMPLOYMENT_TYPE },
  { re: /(?:education|academic|शिक्षा)\s*[:：]/i, field: EDUCATION },
  { re: /(?:experience|अनुभव)\s*[:：]/i, field: EXPERIENCE },
  { re: /(?:requirement|qualification|योग्यता)\s*[:：]/i, field: REQUIREMENTS },
  { re: /(?:how\s*to\s*apply|apply\s*(?:at|to|via)|application\s*method|आवेदन)\s*[:：]/i, field: APPLICATION_METHOD },
  { re: /(?:email|e-?mail|इमेल)\s*[:：]/i, field: CONTACT_EMAIL },
];

const MAX_FIELD_LEN = 2000;

/**
 * Field name -> `VacancyRecord` property.
 *
 * The two layers deliberately use different casings: field names are the
 * assertion vocabulary (`"LOCATION"`, `"DEADLINE"`) and appear in the DB and in
 * conflict reports, while record properties are TypeScript camel_case. Writing a
 * field by indexing the record with its field name looks correct and silently
 * writes nothing, because `rec["LOCATION"]` is `undefined` rather than `null`.
 * Every assignment of a structural field therefore goes through this map.
 *
 * `JOB_TITLE` is absent on purpose: `title` is required and is assigned only by
 * the grammars that own it, never by this fallback.
 */
/** The `VacancyRecord` properties that hold a `string | null` field value. */
type FreeStringProp =
  | "location" | "department" | "employment_type" | "published_date"
  | "requirements" | "education" | "experience" | "application_method"
  | "application_url" | "contact_email";

const FIELD_TO_PROP: Readonly<Record<string, FreeStringProp>> = {
  [LOCATION]: "location",
  [DEPARTMENT]: "department",
  [EMPLOYMENT_TYPE]: "employment_type",
  [PUBLISHED_DATE]: "published_date",
  [REQUIREMENTS]: "requirements",
  [EDUCATION]: "education",
  [EXPERIENCE]: "experience",
  [APPLICATION_METHOD]: "application_method",
  [APPLICATION_URL]: "application_url",
  [CONTACT_EMAIL]: "contact_email",
};

/** Set `rec[prop] = v` if still unset, recording the field either way. */
function setFreeField(rec: VacancyRecord, name: string, value: string, support: VacancyField["support"]): void {
  const prop = FIELD_TO_PROP[name];
  if (!prop) return;
  if (rec[prop] !== null) return;
  const v = field(rec.fields, name, value, support);
  if (v === null) return;
  // One contained cast. `prop` is already narrowed to FreeStringProp, and every
  // name in FIELD_TO_PROP is a `string | null` property, so the write is sound;
  // TypeScript just cannot narrow a write through a union of keys.
  (rec as unknown as Record<string, string | null>)[prop] = v;
}

function field(
  out: VacancyField[],
  name: string,
  value: string | null,
  support: VacancyField["support"],
): string | null {
  const v = cleanText(value);
  if (!v) return null;
  if (v.length > MAX_FIELD_LEN) {
    out.push({ field: name, value: v.slice(0, 120), support, evidenceOnly: true, rejection: "TOO_LONG" });
    return null;
  }
  out.push({ field: name, value: v, support });
  return v;
}

/**
 * Extract a deadline, and report whether one was found.
 *
 * A deadline WORD must introduce the date. With no marker the function returns
 * nothing at all, rather than scanning for a bare date. The live pilot is why:
 * scanning the whole page for a date turned a blog teaser reading "August 5, 2026"
 * into a closing date, and an unlabelled date cannot be told apart from a
 * published date, a meeting date or a copyright year. This is the same rule the
 * field policy already states — never infer a deadline merely from prose — applied
 * to the extraction step that would otherwise do exactly that.
 *
 * The function does not decide how well the deadline is supported; the caller
 * does, because the caller knows whether it read a declared column or prose.
 */
function extractDeadline(
  text: string,
): { iso: string | null; raw: string | null; rejected: string | null } {
  const m = DEADLINE_MARKER_RE.exec(text);
  if (!m) return { iso: null, raw: null, rejected: null };
  const region = text.slice(m.index, m.index + 80);
  const token = DATE_TOKEN_RE.exec(region);
  if (!token) return { iso: null, raw: null, rejected: "DEADLINE_MARKER_WITHOUT_DATE" };
  const iso = parseIsoDate(token[0]);
  if (!iso) return { iso: null, raw: cleanText(token[0]), rejected: "UNPARSEABLE_DATE" };
  return { iso, raw: cleanText(token[0]), rejected: null };
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function emptyRecord(pageUrl: string, shape: VacancyRecord["shape"]): VacancyRecord {
  return {
    title: "", location: null, department: null, employment_type: null,
    published_date: null, deadline: null, deadline_support: null,
    requirements: null, education: null, experience: null,
    application_method: null, application_url: null, contact_email: null,
    page_url: pageUrl, shape, fields: [], rejections: [],
  };
}

/**
 * Text of each block-level element, in document order.
 *
 * Reading labels per block rather than per page is what keeps a value from
 * running into the next field. `cleanText` collapses the newlines between
 * `<p>Location: Kathmandu</p><p>Deadline: 2026-10-15</p>` into a single space,
 * so a page-level scan reads the location as "Kathmandu Deadline: 2026-10-15".
 * Inside one block the labels are genuinely adjacent and this cannot happen.
 */
function blockTexts(html: string): string[] {
  const out: string[] = [];
  const re = /<(p|li|dd|dt|td|th|div|span|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = cleanText(m[2]);
    if (t) out.push(t);
  }
  return out;
}

/** One labelled hit: where the label ends, and where the next one begins. */
interface LabelledHit {
  name: string;
  labelStart: number;
  valueStart: number;
}

function labelledHits(text: string): LabelledHit[] {
  const hits: LabelledHit[] = [];
  for (const { re, field: name } of LABELLED) {
    const re2 = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re2.exec(text)) !== null) {
      hits.push({ name, labelStart: m.index, valueStart: m.index + m[0].length });
      if (m.index === re2.lastIndex) re2.lastIndex += 1;
    }
  }
  hits.sort((a, b) => a.valueStart - b.valueStart);
  return hits;
}

/** Apply inline labelled fields found in one block of a record's text. */
function applyLabelledBlock(rec: VacancyRecord, text: string): void {
  const hits = labelledHits(text);
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const name = hit.name;
    // The value ends where the next label starts, so one block can carry several
    // fields without one bleeding into the next.
    const nextStart = i + 1 < hits.length ? hits[i + 1].labelStart : text.length;
    const hardEnd = hit.valueStart + 160;
    const end = Math.min(nextStart, hardEnd);
    const raw = text.slice(hit.valueStart, end);
    const stop = raw.search(/\s{2,}|(?:\s+[|–—•]\s+)|\s\|\s/);
    const slice = cleanText(stop >= 0 ? raw.slice(0, stop) : raw);
    if (!slice) continue;

    if (name === DEADLINE) {
      if (rec.deadline) continue;
      const d = extractDeadline(slice);
      if (d.iso) {
        rec.deadline = d.iso;
        rec.deadline_support = "text";
        rec.fields.push({ field: DEADLINE, value: d.iso, support: "text", evidenceOnly: true });
      } else if (d.rejected) {
        rec.rejections.push({ field: DEADLINE, value: d.raw ?? slice, reason: d.rejected });
        rec.fields.push({ field: DEADLINE, value: d.raw ?? slice, support: "text", evidenceOnly: true, rejection: d.rejected });
      }
      continue;
    }
    if (name === CONTACT_EMAIL) {
      if (rec.contact_email) continue;
      const email = extractEmail(slice);
      if (email) { rec.contact_email = email; field(rec.fields, CONTACT_EMAIL, email, "text"); }
      else rec.rejections.push({ field: CONTACT_EMAIL, value: slice, reason: "INVALID_EMAIL" });
      continue;
    }
    if (name === EMPLOYMENT_TYPE) {
      if (rec.employment_type) continue;
      const t = parseEmploymentType(slice);
      if (t) { rec.employment_type = t; field(rec.fields, EMPLOYMENT_TYPE, t, "text"); }
      else rec.rejections.push({ field: EMPLOYMENT_TYPE, value: slice, reason: "UNKNOWN_EMPLOYMENT_TYPE" });
      continue;
    }
    if (name === APPLICATION_METHOD) {
      if (rec.application_method) continue;
      const t = parseApplicationMethod(slice);
      if (t) { rec.application_method = t; field(rec.fields, APPLICATION_METHOD, t, "text"); }
      continue;
    }
    if (name === PUBLISHED_DATE) {
      if (rec.published_date) continue;
      const iso = parseIsoDate(slice);
      if (iso) { rec.published_date = iso; field(rec.fields, PUBLISHED_DATE, iso, "text"); }
      else rec.rejections.push({ field: PUBLISHED_DATE, value: slice, reason: "UNPARSEABLE_DATE" });
      continue;
    }
    setFreeField(rec, name, slice, "text");
  }
}

/** Apply labelled fields across every block of a fragment. */
function applyLabelled(rec: VacancyRecord, html: string): void {
  for (const block of blockTexts(html)) applyLabelledBlock(rec, block);
}

// ---------------------------------------------------------------------------
// Shape B — HTML table
// ---------------------------------------------------------------------------

/** Parse `<tr>` rows, preserving cell order and the header row when present. */
function tableRows(html: string): { cells: string[]; raw: string }[] {
  const out: { cells: string[]; raw: string }[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = trRe.exec(html)) !== null) {
    const rowRaw = rm[1];
    const cells: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rowRaw)) !== null) cells.push(cleanText(cm[1]));
    if (cells.length > 0) out.push({ cells, raw: rowRaw });
  }
  return out;
}

/** Map a header row to a field per column index. `null` where unmapped. */
function headerMap(cells: string[]): (string | null)[] {
  return cells.map((c) => {
    for (const { re, field: f } of HEADER_FIELDS) if (re.test(c)) return f === "" ? null : f;
    return null;
  });
}

/** True when a header row describes candidates rather than posts. */
function isResultHeader(cells: string[]): boolean {
  return cells.some((c) => RESULT_HEADER_RE.test(c));
}

export function parseVacancyTable(html: string, pageUrl: string): VacancyRecord[] {
  const rows = tableRows(html);
  if (rows.length < 2) return [];

  // Header detection: a row whose cells mostly resolve to known fields.
  let map: (string | null)[] | null = null;
  let start = 0;
  let isResult = false;
  for (let i = 0; i < Math.min(rows.length, 3); i += 1) {
    const candidate = headerMap(rows[i].cells);
    const known = candidate.filter((x) => x !== null).length;
    if (known >= 2 && known >= rows[i].cells.length / 2) {
      map = candidate;
      start = i + 1;
      isResult = isResultHeader(rows[i].cells);
      break;
    }
  }

  // A merit list names candidates in the same row as the post they applied for.
  // Publishing those rows as vacancies would invent open jobs that are closed.
  if (isResult) return [];

  const out: VacancyRecord[] = [];
  const seen = new Set<string>();

  for (let i = start; i < rows.length; i += 1) {
    const { cells, raw } = rows[i];
    if (cells.length < 2) continue;
    const rec = emptyRecord(pageUrl, "table");

    if (map) {
      for (let c = 0; c < cells.length && c < map.length; c += 1) {
        const name = map[c];
        const value = cells[c];
        if (!name || !value) continue;
        if (name === "NOTICE_LINK") {
          const href = /href\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
          const abs = href ? resolveUrl(href, pageUrl) : null;
          if (abs && isAssertableApplicationUrl(abs)) {
            rec.application_url = abs;
            rec.fields.push({ field: APPLICATION_URL, value: abs, support: "structure" });
          }
          continue;
        }
        // A deadline in a DECLARED COLUMN is structurally supported. This is the
        // distinction the whole design turns on.
        if (name === DEADLINE) {
          const iso = parseIsoDate(value);
          if (iso) {
            rec.deadline = iso;
            rec.deadline_support = "column";
            rec.fields.push({ field: DEADLINE, value: iso, support: "column" });
          } else {
            rec.rejections.push({ field: DEADLINE, value, reason: "UNPARSEABLE_DATE" });
            rec.fields.push({ field: DEADLINE, value, support: "column", evidenceOnly: true, rejection: "UNPARSEABLE_DATE" });
          }
          continue;
        }
        if (name === JOB_TITLE) {
          const rej = titleRejection(value);
          if (rej) {
            rec.rejections.push({ field: JOB_TITLE, value, reason: rej });
            continue;
          }
          rec.title = value;
          rec.fields.push({ field: JOB_TITLE, value, support: "column" });
          continue;
        }
        if (name === EMPLOYMENT_TYPE) {
          const t = parseEmploymentType(value);
          if (t) { rec.employment_type = t; field(rec.fields, EMPLOYMENT_TYPE, t, "column"); }
          else rec.rejections.push({ field: EMPLOYMENT_TYPE, value, reason: "UNKNOWN_EMPLOYMENT_TYPE" });
          continue;
        }
        if (name === PUBLISHED_DATE) {
          const iso = parseIsoDate(value);
          if (iso) { rec.published_date = iso; field(rec.fields, PUBLISHED_DATE, iso, "column"); }
          else rec.rejections.push({ field: PUBLISHED_DATE, value, reason: "UNPARSEABLE_DATE" });
          continue;
        }
        if (name === CONTACT_EMAIL) {
          const e = extractEmail(value);
          if (e) { rec.contact_email = e; field(rec.fields, CONTACT_EMAIL, e, "column"); }
          else rec.rejections.push({ field: CONTACT_EMAIL, value, reason: "INVALID_EMAIL" });
          continue;
        }
        if (name === APPLICATION_METHOD) {
          const t = parseApplicationMethod(value);
          if (t) { rec.application_method = t; field(rec.fields, APPLICATION_METHOD, t, "column"); }
          continue;
        }
        setFreeField(rec, name, value, "column");
      }
    }


    // No usable header: find the title by anchoring. The first cell carrying a
    // role noun is the position; everything else in the row is scanned for a
    // deadline and a location.
    if (!rec.title) {
      const idx = cells.findIndex((c) => JOB_ROLE_RE.test(c) && isAssertableJobTitle(c));
      if (idx >= 0) {
        rec.title = cells[idx];
        rec.fields.push({ field: JOB_TITLE, value: cells[idx], support: "structure" });
      }
    }

    if (!rec.deadline) {
      for (const c of cells) {
        const d = extractDeadline(c);
        if (d.iso) {
          rec.deadline = d.iso;
          rec.deadline_support = "text";
          rec.fields.push({ field: DEADLINE, value: d.iso, support: "text", evidenceOnly: true });
          break;
        }
      }
    }
    // Each cell is its own block, so a multi-column row cannot merge two
    // labelled fields into one value.
    for (const c of cells) applyLabelledBlock(rec, c);

    if (!isAssertableJobTitle(rec.title)) continue;
    // Anchor: a role noun, a supported deadline, or a declared title column.
    if (!JOB_ROLE_RE.test(rec.title) && !rec.deadline) continue;

    const key = vacancyIdentityKey("?", rec.title, rec.location);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape A — vacancy cards
// ---------------------------------------------------------------------------

/**
 * Cards are heading-delimited blocks. A heading that looks like a position starts
 * a record; the following markup is the record's body until the next such
 * heading. This is the same segmentation idea as the M3.4 branch card parser,
 * applied to vacancies rather than places.
 */
export function parseVacancyCards(html: string, pageUrl: string): VacancyRecord[] {
  const blockRe = /<(h[2-5])\b[^>]*>([\s\S]*?)<\/\1>([\s\S]*?)(?=<h[2-5]\b|$)/gi;
  const out: VacancyRecord[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(html)) !== null) {
    const heading = cleanText(m[2]);
    const body = m[3];
    const rejection = titleRejection(heading);
    if (rejection) continue;
    // A heading only starts a vacancy card if it names a role, or its body
    // carries a DEADLINE LABEL. A bare plausible date is deliberately not enough:
    // a news or blog teaser carries its own publish date, and the live pilot read
    // "How Much Should You Save?" off a homepage that way. A bare date cannot
    // distinguish a closing date from a posted-on date, so it does not anchor.
    if (!JOB_ROLE_RE.test(heading) && !DEADLINE_MARKER_RE.test(body)) continue;

    const rec = emptyRecord(pageUrl, "card");
    rec.title = heading;
    rec.fields.push({ field: JOB_TITLE, value: heading, support: "structure" });

    const bodyText = cleanText(body);
    const d = extractDeadline(bodyText);
    if (d.iso) {
      rec.deadline = d.iso;
      rec.deadline_support = "text";
      rec.fields.push({ field: DEADLINE, value: d.iso, support: "text", evidenceOnly: true });
    } else if (d.rejected) {
      rec.rejections.push({ field: DEADLINE, value: d.raw ?? "", reason: d.rejected });
    }
    applyLabelled(rec, body);

    const email = extractEmail(bodyText);
    if (email && !rec.contact_email) { rec.contact_email = email; field(rec.fields, CONTACT_EMAIL, email, "structure"); }

    const href = /href\s*=\s*["']([^"']+)["']/i.exec(body)?.[1];
    if (href) {
      const abs = resolveUrl(href, pageUrl);
      const isApplyLink = /apply|notice|detail|download|vacanc|job|apply/i.test(href) || /apply|apply now|विवरण/i.test(bodyText);
      if (abs && isApplyLink && isAssertableApplicationUrl(abs)) {
        rec.application_url = abs;
        rec.fields.push({ field: APPLICATION_URL, value: abs, support: "structure" });
      }
    }

    if (!isAssertableJobTitle(rec.title)) continue;
    // A person announcement is not a vacancy, and a heading that only names a
    // role has not declared an opening. Both were read as vacancies on real
    // pages during the pilot.
    if (PERSON_ANNOUNCEMENT_RE.test(bodyText)) continue;
    if (!recruitingSignal(rec, bodyText)) continue;
    const key = vacancyIdentityKey("?", rec.title, rec.location);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape C — vacancy list of links
// ---------------------------------------------------------------------------

/**
 * A list of links, each pointing at one vacancy. The link text is the title and
 * the link target is the evidence location. This shape deliberately produces
 * records that may carry only a title: a link labelled "Senior Officer" with no
 * date is still a vacancy, and its detail page is a separate fetch.
 */
export function parseVacancyList(html: string, pageUrl: string): VacancyRecord[] {
  const out: VacancyRecord[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = anchorRe.exec(html)) !== null) {
    const text = cleanText(m[2]);
    if (!isAssertableJobTitle(text)) continue;
    if (!JOB_ROLE_RE.test(text)) continue;
    // A bare role noun with no deadline and no vacancy vocabulary around it is
    // probably nav. Require one of them.
    const around = cleanText(html.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200));
    if (!DEADLINE_MARKER_RE.test(around) && !hasPlausibleDate(around) && !/vacanc|career|job|recruit/i.test(around)) continue;
    // The pilot read `Information Officer` off a homepage this way, from a card
    // naming the person currently in the role. A link to a person is not a link
    // to an opening.
    if (PERSON_ANNOUNCEMENT_RE.test(around)) continue;

    const abs = resolveUrl(m[1], pageUrl);
    if (!abs) continue;
    const rec = emptyRecord(abs, "list");
    rec.title = text;
    rec.fields.push({ field: JOB_TITLE, value: text, support: "structure" });
    const d = extractDeadline(around);
    if (d.iso) {
      rec.deadline = d.iso;
      rec.deadline_support = "text";
      rec.fields.push({ field: DEADLINE, value: d.iso, support: "text", evidenceOnly: true });
    }
    const email = extractEmail(around);
    if (email) { rec.contact_email = email; field(rec.fields, CONTACT_EMAIL, email, "text"); }

    const key = vacancyIdentityKey("?", rec.title, null);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape D — individual vacancy page
// ---------------------------------------------------------------------------

export function parseVacancyDetail(html: string, pageUrl: string): VacancyRecord[] {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  const heading = cleanText(h1?.[1] ?? h2?.[1] ?? "");
  const rejection = titleRejection(heading);
  if (rejection) return [];

  const rec = emptyRecord(pageUrl, "detail");
  rec.title = heading;
  rec.fields.push({ field: JOB_TITLE, value: heading, support: "structure" });

  const text = cleanText(html);
  const d = extractDeadline(text);
  if (d.iso) {
    rec.deadline = d.iso;
    rec.deadline_support = "text";
    rec.fields.push({ field: DEADLINE, value: d.iso, support: "text", evidenceOnly: true });
  } else if (d.rejected) {
    rec.rejections.push({ field: DEADLINE, value: d.raw ?? "", reason: d.rejected });
  }
  applyLabelled(rec, html);
  const email = extractEmail(text);
  if (email && !rec.contact_email) { rec.contact_email = email; field(rec.fields, CONTACT_EMAIL, email, "structure"); }

  // A detail page must be ANCHORED by more than its h1. On a homepage the h1 is
  // the organisation's own name, and the live pilot read exactly that as a
  // vacancy title. A real posting is anchored by a role noun in its title, a
  // parsed deadline, an application link, or a declared detail field.
  if (!detailAnchored(rec)) return [];
  // It must then also DECLARE an opening. A heading that only names a role is
  // how the pilot read a footer block naming the current Information Officer.
  if (PERSON_ANNOUNCEMENT_RE.test(text)) return [];
  if (!recruitingSignal(rec, text)) return [];

  return [rec];
}

/** Fields that only appear on a structured posting, not on generic page chrome. */
const DETAIL_STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  LOCATION, DEPARTMENT, EMPLOYMENT_TYPE, PUBLISHED_DATE, REQUIREMENTS,
  EDUCATION, EXPERIENCE, APPLICATION_METHOD, APPLICATION_URL,
]);

function detailAnchored(rec: VacancyRecord): boolean {
  if (JOB_ROLE_RE.test(rec.title)) return true;
  if (rec.deadline !== null) return true;
  if (rec.application_url !== null) return true;
  return rec.fields.some((f) => !f.rejection && DETAIL_STRUCTURAL_FIELDS.has(f.field));
}

// ---------------------------------------------------------------------------
// Shape F — JSON / API
// ---------------------------------------------------------------------------

const JSON_TITLE_KEYS = ["title", "position", "positionName", "position_name", "jobTitle", "job_title", "vacancy", "vacancy_name", "designation"];
const JSON_LOCATION_KEYS = ["location", "office", "place", "city", "district", "workStation", "work_station"];
const JSON_DEPARTMENT_KEYS = ["department", "dept", "division", "unit", "section"];
const JSON_DEADLINE_KEYS = ["deadline", "appliedBefore", "apply_before", "lastDate", "last_date", "closingDate", "last_date_of_submission"];
const JSON_PUBLISHED_KEYS = ["published", "publishedAt", "published_at", "postedAt", "posted_at", "noticeDate", "notice_date"];
const JSON_TYPE_KEYS = ["employmentType", "employment_type", "jobType", "job_type", "type"];
const JSON_EMAIL_KEYS = ["email", "contactEmail", "contact_email", "applyEmail", "apply_email"];
const JSON_URL_KEYS = ["applyUrl", "apply_url", "applicationUrl", "application_url", "portalUrl", "portal_url", "link", "url"];
const JSON_EDUCATION_KEYS = ["education", "educationLevel", "education_level", "academicQualification"];
const JSON_EXPERIENCE_KEYS = ["experience", "experienceRequired", "experience_required", "exp"];
const JSON_REQUIREMENTS_KEYS = ["requirements", "qualification", "qualifications", "criteria"];
const JSON_METHOD_KEYS = ["applicationMethod", "application_method", "howToApply", "how_to_apply", "applyMethod"];

function pickString(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && cleanText(v)) return cleanText(v);
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Shape F. A public JSON endpoint is structured data, so its fields carry the
 * same weight as a declared table column. `vacancyAvailable` false is honoured
 * as a closed marker, and a record with no title is refused outright.
 */
export function parseVacancyJson(items: readonly unknown[], pageUrl: string): VacancyRecord[] {
  const out: VacancyRecord[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const title = pickString(item, JSON_TITLE_KEYS);
    if (!isAssertableJobTitle(title)) continue;

    const rec = emptyRecord(pageUrl, "json");
    rec.title = title as string;
    rec.fields.push({ field: JOB_TITLE, value: title as string, support: "structure" });

    const loc = pickString(item, JSON_LOCATION_KEYS);
    if (loc) { rec.location = loc; field(rec.fields, LOCATION, loc, "structure"); }
    const dept = pickString(item, JSON_DEPARTMENT_KEYS);
    if (dept) { rec.department = dept; field(rec.fields, DEPARTMENT, dept, "structure"); }

    const dl = pickString(item, JSON_DEADLINE_KEYS);
    if (dl) {
      const iso = parseIsoDate(dl);
      if (iso) {
        rec.deadline = iso;
        rec.deadline_support = "column"; // structured source, like a declared column
        rec.fields.push({ field: DEADLINE, value: iso, support: "column" });
      } else {
        rec.rejections.push({ field: DEADLINE, value: dl, reason: "UNPARSEABLE_DATE" });
        rec.fields.push({ field: DEADLINE, value: dl, support: "column", evidenceOnly: true, rejection: "UNPARSEABLE_DATE" });
      }
    }
    const pub = pickString(item, JSON_PUBLISHED_KEYS);
    if (pub) {
      const iso = parseIsoDate(pub);
      if (iso) { rec.published_date = iso; field(rec.fields, PUBLISHED_DATE, iso, "structure"); }
      else rec.rejections.push({ field: PUBLISHED_DATE, value: pub, reason: "UNPARSEABLE_DATE" });
    }
    const t = pickString(item, JSON_TYPE_KEYS);
    if (t) {
      const et = parseEmploymentType(t);
      if (et) { rec.employment_type = et; field(rec.fields, EMPLOYMENT_TYPE, et, "structure"); }
    }
    const edu = pickString(item, JSON_EDUCATION_KEYS);
    if (edu) { rec.education = edu; field(rec.fields, EDUCATION, edu, "structure"); }
    const exp = pickString(item, JSON_EXPERIENCE_KEYS);
    if (exp) { rec.experience = exp; field(rec.fields, EXPERIENCE, exp, "structure"); }
    const req = pickString(item, JSON_REQUIREMENTS_KEYS);
    if (req) { rec.requirements = req; field(rec.fields, REQUIREMENTS, req, "structure"); }
    const met = pickString(item, JSON_METHOD_KEYS);
    if (met) {
      const am = parseApplicationMethod(met);
      if (am) { rec.application_method = am; field(rec.fields, APPLICATION_METHOD, am, "structure"); }
    }
    const em = pickString(item, JSON_EMAIL_KEYS);
    if (em) {
      const e = extractEmail(em);
      if (e) { rec.contact_email = e; field(rec.fields, CONTACT_EMAIL, e, "structure"); }
      else rec.rejections.push({ field: CONTACT_EMAIL, value: em, reason: "INVALID_EMAIL" });
    }
    const url = pickString(item, JSON_URL_KEYS);
    if (url) {
      const abs = resolveUrl(url, pageUrl);
      if (abs && isAssertableApplicationUrl(abs)) { rec.application_url = abs; field(rec.fields, APPLICATION_URL, abs, "structure"); }
    }

    const key = vacancyIdentityKey("?", rec.title, rec.location);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page analysis — the one entry point a fetcher needs
// ---------------------------------------------------------------------------

export interface CareerPageAnalysis {
  shape: CareerShape;
  reason: string;
  counts: CareerShapeCounts;
  records: VacancyRecord[];
  /** Visible text length, the only thing worth storing from an unread page. */
  visibleTextLength: number;
  title: string;
}

/**
 * Analyse one fetched career response.
 *
 * Shape selection is structural, and the order is the precedence already
 * documented on `classifyCareerShape`. Table beats card beats list beats detail:
 * a real table is stronger evidence than a heading-delimited heuristic, so it is
 * tried first and a weaker shape is only accepted when the stronger one yields
 * nothing.
 */
export function analyzeCareerPage(input: {
  body: Uint8Array | null;
  contentType?: string | null;
  url: string;
  httpStatus: number;
  /** Pre-parsed JSON items, for Shape F. */
  json?: readonly unknown[];
}): CareerPageAnalysis {
  const contentType = (input.contentType ?? "").toLowerCase();
  const isDocument = contentType.includes("application/pdf") || /\.pdf(?:$|[?#])/i.test(input.url);
  const bytes = input.body ?? new Uint8Array();
  const text = isDocument ? "" : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const html = isDocument ? text : stripComments(text);
  const rawHtml = text;

  const visible = cleanText(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));
  const scriptCount = (rawHtml.match(/<script\b/gi) ?? []).length;
  const noscriptCount = (rawHtml.match(/<noscript\b/gi) ?? []).length;
  const jsRenderedIndicators =
    ((rawHtml.match(/\b(?:react|vue|angular|next\/|nuxt|__next|window\.__|application\/ld\+json)/gi) ?? []).length +
      (rawHtml.match(/<div[^>]+id\s*=\s*["'](?:root|app|__next)["']/gi) ?? []).length) -
    // A commented-out SPA bootstrap is not evidence that the page needs a browser,
    // so template markers found only inside comments do not count toward rendering.
    ((rawHtml.match(/<!--[\s\S]*?-->/g) ?? []).join(" ").match(/\b(?:react|vue|angular|next\/|nuxt|__next|window\.__|application\/ld\+json)/gi) ?? []).length;
  // Counted on comment-stripped HTML, for the same reason: a commented-out script is
  // not one this page runs. The URL of each request is read from the same extractor
  // the pilot uses to discover endpoints, so one implementation decides both what
  // counts as a data load and what may later be fetched.
  const requestCalls = extractEndpointCandidates(html, input.url, "inline");
  const requestCallCount = (html.match(REQUEST_CALL_RE) ?? []).length;
  const clientDataLoadHits = requestCalls.filter(
    (c) =>
      c.sameOriginHttps &&
      isRequestCallPattern(c.pattern) &&
      (!NON_CONTENT_REQUEST_RE.test(c.raw) || CONTENT_REQUEST_HINT_RE.test(c.raw)),
  ).length;

  // Shape F first when JSON items are supplied.
  const jsonRecords = input.json ? parseVacancyJson(input.json, input.url) : [];
  const structuredJson = input.json !== undefined;
  const tableRecords = isDocument || structuredJson ? [] : parseVacancyTable(html, input.url);
  const cardRecords = isDocument || structuredJson || tableRecords.length > 0 ? [] : parseVacancyCards(html, input.url);
  const listRecords = isDocument || structuredJson || tableRecords.length > 0 || cardRecords.length > 0 ? [] : parseVacancyList(html, input.url);
  const detailRecords = isDocument || structuredJson || tableRecords.length > 0 || cardRecords.length > 0 || listRecords.length > 0
    ? [] : parseVacancyDetail(html, input.url);

  const records = jsonRecords.length > 0 ? jsonRecords
    : tableRecords.length > 0 ? tableRecords
    : cardRecords.length > 0 ? cardRecords
    : listRecords.length > 0 ? listRecords
    : detailRecords;

  // A JSON payload's "visible text" is its serialised items. Measuring the raw
  // response instead would report the length of `[` and treat a full endpoint as
  // an empty page.
  const measured = structuredJson ? JSON.stringify(input.json ?? []) : visible;
  // The same text with page furniture removed, for the one measurement that must
  // not be satisfied by a menu label.
  const sectionText = structuredJson ? measured : cleanText(stripChrome(html).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " "));

  const counts: CareerShapeCounts = {
    visibleTextLength: measured.length,
    scriptCount,
    noscriptCount,
    jsRenderedIndicators,
    clientDataLoadHits,
    requestCallCount,
    tableCount: (html.match(/<table\b/gi) ?? []).length,
    recordTableCount: tableRecords.length > 0 ? 1 : 0,
    candidateVacancies: records.length,
    careerVocabHits: countHits(measured, CAREER_VOCAB),
    careerSectionHits: countHits(sectionText, CAREER_VOCAB),
    resultVocabHits: countHits(measured, RESULT_VOCAB),
    jobRoleHits: (measured.match(new RegExp(JOB_ROLE_RE.source, "gi")) ?? []).length,
    structuredJson,
    isDocument,
    httpStatus: input.httpStatus,
  };

  const verdict = classifyCareerShape(counts);
  // A page classified as NOT_A_CAREER_PAGE or a result page must publish no
  // vacancies even if the grammar found something. Shape gates records, not the
  // other way round.
  const publishable =
    verdict.shape === "VACANCY_LIST" || verdict.shape === "SINGLE_VACANCY_DETAIL" ? records : [];

  return {
    shape: verdict.shape,
    reason: verdict.reason,
    counts,
    records: publishable,
    visibleTextLength: visible.length,
    title: cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
  };
}

