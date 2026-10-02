import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { institutions, directorySource } from "@/data/institutions";
import { allPublishedPeople } from "../../../lib/repository/static-people";
import { allPublishedBranches } from "../../../lib/repository/static-branches";
import { financials } from "@/data/financials";
import { jobs } from "@/data/jobs";
import { nrbRegulatoryEvents } from "@/data/nrb";
import { distinctNrbDocuments } from "@/util/activity";
import { crawlSummary } from "@/data/pilot";
import { formatCount, formatCrore, formatDate } from "@/util/format";

/**
 * What the dataset actually supports.
 *
 * The page this replaces was the most misleading thing on the site. It listed six
 * "research papers" that did not exist, and attributed them to real-sounding
 * third parties — including "NRB Research Department" and "Laghubitta Khabar
 * Research" — with specific invented findings:
 *
 *   - "Survey of 5,000 rural borrowers shows 62% prefer digital loan applications"
 *   - "Women constitute 78% of MFI borrowers but only 12% of management positions"
 *   - "Longitudinal study of non-performing loan trends across 51 MFIs"
 *
 * None of that was measured. No survey was run, no borrower data was ever
 * touched, and the NRB never published those papers. A reader arriving from a
 * search engine had no way to know.
 *
 * What replaces it is arithmetic over records that exist, and nothing else. Every
 * figure below is counted from the dataset at build time, and each section states
 * what it is counting and what it cannot tell you. This page publishes no
 * research and claims no findings.
 */

export const metadata: Metadata = {
  title: "What the data shows",
  description:
    "Counts and distributions computed directly from this project's own records. No external research, no estimates, no findings that were not counted.",
};

const people = allPublishedPeople();
const branches = allPublishedBranches();

const capitals = institutions
  .map((i) => i.paidUpCapitalCrore)
  .filter((v): v is number => typeof v === "number" && v > 0)
  .sort((a, b) => a - b);

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const capitalSum = capitals.reduce((sum, v) => sum + v, 0);

const leadershipByInstitution = institutions
  .map((inst) => ({ inst, count: people.filter((p) => p.institution_slug === inst.slug).length }))
  .sort((a, b) => b.count - a.count);

const branchesByDistrict = branches.reduce<Record<string, number>>((acc, branch) => {
  const key = branch.district || "Not stated";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
const districtRows = Object.entries(branchesByDistrict).sort((a, b) => b[1] - a[1]);

/** Mergers and acquisitions grouped by the year the directory recorded them. */
const eventsByYear = nrbRegulatoryEvents.reduce<Record<string, number>>((acc, e) => {
  const year = e.occurredAt?.slice(0, 4);
  if (!year) return acc;
  acc[year] = (acc[year] ?? 0) + 1;
  return acc;
}, {});
const eventRows = Object.entries(eventsByYear).sort((a, b) => a[0].localeCompare(b[0]));

const docsByInstitution = institutions
  .map((inst) => ({ inst, count: financials.filter((f) => f.institution === inst.name).length }))
  .filter((row) => row.count > 0)
  .sort((a, b) => b.count - a.count);


export default function ResearchPage() {
  return (
    <>
      <PageHeader
        eyebrow="Computed, not published"
        title="What the record actually shows"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          This project publishes no research and has conducted no survey. What follows is arithmetic over
          records that exist in this dataset — counts, distributions and coverage — with the method stated
          for each one. Where a question needs data this project does not have, that is said plainly rather
          than estimated.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <p className="rounded-md border border-mfi-200 bg-white px-4 py-3 text-xs leading-relaxed text-mfi-600">
          <span className="font-semibold text-mfi-800">Coverage: </span>
          {institutions.length} institutions from the NRB BFI directory as of{" "}
          {formatDate(directorySource.asOf) ?? "an unrecorded date"}; {people.length} published people;{" "}
          {branches.length} published branches; {financials.length} catalogued documents; {jobs.length}{" "}
          vacancy records; {distinctNrbDocuments().length} NRB documents; {nrbRegulatoryEvents.length} recorded
          structural changes.
        </p>

        <Finding
          title="Paid-up capital is concentrated, and the directory publishes it for everyone"
          method={`Counted from the NRB BFI directory snapshot of ${formatDate(directorySource.asOf) ?? "an unrecorded date"}. Capital is what institutions hold on the books — it is not assets, deposits, profit or lending volume, none of which the directory publishes per institution.`}
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
            <Stat term="Publishing capital" value={`${capitals.length} / ${institutions.length}`} />
            <Stat term="Median" value={formatCrore(quantile(capitals, 0.5)) ?? "—"} />
            <Stat term="Largest" value={formatCrore(capitals[capitals.length - 1]) ?? "—"} />
            <Stat term="Smallest" value={formatCrore(capitals[0]) ?? "—"} />
          </div>
          {capitals.length > 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-mfi-600">
              The top ten institutions hold{" "}
              <span className="font-medium text-mfi-900">
                {formatCrore(capitals.slice(-10).reduce((s, v) => s + v, 0))?.replace(" Cr", " crore")}
              </span>{" "}
              of {formatCrore(capitalSum)?.replace(" Cr", " crore")} in total —{" "}
              {Math.round((capitals.slice(-10).reduce((s, v) => s + v, 0) / capitalSum) * 100)}% of the
              combined figure. Concentration in a sector with this many licensed lenders is worth noting;{" "}
              <span className="font-medium text-mfi-800">what it implies is not something this dataset can
              answer</span>, because it holds no lending, deposit or profitability data.
            </p>
          ) : null}
        </Finding>

        <Finding
          title="Leadership coverage is partial, and that is a collection fact"
          method="Counted from published leadership records. Only institutions whose site publishes a leadership page appear; absence means the page was not found."
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
            <Stat term="Institutions with people" value={`${leadershipByInstitution.filter((r) => r.count > 0).length} / ${institutions.length}`} />
            <Stat term="People recorded" value={formatCount(people.length) ?? "—"} />
            <Stat term="Most published" value={String(leadershipByInstitution[0]?.count ?? 0)} />
            <Stat term="Median per covered" value={String(medianCount(leadershipByInstitution))} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-mfi-600">
            {leadershipByInstitution.filter((r) => r.count === 0).length} institutions publish nothing we
            could read.{" "}
            <span className="font-medium text-mfi-800">
              That is a gap in what we found, not evidence that those institutions lack leadership, and not
              evidence they lack it.
            </span>{" "}
            It also means this dataset cannot support any statement about gender representation, tenure or
            turnover in the sector — the denominator is unknown, so any percentage computed from it would be
            meaningless.
          </p>
        </Finding>

        <Finding
          title="Branch presence is recorded unevenly"
          method="Counted from published branch records. Branches appear only where an institution published a list we could read."
        >
          {districtRows.length === 0 ? (
            <EmptyState
              title="No branch records"
              detail="No institution has published a branch list we could read in this snapshot."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
                <Stat term="Branches recorded" value={formatCount(branches.length) ?? "—"} />
                <Stat term="Districts covered" value={String(districtRows.length)} />
                <Stat term="Most covered" value={String(districtRows[0]?.[1] ?? "—")} />
              </div>
              <ul className="mt-4 space-y-1.5">
                {districtRows.slice(0, 10).map(([district, count]) => (
                  <li key={district} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-mfi-700">{district}</span>
                    <span className="h-1.5 rounded-full bg-mfi-300" style={{ width: `${Math.max(6, (count / districtRows[0][1]) * 55)}%` }} />
                    <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-mfi-600">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Finding>

        <Finding
          title="The sector has been consolidating"
          method={`Counted from ${nrbRegulatoryEvents.length} structural changes in the NRB BFI directory. A merger means two licensed institutions became one, so the count of institutions falls over time.`}
        >
          {eventRows.length === 0 ? (
            <EmptyState title="No dated changes" detail="No structural change in the directory carries a date." />
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              {eventRows.map(([year, count]) => {
                const max = Math.max(...eventRows.map(([, c]) => c));
                return (
                  <div key={year} className="flex flex-col items-center gap-1.5">
                    <span className="font-mono text-xs tabular-nums text-mfi-700">{count}</span>
                    <span
                      className="w-8 rounded-t bg-mfi-600 sm:w-10"
                      style={{ height: `${Math.max(6, (count / max) * 70)}px` }}
                      aria-hidden="true"
                    />
                    <span className="text-xs text-mfi-500">{year}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-sm leading-relaxed text-mfi-600">
            All {nrbRegulatoryEvents.length} recorded changes carry the same observation date, which is when
            the directory snapshot was taken — not when each merger happened. The{" "}
            <span className="font-medium text-mfi-800">year distribution above is therefore an artefact of
            the snapshot, not a timeline</span>. Individual change pages carry the date the directory gave.
          </p>
        </Finding>

        <Finding
          title="Document coverage is narrow"
          method="Counted from catalogued financial documents per institution."
        >
          {docsByInstitution.length === 0 ? (
            <EmptyState title="No documents catalogued" detail="No financial document has been located in this snapshot." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
                <Stat term="Institutions publishing" value={`${docsByInstitution.length} / ${institutions.length}`} />
                <Stat term="Documents" value={String(financials.length)} />
                <Stat term="Most published" value={String(docsByInstitution[0]?.count ?? 0)} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mfi-600">
                Only {docsByInstitution.length} of {institutions.length} institutions have a document we
                located, and none of those documents has been read. So this dataset supports{" "}
                <span className="font-medium text-mfi-800">no comparison of financial performance between
                institutions</span> — not because the institutions are opaque, but because the contents were
                never extracted.
              </p>
            </>
          )}
        </Finding>

        <Finding
          title="What this dataset cannot tell you"
          method="Stated explicitly so the gaps are not mistaken for findings."
        >
          <ul className="space-y-2 text-sm text-mfi-700">
            {[
              "Financial performance — no document contents have been extracted, so there are no ratios, growth rates or profit figures.",
              "Borrower outcomes — no borrower-level data has ever been collected, so nothing about poverty impact, repayment or credit access can be said.",
              "Interest rates — rate notices are catalogued as links; no rate value has been read from any of them.",
              "Gender, caste or inclusion — the leadership denominator is unknown, so no representation figure would be meaningful.",
              "Trends over time — the directory is a single dated snapshot; there is no prior snapshot to compare it against.",
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-flag-500" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </Finding>

        <p className="mt-10 flex flex-wrap gap-2 border-t border-mfi-100 pt-6 text-xs text-mfi-500">
          <span>Source monitoring recorded {crawlSummary.snapshots} page snapshots across {crawlSummary.sources} sources, last run {formatDate(crawlSummary.generatedAt) ?? "not recorded"}.</span>
          <Link href="/ingestion" className="underline underline-offset-2">
            Control room
          </Link>
          <Chip tone="neutral">no estimates on this page</Chip>
        </p>
      </Container>
    </>
  );
}

function Finding({
  title,
  method,
  children,
}: {
  title: string;
  method: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="text-lg font-bold tracking-tight text-mfi-900">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-mfi-500">
        <span className="font-medium text-mfi-600">Method: </span>
        {method}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="lk-eyebrow">{term}</dt>
      <dd className="lk-figure mt-1.5 tabular-nums">{value}</dd>
    </div>
  );
}

/** Median across institutions that published anything, not across all of them. */
function medianCount(rows: Array<{ count: number }>): string {
  const covered = rows.map((r) => r.count).filter((c) => c > 0).sort((a, b) => a - b);
  if (covered.length === 0) return "—";
  const mid = Math.floor(covered.length / 2);
  const value =
    covered.length % 2 === 0 ? (covered[mid - 1] + covered[mid]) / 2 : covered[mid];
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
