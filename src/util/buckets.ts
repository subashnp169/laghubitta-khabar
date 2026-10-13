import { nrbSummary } from "@/lib/site-data";
import { distinctNrbDocuments } from "@/util/activity";
import { allPublishedFinancials } from "../../lib/repository/static-financials";
import { allPublishedDocuments } from "../../lib/repository/static-documents";

/**
 * Content buckets.
 *
 * The site carries three kinds of content and they answer different questions, so
 * they are kept apart by name everywhere. The previous state called the same
 * regulator records "structural changes", "regulatory record", "activity" and
 * "events" on different pages, which read as four things rather than one.
 *
 *   - **Regulatory events** — regulatory and structural changes the Nepal Rastra
 *     Bank directory records against licensed institutions (mergers, acquisitions,
 *     renames, rulings). Regulator-published, the strongest evidence grade here.
 *   - **Documents** — files an institution or the regulator published. Titles and
 *     links are catalogued; not one document has been read, so no bucket ever
 *     summarises a file.
 *   - **News & activity** — external media coverage, which carries a weaker
 *     evidence grade than regulator records and is *separate* from both above. This
 *     project holds none, so the bucket is stated as empty rather than filled with
 *     records that are really events or documents.
 *
 * A bucket is a fact about the evidence, not a topic. Nothing here classifies by
 * subject matter; that would require reading the documents, which is not done.
 */

export type ContentBucket = "regulatory-events" | "documents" | "news-activity";

/** Stable display order: strongest evidence grade first. */
export const CONTENT_BUCKET_ORDER: readonly ContentBucket[] = [
  "regulatory-events",
  "documents",
  "news-activity",
];

export const CONTENT_BUCKET_LABEL: Record<ContentBucket, string> = {
  "regulatory-events": "Regulatory events",
  documents: "Documents",
  "news-activity": "News & activity",
};

export const CONTENT_BUCKET_DETAIL: Record<ContentBucket, string> = {
  "regulatory-events":
    "Regulatory and structural changes the Nepal Rastra Bank directory records against licensed institutions — mergers, acquisitions, renames and rulings.",
  documents:
    "Files an institution or the regulator published. Titles and links are catalogued; no document has been read.",
  "news-activity":
    "External media coverage, which carries a weaker grade than regulator records. This project holds none, so the bucket is empty rather than filled with events or documents.",
};

/** Where a bucket's records live. `null` where no page holds that bucket. */
export const CONTENT_BUCKET_HREF: Record<ContentBucket, string | null> = {
  "regulatory-events": "/news",
  documents: "/documents",
  "news-activity": null,
};

/**
 * What each bucket holds in this snapshot, counted once so every page that shows
 * the buckets shows the same numbers. Documents span all three document layers:
 * the regulator's own distinct files, the financial documents found on institution
 * sites, and the general titles recorded from those sites.
 */
export function contentBucketCounts(): Record<ContentBucket, number> {
  return {
    "regulatory-events": nrbSummary.regulatoryEvents,
    documents:
      distinctNrbDocuments().length + allPublishedFinancials().length + allPublishedDocuments().length,
    "news-activity": 0,
  };
}
