import Link from "next/link";
import { Container, Section, SectionLink } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { directorySource, institutions } from "@/data/institutions";
import { distinctNrbDocuments } from "@/util/activity";
import { financials, financialsProvenance } from "@/data/financials";
import { jobs, jobsProvenance } from "@/data/jobs";
import { crawlSummary } from "@/data/pilot";
import { allPublishedPeople } from "../../lib/repository/static-people";
import { activitySlice, latestActivityDate } from "@/util/activity";
import { formatCrore, formatCount, formatDate, humanize, initials, realUrl } from "@/util/format";

/**
 * Homepage.
 *
 * Every number on this page is counted from the dataset at build time and every
 * figure is captioned with where it came from. Where the data is thin — and in
 * this project it is genuinely thin in places — the page says so in the same
 * visual weight as the numbers, rather than filling the gap with a plausible
 * sentence. The previous version of this page led with a live-sounding ticker
 * over invented articles and a claim of real-time coverage on all 51
 * institutions; both are gone, and the counts below are what can actually be
 * supported.
 */

const people = allPublishedPeople();

/** Largest by published paid-up capital. Grade A evidence, single snapshot. */
const byCapital = institutions
  .filter((inst) => typeof inst.paidUpCapitalCrore === "number" && inst.paidUpCapitalCrore > 0)
  .sort((a, b) => (b.paidUpCapitalCrore ?? 0) - (a.paidUpCapitalCrore ?? 0));

const LICENSED = institutions.filter((i) => i.licenseStatus === "licensed").length;

const CAPITALS = byCapital.reduce((sum, i) => sum + (i.paidUpCapitalCrore ?? 0), 0);

const coverage = institutions.reduce<Record<string, number>>((acc, inst) => {
  const key = inst.workingArea ?? "Not stated";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const coverageRows = Object.entries(coverage).sort((a, b) => b[1] - a[1]);

/** People whose role is currently listed, newest institution entries first. */
const featuredPeople = people.slice(0, 8);

const recentActivity = activitySlice(6);
const latestDate = latestActivityDate();

export default function HomePage() {
  return (
    <>
      <Hero />
      <ActivityStrip />
      <DirectorySnapshot />
      <LatestActivity />
      <PeopleSnapshot />
      <PublicationSnapshot />
      <Method />
    </>
  );
}

function Hero() {
  return (
    <section className="border-b border-mfi-100 bg-white">
      <Container className="py-10 sm:py-14 lg:py-16">
        <p className="lk-eyebrow">
          Directory snapshot as of {formatDate(directorySource.asOf) ?? "an unrecorded date"}
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-[1.15] tracking-tight text-mfi-900 sm:text-4xl lg:text-[2.75rem]">
          Nepal&apos;s microfinance sector, recorded from the sources that publish it.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-mfi-600 sm:text-lg">
          {LICENSED} licensed institutions with their leadership, branch networks, published documents and
          vacancies — each record traced to the page it came from, and marked with how confident that page
          lets us be.
        </p>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Figure term="Institutions" value={formatCount(LICENSED)} note="NRB licensed" />
          <Figure term="NRB documents" value={formatCount(distinctNrbDocuments().length)} note="published, unread" />
          <Figure term="People recorded" value={formatCount(people.length)} note="current roles only" />
          <Figure term="Pages monitored" value={formatCount(crawlSummary.snapshots)} note={`across ${crawlSummary.sources} sources`} />
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/institutions" className="lk-button">
            Browse institutions
          </Link>
          <Link href="/news" className="lk-button-secondary">
            Sector activity
          </Link>
        </div>
      </Container>
    </section>
  );
}

function Figure({ term, value, note }: { term: string; value: string | null; note: string }) {
  return (
    <div className="bg-white px-4 py-4 sm:px-5">
      <dt className="lk-eyebrow">{term}</dt>
      <dd className="lk-figure mt-1.5">{value ?? "—"}</dd>
      <dd className="mt-1 text-xs text-mfi-500">{note}</dd>
    </div>
  );
}

/**
 * The replacement for the "Live" ticker. It shows what actually changed, dated by
 * the source, and is captioned with the newest date in the dataset rather than a
 * claim of live coverage.
 */
function ActivityStrip() {
  if (recentActivity.length === 0) return null;
  return (
    <section aria-labelledby="activity-strip" className="border-b border-mfi-100 bg-mfi-900 text-white">
      <Container className="py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="activity-strip" className="text-sm font-semibold tracking-tight">
            Recent sector activity
          </h2>
          <p className="text-xs text-mfi-400">
            Most recent record: {formatDate(latestDate) ?? "undated"}
          </p>
        </div>
        <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {recentActivity.map((item) => (
            <li key={item.id} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0 font-mono text-xs text-mfi-400">
                {formatDate(item.occurredAt) ?? "undated"}
              </span>
              {item.href ? (
                <Link href={item.href} className="min-w-0 truncate underline-offset-2 hover:underline">
                  {item.title}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{item.title}</span>
              )}
            </li>
          ))}
        </ul>
        <Link
          href="/news"
          className="mt-4 inline-flex text-xs font-medium text-mfi-300 underline-offset-4 hover:text-white hover:underline"
        >
          All sector activity →
        </Link>
      </Container>
    </section>
  );
}

function DirectorySnapshot() {
  const top = byCapital.slice(0, 10);
  return (
    <Section
      eyebrow="Directory"
      title="Largest by published paid-up capital"
      description="Paid-up capital as published in the NRB BFI directory. This is capital on the books, not assets, deposits or profit — the directory does not publish those per institution."
      action={<SectionLink href="/institutions">All institutions</SectionLink>}
    >
      <div className="lk-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">
              Ten institutions ordered by published paid-up capital
            </caption>
            <thead>
              <tr className="border-b border-mfi-200 bg-mfi-50 text-left">
                <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Institution</th>
                <th scope="col" className="px-4 py-2.5 font-semibold text-mfi-800">Head office</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold text-mfi-800">Paid-up capital</th>
              </tr>
            </thead>
            <tbody className="lk-divide">
              {top.map((inst) => (
                <tr key={inst.id} className="transition-colors hover:bg-mfi-50">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    <Link href={`/institutions/${inst.slug}`} className="text-mfi-900 underline-offset-4 hover:underline">
                      {inst.name}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-mfi-600">{humanize(inst.headOffice) ?? "Not stated"}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-mfi-900">
                    {formatCrore(inst.paidUpCapitalCrore) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="lk-card p-5">
          <h3 className="text-sm font-semibold text-mfi-900">Working area as licensed</h3>
          <dl className="mt-3 space-y-2">
            {coverageRows.map(([area, count]) => (
              <div key={area} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="min-w-0 truncate text-mfi-600">{area}</dt>
                <dd className="shrink-0 font-mono tabular-nums text-mfi-900">{count}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-mfi-500">
            {CAPITALS > 0
              ? `Combined published paid-up capital across the ${byCapital.length} institutions that disclose it: ${formatCrore(CAPITALS)?.replace(" Cr", " crore")}.`
              : "No institution in this snapshot publishes paid-up capital."}
          </p>
        </div>
        <InstitutionSpotlight />
      </div>
    </Section>
  );
}

/**
 * A cross-section of the directory by working area, so the homepage shows how the
 * licensed population is spread rather than only the capital leaders.
 */
function InstitutionSpotlight() {
  const spread = institutions.filter((inst) => inst.coverageType === "province" || inst.coverageType === "district").slice(0, 6);
  if (spread.length === 0) {
    return (
      <div className="lk-card p-5">
        <EmptyState
          title="No province- or district-level institutions in this snapshot"
          detail="Every licensed institution in the directory is recorded as working nationally."
        />
      </div>
    );
  }
  return (
    <div className="lk-card p-5">
      <h3 className="text-sm font-semibold text-mfi-900">Working outside the national tier</h3>
      <p className="mt-1 text-xs text-mfi-500">
        Licensed to specific provinces or districts rather than operating nationally.
      </p>
      <ul className="mt-3 lk-divide text-sm">
        {spread.map((inst) => (
          <li key={inst.id} className="flex items-center gap-3 py-2">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded bg-mfi-100 text-[10px] font-bold text-mfi-700">
              {initials(inst.name)}
            </span>
            <span className="min-w-0 flex-1">
              <Link href={`/institutions/${inst.slug}`} className="block truncate font-medium text-mfi-900 underline-offset-4 hover:underline">
                {inst.name}
              </Link>
              <span className="block truncate text-xs text-mfi-500">
                {humanize(inst.headOffice) ?? "Head office not stated"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LatestActivity() {
  const events = activitySlice(5, "regulatory");
  if (events.length === 0) return null;
  return (
    <Section
      eyebrow="Structural change"
      title="Mergers, acquisitions and renames"
      description="Recorded in the NRB BFI directory. A merger means two licensed institutions became one; the surviving institution is the one named."
      action={<SectionLink href="/news">All activity</SectionLink>}
    >
      <ul className="lk-card lk-divide overflow-hidden">
        {events.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 sm:px-5">
            <span className="font-mono text-xs text-mfi-500">{formatDate(item.occurredAt) ?? "undated"}</span>
            <Link href={item.href ?? "#"} className="min-w-0 flex-1 font-medium text-mfi-900 underline-offset-4 hover:underline">
              {item.title}
            </Link>
            {item.institutionSlug ? (
              <Link href={`/institutions/${item.institutionSlug}`} className="text-xs text-mfi-600 underline-offset-4 hover:underline">
                {item.institutionName}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PeopleSnapshot() {
  return (
    <Section
      eyebrow="Leadership"
      title="People currently recorded"
      description={`${people.length} people across ${new Set(people.map((p) => p.institution_slug)).size} institutions. Only roles the institution currently lists are shown; past officeholders are not included. People with two names in one role are shown twice, because the source listed them twice.`}
      action={<SectionLink href="/people">All people</SectionLink>}
    >
      {featuredPeople.length === 0 ? (
        <EmptyState title="No leadership published yet" detail="No institution in this snapshot has a leadership page we could read." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {featuredPeople.map((person) => {
            const position = person.positions.find((p) => p.is_current) ?? person.positions[0];
            return (
              <li key={person.id} className="lk-card p-4">
                <p aria-hidden="true" className="lk-monogram">
                  {initials(person.name)}
                </p>
                <Link
                  href={`/people/${person.slug}`}
                  className="mt-2.5 block text-sm font-semibold leading-snug text-mfi-900 underline-offset-4 hover:underline"
                >
                  {person.name}
                </Link>
                <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">
                  {position ? humanize(position.title) ?? "Role not stated" : "Role not stated"}
                </p>
                <Link
                  href={`/institutions/${person.institution_slug}`}
                  className="mt-1.5 block truncate text-xs text-mfi-500 underline-offset-4 hover:underline"
                >
                  {person.institution_slug.replace(/-/g, " ")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * Financial and vacancy records, presented with the caveat attached rather than
 * below the fold. Both datasets are mostly *documents we found but did not read*,
 * and a reader shown a long list of report titles would reasonably assume the
 * numbers inside had been checked.
 */
function PublicationSnapshot() {
  const reportDocs = financials.filter((f) => f.kind === "REPORT").slice(0, 6);
  const openJobs = jobs.slice(0, 6);

  return (
    <Section
      eyebrow="Documents found"
      title="What institutions have published"
      description="These are documents we located and recorded the existence of. Their contents have not been read, so no figure is drawn from them here."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-mfi-900">Financial reports located</h3>
            <Link href="/financials" className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline">
              All {financials.length}
            </Link>
          </div>
          <ul className="lk-card lk-divide mt-3 overflow-hidden text-sm">
            {reportDocs.length === 0 ? (
              <li className="px-4 py-4">
                <EmptyState title="No financial reports located" detail="No institution in this snapshot links a report we could record." compact />
              </li>
            ) : (
              reportDocs.map((doc) => {
                const url = realUrl(doc.sourceDocument);
                return (
                  <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
                    <span className="min-w-0 flex-1 text-mfi-900">{doc.title}</span>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium text-mfi-700 underline-offset-4 hover:underline">
                        Source ↗
                      </a>
                    ) : (
                      <Chip tone="neutral">no link</Chip>
                    )}
                  </li>
                );
              })
            )}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-mfi-500">{financialsProvenance}.</p>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-mfi-900">Vacancies located</h3>
            <Link href="/jobs" className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline">
              All {jobs.length}
            </Link>
          </div>
          <ul className="lk-card lk-divide mt-3 overflow-hidden text-sm">
            {openJobs.length === 0 ? (
              <li className="px-4 py-4">
                <EmptyState title="No vacancies located" detail="No institution in this snapshot links a vacancy we could record." compact />
              </li>
            ) : (
              openJobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
                  <span className="min-w-0 flex-1 text-mfi-900">{job.title}</span>
                  <span className="shrink-0 text-xs text-mfi-500">{humanize(job.location) ?? "location not stated"}</span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-mfi-500">{jobsProvenance}.</p>
        </div>
      </div>
    </Section>
  );
}

/**
 * Methodology, given the prominence the previous version gave it. If the reader
 * is going to be told "we show our sources", the explanation belongs on the front
 * page rather than three clicks away.
 */
function Method() {
  return (
    <section className="border-t border-mfi-100 bg-white">
      <Container className="py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-mfi-900">How to read this</h2>
            <p className="mt-2 text-sm leading-relaxed text-mfi-600">
              Coverage is uneven, and the interface tries to make that visible rather than smooth it over.
            </p>
          </div>
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-semibold text-mfi-900">Every value has a source</dt>
              <dd className="mt-1 text-sm leading-relaxed text-mfi-600">
                Records name the page they came from and carry a confidence grade from the publisher, not from
                us. A field the page did not state shows as missing.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-mfi-900">Unread stays unread</dt>
              <dd className="mt-1 text-sm leading-relaxed text-mfi-600">
                Most financial and vacancy records here are documents we located but did not read. They are
                listed so you know the document exists — not so we can quote figures from it.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-mfi-900">Snapshots, not live feeds</dt>
              <dd className="mt-1 text-sm leading-relaxed text-mfi-600">
                Institution records come from a dated directory snapshot and pages are re-checked on a
                schedule. Dates are shown because they are the honest limit of the claim.
              </dd>
            </div>
          </dl>
        </div>
      </Container>
    </section>
  );
}
