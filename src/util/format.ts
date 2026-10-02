/**
 * Formatting helpers for the public site.
 *
 * Every function here exists to make one guarantee: the interface never renders
 * a value the data does not actually support. The upstream extractors are
 * honest but blunt — when a page does not state a location they store the
 * literal string "(location not observed)", and one institution carries an
 * operation date of 1900-01-09 from a parse that failed. Rendering those raw
 * would put obvious placeholder text in front of a reader and make real figures
 * next to it look equally unreliable.
 *
 * So: a value that is absent, blank, or one of those sentinels becomes `null`
 * here, and the caller renders a proper empty state instead. Nothing is invented
 * to fill the gap.
 */

/** The one phrase used when the data genuinely does not know something. */
export const NOT_AVAILABLE = "Information not available";

/** Shown where a field exists but the source did not state it. */
export const NOT_STATED = "Not stated";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Placeholder values the ingestion layer writes when a page did not carry the
 * field. Matched case-insensitively across the shapes seen in the data.
 */
const SENTINEL_RE =
  /^\s*(?:\((?:[^)]*?)\s*(?:not observed|not stated|not available|unknown|unspecified)[^)]*\)|n\/?a|unknown|unspecified|none|null|undefined|-|—|\.{3})\s*$/i;

/** A bare parenthetical the extractor left behind, e.g. "(location not observed)". */
const PAREN_PLACEHOLDER_RE = /^\s*\(([^)]*)\)\s*$/;

/** True when a stored string is absent or a known placeholder. */
export function isSentinel(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return SENTINEL_RE.test(trimmed);
}

/**
 * A display string for a value, or `null` when there is nothing honest to show.
 * A parenthetical placeholder is unwrapped into a short readable label
 * ("not observed") rather than discarded, because it still tells the reader
 * that the source was checked.
 */
export function humanize(value: string | null | undefined): string | null {
  if (isSentinel(value)) return null;
  const trimmed = String(value).trim();
  const paren = PAREN_PLACEHOLDER_RE.exec(trimmed);
  if (paren) {
    const inner = paren[1].trim().toLowerCase();
    return inner ? `Not ${inner.replace(/^(?:observed|stated|available)\b.*$/i, "").trim() || "stated"}` : null;
  }
  return trimmed;
}

/** `humanize` with a caller-chosen fallback, for inline use. */
export function text(value: string | null | undefined, fallback = NOT_AVAILABLE): string {
  return humanize(value) ?? fallback;
}

function parseDate(value: string | null | undefined): Date | null {
  if (isSentinel(value)) return null;
  const raw = String(value).trim();
  // A bare calendar date is parsed as UTC midnight so it does not shift a day
  // behind the viewer's timezone.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  // A year before 1900 in this dataset is a failed parse that happened to
  // produce a valid Date, not an observation. Showing "01 Jan 1900" as an
  // operating date would be a confident lie.
  if (date.getUTCFullYear() < 1900) return null;
  return date;
}

/** True when the stored value is a date we are willing to show. */
export function isRealDate(value: string | null | undefined): boolean {
  return parseDate(value) !== null;
}

/** "02 Oct 2026", or `null` when the date is absent or not credible. */
export function formatDate(value: string | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "02 Oct 2026, 08:03 UTC" — used where the time itself is the evidence. */
export function formatDateTime(value: string | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const day = formatDate(value)!;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}, ${hh}:${mm} UTC`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * "Updated 3 days ago", relative to a caller-supplied `now`.
 *
 * `now` is a parameter rather than `Date.now()` so the server and the client
 * cannot disagree about what "today" is and produce a hydration mismatch.
 */
export function formatRelative(
  value: string | null | undefined,
  now: number = Date.now(),
): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const deltaMs = date.getTime() - now;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= ms) {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return "just now";
}

/**
 * True when an observation is recent enough to be worth marking as fresh.
 * Used only for a small dot next to a real timestamp — never as a substitute
 * for showing the timestamp itself.
 */
export function isFresh(value: string | null | undefined, now: number = Date.now()): boolean {
  const date = parseDate(value);
  if (!date) return false;
  const age = now - date.getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}

/** A number, or `null` when the value is absent, non-numeric or negative. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || isSentinel(value)) return null;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** "1,204" — counts only; decimals are not meaningful here. */
export function formatCount(value: unknown): string | null {
  const n = toNumber(value);
  if (n === null || n < 0) return null;
  return new Intl.NumberFormat("en-NP").format(Math.round(n));
}

/** "Rs 274.27 Cr" from a crore figure, or `null` when it is not a real number. */
export function formatCrore(value: unknown): string | null {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  return `Rs ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)} Cr`;
}

/** Up to two significant decimals for a ratio, or `null`. */
export function formatRatio(value: unknown): string | null {
  const n = toNumber(value);
  if (n === null) return null;
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}%`;
}

/**
 * A usable link, or `null`.
 *
 * The placeholder data shipped `"#"` as a document URL. A link to `#` looks
 * real and goes nowhere, so it is treated as no link at all.
 */
export function realUrl(value: string | null | undefined): string | null {
  if (isSentinel(value)) return null;
  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

/** Hostname for display, without the `www.` noise. */
export function displayHost(value: string | null | undefined): string | null {
  const url = realUrl(value);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/** One or two letters for an institution monogram. */
export function initials(name: string | null | undefined): string {
  const cleaned = humanize(name);
  if (!cleaned) return "—";
  const words = cleaned
    .replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * Title-cased field name for display: `people_chair` -> "Chair".
 * Used where a raw field name would leak storage vocabulary into the UI.
 */
export function humanFieldName(field: string): string {
  const tail = field.startsWith("people_") ? field.slice("people_".length) : field;
  const spaced = tail.replace(/_/g, " ").trim();
  if (!spaced) return field;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
