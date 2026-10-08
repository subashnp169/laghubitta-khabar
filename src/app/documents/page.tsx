import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { DocumentCatalogue, type DocumentRow } from "@/components/documents/DocumentCatalogue";
import { nrbSummary } from "@/lib/site-data";
import { allPublishedFinancials } from "../../../lib/repository/static-financials";
import { allPublishedDocuments } from "../../../lib/repository/static-documents";
import { distinctNrbDocuments } from "@/util/activity";
import { formatDate } from "@/util/format";
import { institutionHrefForId } from "@/util/institution-profile";

const financials = allPublishedFinancials();
const generalDocuments = allPublishedDocuments();

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
 *
 * P2-D added the third kind: general documents observed as LINK TEXT on an
 * institution's own site (`document_title` / `notice_title` assertions). For
 * those the evidence carries a title and nothing else - no target URL, no date,
 * no type beyond notice vs document - so they render with no link, and the
 * owning institution comes from the record's own `institution_id` column.
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
  ...generalDocuments.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.doc_type,
    publisher: d.institution,
    // The date shown is when the link was OBSERVED, not a publication date:
    // no source ever dated these documents. Null would be defensible too, but
    // hiding when the observation happened would hide the only time fact the
    // evidence actually carries.
    date: d.meta.last_verified_at,
    size: null,
    // Never a link: the target URL was never observed, and a fabricated one
    // would go nowhere or somewhere wrong.
    url: null,
    origin: "institution" as const,
    institutionProfileHref: institutionHrefForId(d.institution_id),
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
          {ROWS.length} documents: {NRB_ROWS.length} published by the Nepal Rastra Bank, {financials.length}{" "}
          financial documents found on institutions&apos; own websites, and {generalDocuments.length} further
          titles recorded from institution sites. Each is catalogued with the date and link its source gave.
          None has been read, so nothing here summarises one.
        </p>
        {generalDocuments.length > 0 ? (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mfi-500">
            The {generalDocuments.length} title-only entries carry no link: their titles were observed as link
            text, but the addresses they pointed to never were, so there is nothing to open. Their dates are
            observation dates — when the link was seen — not publication dates; no source ever dated them.
          </p>
        ) : null}
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