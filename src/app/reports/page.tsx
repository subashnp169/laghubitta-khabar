import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { distinctNrbDocuments } from "@/util/activity";
import { displayHost, formatDate, realUrl } from "@/util/format";
import { Stat } from "@/components/ui/Stat";

/**
 * Reports.
 *
 * Repurposed rather than deleted, so the existing URL keeps working. The page it
 * replaces listed four invented "sector reports" with fabricated metrics —
 * "MFI Sector Growth: 18.4% YoY", "Regional Penetration Disparities", a
 * fabricated Women Empowerment Index — each with `url: "#"`.
 *
 * This is now the real report catalogue: the documents the Nepal Rastra Bank has
 * published under its reporting and financial-inclusion series, listed with the
 * date and link the regulator gave. Still not read, still not summarised — but
 * these are documents that exist.
 */

export const metadata: Metadata = {
  title: "Reports",
  description:
    "Reports and financial-inclusion publications released by Nepal Rastra Bank, listed with their publication dates and source links.",
};

const REPORTS = distinctNrbDocuments()
  .filter((d) => d.docType === "REPORT" || d.docType === "KFI")
  .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

const TYPE_LABEL: Record<string, string> = {
  REPORT: "Report",
  KFI: "Financial inclusion",
  ENFORCEMENT: "Enforcement",
};

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports published by Nepal Rastra Bank"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {REPORTS.length} documents from the regulator&apos;s reporting and financial-inclusion series,
          listed in reverse publication order. Links and dates are the regulator&apos;s own; the documents
          have not been read here, so no figure on this page comes from them.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mfi-600">
          This page lists only the reporting and financial-inclusion series. The regulator&apos;s
          enforcement notices are listed separately on the{" "}
          <Link href="/nrb" className="underline underline-offset-4 hover:text-mfi-900">
            Nepal Rastra Bank
          </Link>{" "}
          page, which also records the structural changes the regulator made to the sector.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Stat term="Reports listed" value={String(REPORTS.length)} />
          <Stat term="Reporting series" value={String(REPORTS.filter((d) => d.docType === "REPORT").length)} />
          <Stat term="Financial inclusion" value={String(REPORTS.filter((d) => d.docType === "KFI").length)} />
          <Stat term="With a date" value={String(REPORTS.filter((d) => d.publishedAt).length)} />
        </dl>

        {REPORTS.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No reports listed"
              detail="No document in the current NRB catalogue belongs to the reporting or financial-inclusion series."
            />
          </div>
        ) : (
          <ul className="lk-card lk-divide mt-6 overflow-hidden">
            {REPORTS.map((doc) => (
              <li key={doc.id} className="px-4 py-4 transition-colors hover:bg-mfi-50 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                  <h2 className="min-w-0 flex-1 text-sm font-medium leading-snug text-mfi-900">
                    {realUrl(doc.officialUrl) ? (
                      <a
                        href={doc.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {doc.title}
                      </a>
                    ) : (
                      doc.title
                    )}
                  </h2>
                  <span className="flex shrink-0 items-center gap-2">
                    <Chip tone={doc.docType === "KFI" ? "info" : "neutral"}>
                      {TYPE_LABEL[doc.docType] ?? doc.docType}
                    </Chip>
                    <span className="font-mono text-xs tabular-nums text-mfi-500">
                      {doc.publishedAt ? formatDate(doc.publishedAt) + " (publication date)" : "undated"}
                    </span>
                  </span>
                </div>

                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mfi-500">
                  <span>{doc.sourceTitle}</span>
                  {doc.size ? <span>{doc.size}</span> : null}
                  {realUrl(doc.officialUrl) ? (
                    <span className="text-mfi-400">{displayHost(doc.officialUrl)}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">
          Enforcement actions are catalogued separately in{" "}
          <Link href="/documents?origin=nrb" className="underline underline-offset-2">
            all documents
          </Link>
          .
        </p>
      </Container>
    </>
  );
}

