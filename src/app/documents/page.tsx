import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { DocumentCatalogue, type DocumentRow } from "@/components/documents/DocumentCatalogue";
import { nrbSummary } from "@/data/nrb";
import { distinctNrbDocuments } from "@/util/activity";
import { financials } from "@/data/financials";
import { formatDate } from "@/util/format";
import { institutionHrefForId } from "@/util/institution-profile";

/**
 * Documents.
 *
 * This page previously listed eight invented PDFs - "Financial Stability Report
 * 2025", "Monetary Policy 2025/26", "Digital Financial Services Framework" -
 * each with `url: "#"`. None of those documents exist; the titles were plausible
 * and the links went nowhere. They also appeared in the published search API, so
 * the invention had already escaped the frontend.
 *
 * What is here now is the real catalogue: documents the NRB has published plus
 * the institution-published documents catalogued by the evidence pipeline. Both
 * are listed as documents that exist - none of them has been read.
 *
 * NRB records are deduplicated by URL before display, because the regulator's
 * ledger indexes some documents under two source lists. The count below is the
 * number of rows on this page, not the number of ledger entries.
 */

export const metadata: Metadata = {
  title: "Documents",
  description:
    "Documents published by Nepal Rastra Bank and located on microfinance institutions' own websites. Catalogued and dated; contents not read.",
};

const NRB_ROWS: DocumentRow[] = distinctNrbDocuments().map((d) => ({
  id: `nrb-${d.id}`,
  title: d.title,
  type: d.docType,
  publisher:
    d.alsoListedIn.length > 0
      ? `${d.sourceTitle} · also listed by ${d.alsoListedIn.join(", ")}`
      : d.sourceTitle,
  date: d.publishedAt,
  size: d.size,
  url: d.officialUrl,
  origin: "nrb" as const,
}));

const ROWS: DocumentRow[] = [
  ...NRB_ROWS,
  ...financials.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.kind === "RATE" ? "REPORT_NOTICE" : (d.reportType ?? "REPORT"),
    publisher: d.institution,
    date: d.lastSeenAt,
    size: null,
    url: d.sourceDocument,
    origin: "institution" as const,
    // The generator embedded the institution id in the record id, so the owning
    // institution is resolvable without shipping the directory to the browser.
    institutionProfileHref: institutionHrefForId(/^financial-([^|]+)\|/.exec(d.id)?.[1]),
  })),
];

export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Documents we located"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {ROWS.length} documents: {NRB_ROWS.length} published by the Nepal Rastra Bank and{" "}
          {financials.length} found on institutions&apos; own websites. Each is catalogued with the date and
          link its source gave. None has been read, so nothing here summarises one.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <DocumentCatalogue rows={ROWS} />

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">
          The regulator&apos;s ledger holds {nrbSummary.documents} listings across{" "}
          {Object.keys(nrbSummary.documentsByType).length} types, generated{" "}
          {formatDate(nrbSummary.generatedAt) ?? "at an unrecorded time"}. Some documents are listed under
          more than one source list at the same address; those are collapsed here into one row that names
          every list they appeared in, which is why {NRB_ROWS.length} rows stand in for{" "}
          {nrbSummary.documents} listings.{" "}
          <Link href="/financials" className="underline underline-offset-2">
            Financial documents
          </Link>{" "}
          and{" "}
          <Link href="/interest-rates" className="underline underline-offset-2">
            rate notices
          </Link>{" "}
          have their own pages.
        </p>
      </Container>
    </>
  );
}