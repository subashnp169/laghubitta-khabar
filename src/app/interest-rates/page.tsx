import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState, StateNote } from "@/components/ui/EmptyState";
import { allInterestRates } from "../../../lib/api/repository";
import type { InterestRateDto } from "../../../lib/repository/types";
import { formatDate, humanize, realUrl } from "@/util/format";
import { Stat } from "@/components/ui/Stat";
import { rateKindLabel, rateValue } from "@/util/rates";

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
 * A rate is only ever shown with its context: product/type, effective period and
 * the basis it was quoted on. `rateValue` (src/util/rates.ts) enforces that — a
 * bare percentage with no basis is refused, never printed. Context is shown per
 * row below so a reader can see exactly what is missing, not just that it is.
 */

export const metadata: Metadata = {
  title: "Interest rates",
  description:
    "Interest-rate notices published by Nepal's licensed microfinance institutions. The notices are catalogued; rate values have not been extracted from the documents.",
};

/**
 * Read through the repository so this page sees exactly the rows the published
 * API would return, including its pagination. Unwrapped defensively: a contract
 * change should render an honest empty page, not throw during build.
 */
const rates = unwrap<InterestRateDto>(allInterestRates({ limit: "200" }));

/** Rows that carry a value the display rule will actually release. */
const extracted = rates.filter((r) => rateValue(r).available);

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
        <StateNote>
          <span className="font-semibold">We are not going to estimate these.</span> A sector average, a
          figure copied from a single lender, or a rate remembered from a news report would all read as
          data and none of them would be sourced. Each notice links to the document; open it for the rate.
        </StateNote>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
          <Stat term="Notices located" value={String(rates.length)} />
          <Stat term="Rates available" value={extracted.length > 0 ? String(extracted.length) : null} fallback="Not extracted" tone={extracted.length > 0 ? "attention" : undefined} />
          <Stat term="Rates unavailable" value={String(unavailable)} hint="Rate values not extracted from notices" />
        </dl>

        {Object.keys(byKind).length > 0 ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="lk-eyebrow">Notice types</span>
            {Object.entries(byKind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <Chip key={kind} tone="info">
                  {rateKindLabel(kind)} · {count}
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
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <caption className="sr-only">
                  Interest-rate notices located on institution websites, with the context a rate would need and its value state
                </caption>
                <thead>
                  <tr className="border-b border-mfi-200 bg-mfi-50 text-left">
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Institution</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Notice</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Applies to</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Effective</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold text-mfi-800">Rate</th>
                  </tr>
                </thead>
                <tbody className="lk-divide">
                  {rates.map((rate) => {
                    const url = realUrl(rate.url) ?? realUrl(rate.source_url);
                    const period = rate.period_start
                      ? [rate.period_start, rate.period_end].filter(Boolean).join(" – ")
                      : null;
                    const effective = rate.effective_date ?? period ?? formatDate(rate.meta?.last_verified_at);
                    const appliesTo = [rate.product_category, rate.rate_type].filter(Boolean).join(" · ") || null;
                    const rv = rateValue(rate);
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
                            {rateKindLabel(rate.rate_kind)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-mfi-600">
                          {appliesTo ?? <span className="text-mfi-400">Not extracted</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-mfi-600">
                          {effective ?? "Not stated"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rv.available ? (
                            <span className="font-mono tabular-nums text-mfi-900" title={rv.help}>
                              {rv.label}
                            </span>
                          ) : (
                            <span className="text-xs text-flag-700" title={rv.help}>
                              {rv.label}
                            </span>
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
