import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { financials, financialsProvenance } from "@/data/financials";
import { institutions } from "@/data/institutions";
import { displayHost, formatDate, humanize, realUrl } from "@/util/format";
import { Stat } from "@/components/ui/Stat";

/**
 * Financial information.
 *
 * This page lists documents we located and did not read. That distinction is the
 * entire content of the page, so it is stated at the top rather than in a
 * footnote: a list of forty report titles next to a set of KPIs would be read as
 * "we analysed these reports", and no such analysis exists in this project.
 *
 * There are no figures here because there is nothing to derive them from. The
 * interest-rate notices found during the same sweep route to their own page,
 * which is explicit that rate values were never extracted.
 */

export const metadata: Metadata = {
  title: "Financial information",
  description:
    "Financial reports and interest-rate notices published by Nepal's licensed microfinance institutions. Documents are catalogued; their contents have not been read.",
};

const REPORTS = financials.filter((f) => f.kind === "REPORT");
const RATE_NOTICES = financials.filter((f) => f.kind === "RATE");

/** "Annual report" reads better than a raw ANNUAL enum in a public table. */
const REPORT_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "Annual",
  QUARTERLY: "Quarterly",
  UNAUDITED: "Unaudited",
};

const RATE_KIND_LABEL: Record<string, string> = {
  INTEREST_RATE: "Interest rate",
  RATE_CHANGE: "Rate change",
  BASE_RATE: "Base rate",
  LOAN: "Loan rate",
};

const covered = new Set(financials.map((f) => f.institution));
const slugByName = new Map(institutions.map((i) => [i.name, i.slug]));

export default function FinancialsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Financial information"
        title="Reports and rate notices institutions have published"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {financials.length} documents found on institution websites. Every one of them is a link we
          recorded, not a report we analysed — the contents have not been read, so this page deliberately
          shows no financial figures.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <p className="rounded-md border border-flag-200 bg-flag-50 px-4 py-3 text-sm leading-relaxed text-flag-700">
          <span className="font-semibold">Nothing here has been read.</span> These are catalogue entries:
          the document exists, we know which institution linked it and when we saw it. Any figure inside a
          PDF is unverified, because reading and checking those PDFs is not something this project does
          yet.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Stat term="Documents found" value={String(financials.length)} />
          <Stat term="Reports" value={String(REPORTS.length)} />
          <Stat term="Rate notices" value={String(RATE_NOTICES.length)} />
          <Stat term="Institutions" value={`${covered.size} / ${institutions.length}`} />
        </dl>

        <section aria-labelledby="reports-heading" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-mfi-200 pb-2">
            <h2 id="reports-heading" className="text-base font-semibold tracking-tight text-mfi-900">
              Reports
            </h2>
            <p className="text-xs text-mfi-500">{REPORTS.length} located</p>
          </div>

          {REPORTS.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No reports located"
                detail="No institution in this snapshot links a financial report we could record."
              />
            </div>
          ) : (
            <ul className="lk-card lk-divide mt-4 overflow-hidden">
              {REPORTS.map((doc) => (
                <li key={doc.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-mfi-900">
                      {doc.title}
                    </p>
                    <DocumentLink url={doc.sourceDocument} label={displayHost(doc.sourceName) ?? "source"} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mfi-600">
                    <InstitutionLink name={doc.institution} />
                    {doc.reportType ? (
                      <Chip tone="info">{REPORT_TYPE_LABEL[doc.reportType] ?? humanize(doc.reportType)}</Chip>
                    ) : null}
                    {doc.lastSeenAt ? (
                      <span className="text-mfi-500">last verified {formatDate(doc.lastSeenAt)} (observed)</span>
                    ) : null}
                    <span className="text-mfi-400">contents not read</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="rates-heading" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-mfi-200 pb-2">
            <h2 id="rates-heading" className="text-base font-semibold tracking-tight text-mfi-900">
              Interest-rate notices
            </h2>
            <Link
              href="/interest-rates"
              className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
            >
              Why there are no rates →
            </Link>
          </div>

          {RATE_NOTICES.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No rate notices located"
                detail="No institution in this snapshot links an interest-rate notice we could record."
              />
            </div>
          ) : (
            <ul className="lk-card lk-divide mt-4 overflow-hidden">
              {RATE_NOTICES.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5">
                  <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-mfi-900">{doc.title}</p>
                  <DocumentLink url={doc.sourceDocument} label={displayHost(doc.sourceName) ?? "source"} />
                  <div className="mt-2 flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mfi-600">
                    <InstitutionLink name={doc.institution} />
                    {doc.rateKind ? (
                      <Chip tone="attention">{RATE_KIND_LABEL[doc.rateKind] ?? humanize(doc.rateKind)}</Chip>
                    ) : null}
                    <span className="text-mfi-400">rate value not extracted</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">{financialsProvenance}.</p>
      </Container>
    </>
  );
}


/**
 * A document link, or an explicit "no usable link" when the record has none. The
 * previous build shipped placeholder data where every document URL was the
 * string `#`; a link to `#` looks real and goes nowhere, so it is not rendered
 * as one.
 */
function DocumentLink({ url, label }: { url: string | null; label: string }) {
  const href = realUrl(url);
  if (!href) {
    return <Chip tone="neutral">no usable link</Chip>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
    >
      {label} ↗
    </a>
  );
}

function InstitutionLink({ name }: { name: string }) {
  const slug = slugByName.get(name);
  if (!slug) return <span>{name}</span>;
  return (
    <Link href={`/institutions/${slug}`} className="underline-offset-4 hover:underline">
      {name}
    </Link>
  );
}
