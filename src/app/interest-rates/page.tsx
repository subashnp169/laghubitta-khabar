import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { allInterestRates } from "../../../lib/api/repository";
import type { InterestRateDto } from "../../../lib/repository/types";
import { formatDate, humanize, realUrl } from "@/util/format";

/**
 * Interest rates.
 *
 * This page exists to answer a question the data cannot answer, and it says so up
 * front rather than burying it. The sector's published rate notices are PDF
 * letters; this project has located those PDFs but has not extracted a number
 * from any of them. Every record therefore carries a null rate, and rather than
 * substituting a sector average, a "typical" figure, or a neighbouring
 * institution's rate — all of which would look like data and be nothing of the
 * kind — the page lists the notices and states that the value is unavailable.
 *
 * If a `rate_pct` ever arrives from a real extraction, the table below is already
 * shaped to show it. Until then the honest answer is the empty one.
 */

export const metadata: Metadata = {
  title: "Interest rates",
  description:
    "Interest-rate notices published by Nepal's licensed microfinance institutions. The notices are catalogued; rate values have not been extracted from the documents.",
};

const RATE_KIND_LABEL: Record<string, string> = {
  INTEREST_RATE: "Interest rate",
  RATE_CHANGE: "Rate change",
  BASE_RATE: "Base rate",
  DEPOSIT: "Deposit",
  LOAN: "Loan",
};

/**
 * Read through the repository so this page sees exactly the rows the published
 * API would return, including its pagination. Unwrapped defensively: a contract
 * change should render an honest empty page, not throw during build.
 */
const rates = unwrap<InterestRateDto>(allInterestRates({ limit: "200" }));

/** Rows that actually carry a number, if extraction ever runs. */
const extracted = rates.filter((r) => typeof r.rate_pct === "number");

const byKind = rates.reduce<Record<string, number>>((acc, r) => {
  const key = r.rate_kind || "unspecified";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

export default function InterestRatesPage() {
  const unavailable = rates.length - extracted.length;

  return (
    <>
      <PageHeader
        eyebrow="Interest rates"
        title="Rate notices, without invented rates"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          Institutions publish rate changes as PDF letters. We have located those letters, but this project
          does not read PDFs, so <span className="font-medium text-mfi-900">no rate value is available</span>{" "}
          for any of the {rates.length} notices below.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <p className="rounded-md border border-flag-200 bg-flag-50 px-4 py-3 text-sm leading-relaxed text-flag-700">
          <span className="font-semibold">We are not going to estimate these.</span> A sector average, a
          figure copied from a single lender, or a rate remembered from a news report would all read as
          data and none of them would be sourced. Each notice links to the document; open it for the rate.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
          <Stat term="Notices located" value={String(rates.length)} />
          <Stat term="Rates available" value={String(extracted.length)} tone="attention" />
          <Stat term="Rates unavailable" value={String(unavailable)} />
        </dl>

        {Object.keys(byKind).length > 0 ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="lk-eyebrow">Notice types</span>
            {Object.entries(byKind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <Chip key={kind} tone="info">
                  {RATE_KIND_LABEL[kind] ?? humanize(kind)} · {count}
                </Chip>
              ))}
          </div>
        ) : null}

        <section aria-labelledby="notices-heading" className="mt-10">
          <h2 id="notices-heading" className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
            Located notices
          </h2>

          {rates.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No rate notices located"
                detail="No institution in this snapshot links an interest-rate notice we could record."
              />
            </div>
          ) : (
            <div className="lk-card mt-4 overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-sm">
                <caption className="sr-only">
                  Interest-rate notices located on institution websites, with rate values unavailable
                </caption>
                <thead>
                  <tr className="border-b border-mfi-200 bg-mfi-50 text-left">
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Institution</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Notice</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Period</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold text-mfi-800">Rate</th>
                  </tr>
                </thead>
                <tbody className="lk-divide">
                  {rates.map((rate) => {
                    const url = realUrl(rate.url) ?? realUrl(rate.source_url);
                    const period = rate.period_start
                      ? [rate.period_start, rate.period_end].filter(Boolean).join(" – ")
                      : null;
                    return (
                      <tr key={rate.id} className="align-top transition-colors hover:bg-mfi-50">
                        <th scope="row" className="px-4 py-3 text-left font-medium">
                          {rate.institution_slug ? (
                            <Link href={`/institutions/${rate.institution_slug}`} className="text-mfi-900 underline-offset-4 hover:underline">
                              {rate.institution}
                            </Link>
                          ) : (
                            <span className="text-mfi-900">{rate.institution}</span>
                          )}
                        </th>
                        <td className="px-4 py-3 text-mfi-700">
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                              {humanize(rate.title) ?? "Notice"}
                            </a>
                          ) : (
                            humanize(rate.title) ?? "Notice"
                          )}
                          <span className="mt-1 block text-xs text-mfi-400">
                            {RATE_KIND_LABEL[rate.rate_kind] ?? humanize(rate.rate_kind) ?? "Rate notice"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-mfi-600">
                          {period ?? formatDate(rate.meta?.last_verified_at) ?? "Not stated"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {typeof rate.rate_pct === "number" ? (
                            <span className="font-mono tabular-nums text-mfi-900">{rate.rate_pct}%</span>
                          ) : (
                            <span className="text-xs text-flag-700">not extracted</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-8 text-xs leading-relaxed text-mfi-500">
          Rate notices also appear in{" "}
          <Link href="/financials" className="underline underline-offset-2">
            financial information
          </Link>
          , which catalogues the same documents alongside financial reports.
        </p>
      </Container>
    </>
  );
}

function Stat({ term, value, tone }: { term: string; value: string; tone?: "attention" }) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="lk-eyebrow">{term}</dt>
      <dd className={`lk-figure mt-1.5 tabular-nums ${tone === "attention" ? "text-flag-700" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Unwraps `{ status, body: { data } }` into rows. Returns an empty array rather
 * than throwing, so a contract change degrades to an honest empty page.
 */
function unwrap<T>(response: unknown): T[] {
  if (!response || typeof response !== "object") return [];
  const body = (response as { body?: unknown }).body;
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}
