// ============================================================================
// M3.5 — Generic mapper for a same-origin JSON vacancy endpoint.
//
// The shape this was written for is an object holding exactly one array, whose
// items carry their content as an HTML string:
//
//   {"pagecontent":[{"id":9,"date":"2025-10-16","description":"<p>…</p>"}]}
//
// That is a contract, and it is handled generically: nothing below names an
// institution, a host, a path or a field name. The envelope may be a bare array, or
// an object with one or several array-valued keys; the content may sit in
// `description`, `body`, `content`, or a name nobody has seen yet, because a string
// containing markup is content whatever it is called. The same code therefore serves
// any endpoint of this kind, and a site that changes its field names keeps working.
//
// What this module will NOT do is read a vacancy out of a string that does not
// contain one. The endpoint that motivated this work returns a paragraph whose sole
// content is a link to a third-party recruitment portal, and the honest result of
// mapping it is zero vacancies plus a recorded off-site pointer. A mapper that found
// a job there would be inventing one.
//
// Remote text is untrusted input. A description is a string from someone else's
// server that may contain an instruction, a prompt aimed at a future reader, or
// markup meant for a browser. It is treated here as bytes to be parsed, never as
// instructions, and a record may only be asserted from structurally anchored fields.
// ============================================================================

import { analyzeCareerPage, cleanText, type VacancyRecord } from "./careers";

/** How the payload was shaped, for the registry and for a human reviewing it. */
export type EnvelopeShape =
  | "ARRAY"
  | "SINGLE_ARRAY_KEY"
  | "MULTI_ARRAY_KEY"
  | "OBJECT_NO_ARRAY"
  | "NOT_AN_ARRAY"
  | "EMPTY";

export interface EnvelopeDescription {
  shape: EnvelopeShape;
  /** The one array-valued key, when there is exactly one. */
  arrayKey: string | null;
  /** Every array-valued key, when there is more than one. */
  arrayKeys: string[];
  itemCount: number;
  /** Names of the fields on the first item, for review. Never their values. */
  firstItemFields: string[];
}

const MARKUP_RE = /<\/?[a-z][^>]*>/i;
/** C0 controls and DEL, which no title legitimately contains. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** The entity forms of `<` and `>`, named or numeric, decimal or hex. */
const ANGLE_ENTITY_RE = /&(?:lt|gt|#0*60|#0*62|#x0*3c|#x0*3e);/i;

/**
 * Whether a title would become markup if anything downstream decoded it.
 *
 * The stored value is never rewritten — it stays exactly as the server sent it,
 * because a value that differs from its source is a value nobody can trace. This
 * is only a test, and it exists because entity-escaped markup is the form that
 * survives text extraction intact: a title reading
 * `&lt;img src=x onerror=alert(1)&gt;Trainee Assistant` contains no `<` and so
 * passes any test that only looks for one, yet decodes to an `<img>` the moment
 * it is assigned to innerHTML.
 */
function decodesToMarkup(value: string): boolean {
  if (MARKUP_RE.test(value)) return true;
  if (!ANGLE_ENTITY_RE.test(value)) return false;
  const decoded = value
    .replace(/&lt;|&#0*60;|&#x0*3c;/gi, "<")
    .replace(/&gt;|&#0*62;|&#x0*3e;/gi, ">");
  return MARKUP_RE.test(decoded);
}

/**
 * Describe a parsed JSON payload without asserting anything about it.
 *
 * Field NAMES are reported because naming the contract is the point of this
 * investigation. Field VALUES are not, because a value from a remote server is
 * untrusted content and the summary must not read as if it were verified data.
 */
export function describeEnvelope(value: unknown): EnvelopeDescription {
  const empty: EnvelopeDescription = { shape: "NOT_AN_ARRAY", arrayKey: null, arrayKeys: [], itemCount: 0, firstItemFields: [] };
  if (Array.isArray(value)) {
    return {
      shape: "ARRAY",
      arrayKey: null,
      arrayKeys: [],
      itemCount: value.length,
      firstItemFields: itemFields(value[0]),
    };
  }
  if (value === null || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  const arrayKeys = Object.keys(record).filter((k) => Array.isArray(record[k]));
  const base = { arrayKeys, itemCount: 0, firstItemFields: [] as string[] };
  if (arrayKeys.length === 1) {
    const items = record[arrayKeys[0]] as unknown[];
    // An envelope that is present, well-formed and empty is its own shape. It is
    // reported separately from a payload that merely has items, because the two
    // mean opposite things: "there are no vacancies here" versus "here are none,
    // and the site has said so".
    if (items.length === 0) {
      return { shape: "EMPTY", arrayKey: arrayKeys[0], ...base, itemCount: 0, firstItemFields: [] };
    }
    return { shape: "SINGLE_ARRAY_KEY", arrayKey: arrayKeys[0], ...base, itemCount: items.length, firstItemFields: itemFields(items[0]) };
  }
  if (arrayKeys.length > 1) {
    const items = record[arrayKeys[0]] as unknown[];
    return { shape: "MULTI_ARRAY_KEY", arrayKey: null, ...base, itemCount: items.length, firstItemFields: itemFields(items[0]) };
  }
  return { shape: "OBJECT_NO_ARRAY", arrayKey: null, ...base };
}

function itemFields(item: unknown): string[] {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
  return Object.keys(item as Record<string, unknown>).slice(0, 24);
}

/**
 * The HTML fragments carried by one item, if any.
 *
 * Any string value containing markup qualifies. The field name is not consulted:
 * `description`, `body`, `content` and `html` are the same thing to this mapper, and
 * a site that invents a sixth name should still work. The value must be a
 * non-trivial fragment — a bare `<` is not content.
 */
export function htmlFragmentsOf(item: unknown, minLength = 20): string[] {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
  const out: string[] = [];
  for (const v of Object.values(item as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s.length < minLength) continue;
    if (!MARKUP_RE.test(s)) continue;
    out.push(s);
  }
  return out;
}

export interface EnvelopeMapping {
  description: EnvelopeDescription;
  records: VacancyRecord[];
  /** Fragments fed to the HTML grammar, for the audit trail. */
  fragmentCount: number;
  /**
   * Links a fragment points at, same-site only. This is how a payload that only
   * links elsewhere is reported: the vacancy is not here, and this says where the
   * page says it is — without following it.
   */
  offSiteLinks: string[];
  warnings: string[];
}

/**
 * Map a parsed payload to vacancy records through the existing HTML grammar.
 *
 * No new grammar is introduced. Whatever a JSON endpoint's items contain, the HTML
 * that produced every other record in this milestone is what decides whether a
 * record exists, so a JSON source cannot produce a record that an HTML source with
 * the same content would not.
 */
export function mapEnvelopeToVacancies(
  value: unknown,
  pageUrl: string,
  sameSiteUrl: (candidate: string) => boolean,
): EnvelopeMapping {
  const description = describeEnvelope(value);
  const items = itemsOf(value, description);
  const warnings: string[] = [];
  const records: VacancyRecord[] = [];
  const offSiteLinks = new Set<string>();
  let fragmentCount = 0;

  for (const item of items) {
    const fragments = htmlFragmentsOf(item);
    for (const fragment of fragments) {
      fragmentCount += 1;
      for (const href of hrefsOf(fragment)) {
        let resolved: string;
        try {
          resolved = new URL(href, pageUrl).toString();
        } catch {
          continue;
        }
        if (!sameSiteUrl(resolved)) offSiteLinks.add(resolved);
      }
      const analysis = analyzeCareerPage({
        body: new TextEncoder().encode(fragment),
        contentType: "text/html",
        url: pageUrl,
        httpStatus: 200,
      });
      for (const r of analysis.records) {
        // A record title is remote text. If it contains markup, a control
        // character, or markup that only appears once entities are decoded, it is
        // not a title and the record is dropped with a warning rather than kept: a
        // vacancy card that renders whatever a server sent is a stored-XSS vector
        // with a job title attached.
        if (decodesToMarkup(r.title) || CONTROL_RE.test(r.title)) {
          warnings.push(`dropped a record whose title is not plain text: ${JSON.stringify(r.title.slice(0, 40))}`);
          continue;
        }
        records.push(r);
      }
    }
  }

  if (description.itemCount === 0) {
    warnings.push("endpoint returned an empty envelope, which is not evidence that no vacancy exists");
  }
  if (description.shape === "MULTI_ARRAY_KEY") {
    warnings.push("payload has more than one array-valued key; only the first is read, so records may be understated");
  }
  if (offSiteLinks.size > 0 && records.length === 0) {
    warnings.push(
      `content links off-site (${[...offSiteLinks].slice(0, 3).join(", ")}) and carries no vacancy of its own; the vacancy is published elsewhere`,
    );
  }
  return { description, records, fragmentCount, offSiteLinks: [...offSiteLinks], warnings };
}

function itemsOf(value: unknown, description: EnvelopeDescription): unknown[] {
  if (description.shape === "ARRAY") return value as unknown[];
  if (description.arrayKey !== null && value !== null && typeof value === "object") {
    const arr = (value as Record<string, unknown>)[description.arrayKey];
    if (Array.isArray(arr)) return arr;
  }
  if (description.shape === "MULTI_ARRAY_KEY" && value !== null && typeof value === "object") {
    const arr = (value as Record<string, unknown>)[description.arrayKeys[0]];
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

function hrefsOf(fragment: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*(?:'([^']*)'|"([^"]*)")/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const v = cleanText(m[1] ?? m[2]);
    if (v) out.push(v);
  }
  return out;
}
