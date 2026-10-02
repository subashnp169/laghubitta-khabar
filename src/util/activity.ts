import { nrbDocuments, nrbRegulatoryEvents } from "@/data/nrb";
import type { NrbDocument, NrbRegulatoryEvent } from "@/types";
import { formatDate, isRealDate } from "./format";

/**
 * The sector activity feed.
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

function regulatoryItem(event: NrbRegulatoryEvent): ActivityItem {
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
    sourceTitle: "NRB BFI directory",
    href: `/news/${event.id}`,
    label: event.eventType.replace(/_/g, " ").toLowerCase(),
  };
}

function publicationItem(doc: NrbDocument): ActivityItem {
  return {
    id: doc.id,
    kind: "publication",
    occurredAt: isRealDate(doc.publishedAt) ? doc.publishedAt : null,
    title: doc.title,
    // State the limit rather than implying the contents were read.
    detail: "Document published; contents not read",
    institutionSlug: null,
    institutionName: null,
    sourceTitle: doc.sourceTitle,
    href: doc.officialUrl || null,
    label: DOC_LABEL[doc.docType] ?? doc.docType.replace(/_/g, " ").toLowerCase(),
  };
}

/**
 * All activity, most recent first. Undated records sort last rather than being
 * dropped, so a record with a missing date is still reachable rather than
 * silently lost.
 *
 * Publications are the distinct documents, not the raw listings, so a document
 * indexed under two source lists appears once in the feed.
 */
export function allActivity(): ActivityItem[] {
  return [
    ...nrbRegulatoryEvents.map(regulatoryItem),
    ...distinctNrbDocuments().map(publicationItem),
  ].sort((a, b) => {
    if (a.occurredAt && b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
    if (a.occurredAt) return -1;
    if (b.occurredAt) return 1;
    return a.id.localeCompare(b.id);
  });
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
