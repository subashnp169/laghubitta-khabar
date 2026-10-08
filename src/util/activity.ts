import { nrbDocuments, nrbRegulatoryEvents, nrbSummary } from "@/lib/site-data";
import type { NrbDocument, NrbRegulatoryEvent } from "@/types";
import { formatDate, isRealDate } from "./format";

/**
 * The sector activity feed — and the single canonical content projection.
 *
 * This replaces a "Live" ticker that used to scroll invented article titles past
 * the reader under a pulsing dot. Nothing here is a headline: every item is a
 * record that exists in the dataset — either a structural change the Nepal Rastra
 * Bank BFI directory records about an institution (a merger, an acquisition, a
 * rename) or a document the NRB published — carrying the date the source gave it.
 *
 * Two consequences worth stating plainly:
 *
 *  - It is labelled with its observation date, never "live". The directory is a
 *    snapshot, so calling it live would overstate it.
 *  - Document publications are included even though most documents have not been
 *    read. The feed says a document exists; it does not summarise one.
 *
 * Everything the reader-facing feed shows (`allActivity`) and everything the
 * `GET /api/news` endpoint serves (via `lib/api/repository`'s `listNews`, which
 * reads `newsRecords` here) is derived from one iteration over these two arrays,
 * so page and API cannot drift apart: parity holds by construction.
 */

export type ActivityKind = "regulatory" | "publication";

/**
 * One document, as distinct from one *listing* of it.
 *
 * The NRB ledger indexes the same document under more than one source list — the
 * supervision department archive and the quarterly interest-rate list both carry
 * "Interest rate structure as of (2083 Asar)", at the same URL, with the same
 * date and size. `nrbSummary.documents` counts listings, so those 97 listings are
 * 93 documents a reader could actually open.
 *
 * Both numbers are true and they mean different things, so neither is discarded:
 * the source catalogue keeps every listing, and anything presenting documents to
 * a reader collapses them by URL. Printing the raw 97 next to a collapsed list
 * would be the dishonest option — the count would not match what is on screen.
 */
export interface DistinctDocument extends NrbDocument {
  /** Other source lists this document was also found in, in data order. */
  alsoListedIn: string[];
}

export function distinctNrbDocuments(
  docs: readonly NrbDocument[] = nrbDocuments,
): DistinctDocument[] {
  const byUrl = new Map<string, DistinctDocument>();
  const withoutUrl: DistinctDocument[] = [];

  for (const doc of docs) {
    // A record with no URL cannot be matched against another, so it stays its own
    // document rather than being merged on title — the same title does not prove
    // the same document.
    if (!doc.officialUrl) {
      withoutUrl.push({ ...doc, alsoListedIn: [] });
      continue;
    }
    const existing = byUrl.get(doc.officialUrl);
    if (existing) {
      existing.alsoListedIn.push(doc.sourceTitle);
    } else {
      byUrl.set(doc.officialUrl, { ...doc, alsoListedIn: [] });
    }
  }

  return [...byUrl.values(), ...withoutUrl];
}

export interface ActivityItem {
  /** Stable across builds, safe as a React key and as a route segment. */
  id: string;
  kind: ActivityKind;
  /** "2026-09-22" or null when the source carried no date. */
  occurredAt: string | null;
  title: string;
  /** One line of plain explanation. Never inferred beyond the record. */
  detail: string;
  institutionSlug: string | null;
  institutionName: string | null;
  sourceTitle: string;
  href: string | null;
  /** What kind of document this is, for publication items. */
  label: string | null;
}

/**
 * The canonical content record: everything the feed shows, plus the source
 * evidence the API layer needs but the feed does not render.
 *
 * `sourceId` and `sourceUrl` are traced, never guessed:
 *
 *  - Documents carry both fields from the ledger (`nrbDocuments[].sourceId`,
 *    `officialUrl`) — read out of the exported arrays as-is.
 *  - Regulatory events do not: `scripts/generate-nrb-data.ts`'s SELECT drops
 *    `source_id`, so the export cannot carry it. `EVENT_SOURCE_ID` below
 *    restates the measured value and `scripts/smoke-news-p2e.ts` re-verifies it
 *    against `data/master/master.json` on every run.
 *  - `sourceUrl` for an event is the trailing `https://…` citation inside its
 *    own description when one is present, and `null` when the description ends
 *    in an internal evidence id instead. It is parsed, never constructed.
 */
export interface NewsRecord extends ActivityItem {
  /** Registered source this record is attributed to (present in nrbSummary.sources). */
  sourceId: string;
  /** The source's own URL for this record, when the source gave one. */
  sourceUrl: string | null;
}

/**
 * The source every timeline row in the master snapshot carries.
 *
 * Evidence: all 62 rows of `data/master/master.json`'s `timeline[]` have
 * `source_id: "nrb-bfi-mid-may-2026"` (and `universeSnapshot.source_id` is the
 * same), which `scripts/nrb-ledger.ts` copies into `regulatory_events` as
 * `e.source_id ?? uniSource`. The `generate-nrb-data.ts` SELECT omits
 * `source_id`, so `src/data/nrb.ts` events are the one place in the pipeline
 * where the attribution is not carried through — this constant restates the
 * measured value rather than inventing one. `smoke-news-p2e` locks it to
 * master.json: every event item served by `GET /api/news` must agree with every
 * timeline row, or the suite fails.
 */
const EVENT_SOURCE_ID = "nrb-bfi-mid-may-2026";

/**
 * The registered title for a source id — the one canonical source label.
 *
 * Titles are looked up, not carried inline: `doc.sourceTitle` and the registry
 * agree today (measured: 0 mismatches over 97 listings) but only the registry is
 * source-owned, so anything presenting `meta.sources` to a consumer can prove
 * the title came from the source record. An unregistered id throws — an unknown
 * source must surface, never silently become a label.
 */
function sourceTitleFor(sourceId: string): string {
  const source = nrbSummary.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`activity: unregistered source id: ${sourceId}`);
  return source.title;
}

/**
 * The trailing `https://…` citation in an event description, or null.
 *
 * 52 of 62 event descriptions end `Evidence: <url>`; the other 10 end an
 * internal evidence id (`Evidence: evt-…`) and have no URL to give. A regex on
 * the end of the text parses what is there and reports the rest as null — it
 * never reaches for a "likely" document to fill the gap.
 */
function trailingEvidenceUrl(description: string): string | null {
  return /https?:\/\/\S+$/.exec(description.trim())?.[0] ?? null;
}

/**
 * A merger, acquisition or rename, phrased the way the directory states it.
 * `title` on these records is the *other* institution in the transaction, so the
 * phrasing has to come from `eventType` — a generic "update" would lose the one
 * fact a reader came for.
 */
const EVENT_PHRASE: Record<string, string> = {
  MERGED: "Merged with",
  ACQUIRED: "Acquired",
  RENAMED: "Renamed to",
};

/** Short, honest labels for the document types present in the dataset. */
const DOC_LABEL: Record<string, string> = {
  ENFORCEMENT: "Enforcement",
  KFI: "Financial inclusion report",
  REPORT: "Report",
};

function regulatoryRecord(event: NrbRegulatoryEvent): NewsRecord {
  const phrase = EVENT_PHRASE[event.eventType] ?? event.eventType.replace(/_/g, " ").toLowerCase();
  return {
    id: event.id,
    kind: "regulatory",
    occurredAt: isRealDate(event.occurredAt) ? event.occurredAt : null,
    // `phrase` is a fixed key from a closed set, `event.title` is the name the
    // NRB directory published — neither is user input.
    title: `${phrase} ${event.title}`.trim(),
    detail: event.institutionName,
    institutionSlug: event.institutionSlug,
    institutionName: event.institutionName,
    sourceTitle: sourceTitleFor(EVENT_SOURCE_ID),
    href: `/news/${event.id}`,
    label: event.eventType.replace(/_/g, " ").toLowerCase(),
    sourceId: EVENT_SOURCE_ID,
    sourceUrl: trailingEvidenceUrl(event.description),
  };
}

function publicationRecord(doc: DistinctDocument): NewsRecord {
  return {
    id: doc.id,
    kind: "publication",
    occurredAt: isRealDate(doc.publishedAt) ? doc.publishedAt : null,
    title: doc.title,
    // State the limit rather than implying the contents were read.
    detail: "Document published; contents not read",
    institutionSlug: null,
    institutionName: null,
    sourceTitle: sourceTitleFor(doc.sourceId),
    href: doc.officialUrl || null,
    label: DOC_LABEL[doc.docType] ?? doc.docType.replace(/_/g, " ").toLowerCase(),
    sourceId: doc.sourceId,
    sourceUrl: doc.officialUrl || null,
  };
}

/**
 * Most recent first, undated records last, ties in input order (events before
 * publications, each in data order).
 *
 * Undated records sort last rather than being dropped, so a record with a
 * missing date is still reachable rather than silently lost. In the current
 * snapshot all 155 records are dated — every event falls back to the
 * observation date `nrbSummary.observedAt` (the ledger's `NOT NULL` constraint
 * on `occurred_at`, counted as `events_occurred_at_fallback: 62` in
 * `data/nrb/nrb-ledger-report.json`) and every document carries a real
 * publication date — but the comparator keeps the null branch honestly.
 */
function byMostRecent(a: NewsRecord, b: NewsRecord): number {
  if (a.occurredAt && b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
  if (a.occurredAt) return -1;
  if (b.occurredAt) return 1;
  return a.id.localeCompare(b.id);
}

/**
 * The canonical content iteration: every record the site has, sorted once.
 *
 * Both surfaces derive from this — the feed via `allActivity`, the API via
 * `listNews` in `lib/api/repository` — so page/API parity is structural, not a
 * promise two implementations have to keep. Publications are the distinct
 * documents, not the raw listings, so a document indexed under two source lists
 * appears once.
 *
 * Pure and uncached: a fresh array every call, same inputs, same order.
 */
export function newsRecords(): NewsRecord[] {
  return [
    ...nrbRegulatoryEvents.map(regulatoryRecord),
    ...distinctNrbDocuments().map(publicationRecord),
  ].sort(byMostRecent);
}

function toActivityItem(record: NewsRecord): ActivityItem {
  // Explicit field map, not a spread or a destructure: the feed's public type
  // deliberately does not carry source evidence, and the runtime objects must
  // not carry it either (they get serialized by pages). Field-by-field keeps
  // the two shapes in sync on purpose — if NewsRecord grows a field, this
  // mapping makes the choice to hide or show it a conscious edit.
  return {
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt,
    title: record.title,
    detail: record.detail,
    institutionSlug: record.institutionSlug,
    institutionName: record.institutionName,
    sourceTitle: record.sourceTitle,
    href: record.href,
    label: record.label,
  };
}

/**
 * All activity, most recent first — the reader-facing feed.
 */
export function allActivity(): ActivityItem[] {
  return newsRecords().map(toActivityItem);
}

export function activitySlice(limit: number, only?: ActivityKind): ActivityItem[] {
  const all = only ? allActivity().filter((item) => item.kind === only) : allActivity();
  return all.slice(0, limit);
}

/**
 * The date of the most recent activity, used to caption the feed. Returning
 * `null` means the dataset has no dated activity at all — the caller should then
 * omit the date rather than print a placeholder next to a confident headline.
 */
export function latestActivityDate(): string | null {
  for (const item of allActivity()) {
    if (item.occurredAt) return item.occurredAt;
  }
  return null;
}

export { formatDate };
