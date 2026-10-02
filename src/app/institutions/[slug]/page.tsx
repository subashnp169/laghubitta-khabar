import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { institutions, getInstitutionBySlug, directorySource } from "@/data/institutions";
import { crawlSources, crawlSummary } from "@/data/pilot";
import { nrbInstitutionLinks, nrbRegulatoryEvents } from "@/data/nrb";
import { institutionLeadership, institutionBranches } from "../../../../lib/api/repository";
import { jobs } from "@/data/jobs";
import { financials, type FinancialRecord } from "@/data/financials";
import type { BranchDto, PersonDto } from "../../../../lib/repository/types";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip, StatusChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Provenance } from "@/components/ui/Provenance";
import { sourceStatus, verificationStatus } from "@/util/evidence";
import {
  displayHost,
  formatCrore,
  formatDate,
  humanize,
  realUrl,
} from "@/util/format";

/**
 * Institution profile.
 *
 * The data wiring here is load-bearing and was built up over several milestones,
 * so it is preserved exactly: leadership, branches, vacancies and financial
 * documents all come from their validated read models and never from the legacy
 * crawl summary, whose counters describe pipeline metrics rather than published
 * facts.
 *
 * What this rewrite fixes is presentation and honesty of the surrounding chrome:
 *
 *  - The previous markup nested whole cards inside other cards and left the
 *    `<dl>` unclosed mid-element, which produced invalid output.
 *  - `operationDate` was rendered raw. One institution carries `1900-01-09`
 *    from a failed parse, which the old page printed as a confident founding
 *    date in 1900.
 *  - `paidUpCapitalCrore` was interpolated as `Rs {value} Cr`, printing
 *    "Rs null Cr" for any institution without the figure.
 *  - Both now go through the formatting helpers, so a missing value reads as
 *    missing.
 */

/** Role titles for one person, pluralised where a source lists several names. */
function roleLabels(person: PersonDto): string {
  return person.positions
    .map((pos) =>
      pos.shared_by > 1 && pos.title.endsWith("Officer")
        ? pos.title.replace(/Officer$/, "Officers")
        : pos.title,
    )
    .join(", ");
}

export async function generateStaticParams() {
  return institutions.map((inst) => ({ slug: inst.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const inst = getInstitutionBySlug(slug);
  if (!inst) return {};
  const short = inst.name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim() || inst.name;
  const office = humanize(inst.headOffice);
  return {
    title: short,
    description: `${inst.name}${office ? `, ${office}` : ""}. Licensed by Nepal Rastra Bank, working ${
      humanize(inst.workingArea) ?? "area not stated"
    }. Source-linked record.`,
  };
}

export default async function InstitutionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const inst = getInstitutionBySlug(slug);
  if (!inst) notFound();

  const crawl = crawlSources.find((c) => c.institutionId === inst.id);
  const nrbLinksFor = nrbInstitutionLinks.filter((l) => l.institutionId === inst.id);
  const nrbEvents = nrbRegulatoryEvents.filter((e) => e.institutionId === inst.id);
  const websiteUrl = realUrl(inst.officialWebsite) ?? realUrl(crawl?.website);

  // Published leadership comes from the validated People read model, not from the
  // legacy crawl summary. The crawl widget's peopleNames is 0 for every institution
  // and must never be shown as an "extracted" count for public leadership.
  const leadershipResponse = institutionLeadership(inst.slug, {});
  const leadership =
    leadershipResponse.status === 200 && "data" in leadershipResponse.body
      ? (leadershipResponse.body.data as PersonDto[])
      : [];

  // Published branches come from the validated Branch read model (M3.4), never
  // from the legacy crawl summary. The crawl widget's branchNames is stale and
  // must not be shown as the institution's public branch list.
  const branchesResponse = institutionBranches(inst.slug, {});
  const publishedBranches =
    branchesResponse.status === 200 && "data" in branchesResponse.body
      ? (branchesResponse.body.data as BranchDto[])
      : [];

  // Vacancies match on the institution's own slug prefix, which only happens when
  // the evidence resolved to this institution.
  const vacancyList = jobs.filter((j) => j.slug.startsWith(`${inst.slug}-`));
  const vacancyPostings = vacancyList.filter((j) => j.kind === "POSTING");
  const vacancyNotices = vacancyList.filter((j) => j.kind === "DOCUMENT");

  // Financial documents match on the institution id the generator resolved in the
  // evidence database, so a record can only appear here if it was observed from
  // this institution's own site.
  const institutionFinancials = financials.filter(
    (r) => (/^financial-([^|]+)\|/.exec(r.id) ?? ["", ""])[1] === inst.id,
  );
  const finReports = institutionFinancials.filter(
    (r): r is FinancialRecord & { kind: "REPORT" } => r.kind === "REPORT",
  );
  const finRates = institutionFinancials.filter(
    (r): r is FinancialRecord & { kind: "RATE" } => r.kind === "RATE",
  );

  const districts = [...new Set(publishedBranches.map((b) => b.district).filter(Boolean))].sort();

  const identity = inst.evidence.identity;
  const sources = identity
    ? [
        {
          id: identity.sourceId ?? "nrb-bfi-directory",
          label: directorySource.product,
          url: null as string | null,
          observedAt: identity.verifiedOn ?? null,
        },
      ]
    : [];

  return (
    <>
      <PageHeader eyebrow="Institution" title={inst.name}>
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          {humanize(inst.headOffice) ?? "Head office not stated in the source"} ·{" "}
          {humanize(inst.workingArea) ?? "working area not stated"} · directory record as of{" "}
          {formatDate(directorySource.asOf) ?? "an unrecorded date"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone={inst.licenseStatus === "licensed" ? "info" : "attention"}>
            {humanize(inst.licenseStatus) ?? "status unknown"}
          </Chip>
          {inst.licenseClass ? <Chip tone="neutral">Class {inst.licenseClass}</Chip> : null}
          {inst.coverageType ? <Chip tone="neutral">{humanize(inst.coverageType)} level</Chip> : null}
          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-7 items-center rounded-md border border-mfi-200 px-2.5 text-xs font-medium text-mfi-700 transition-colors hover:bg-mfi-50"
            >
              {displayHost(websiteUrl)} ↗
            </a>
          ) : (
            <Chip tone="attention" title="The directory records a candidate website that has not been confirmed.">
              website not confirmed
            </Chip>
          )}
        </div>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 lg:grid-cols-4">
          <Stat
            term="Paid-up capital"
            value={formatCrore(inst.paidUpCapitalCrore)}
            fallback="Not published"
          />
          <Stat
            term="In operation since"
            value={formatDate(inst.operationDate)}
            fallback="Not recorded"
          />
          <Stat term="Published people" value={String(leadership.length)} fallback="None published" />
          <Stat term="Published branches" value={String(publishedBranches.length)} fallback="None published" />
        </dl>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Panel
              title="Leadership"
              count={leadership.length === 1 ? "1 person" : `${leadership.length} people`}
              note="Current roles only. Past officeholders are not shown."
            >
              {leadership.length === 0 ? (
                <EmptyState
                  compact
                  title="No leadership published"
                  detail="This institution has no leadership page we could read. That is a gap in what we found, not a claim that it has no leadership."
                />
              ) : (
                <ul className="lk-divide">
                  {leadership.map((person) => (
                    <li key={person.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-2.5">
                      <Link
                        href={`/people/${person.slug}`}
                        className="text-sm font-medium text-mfi-900 underline-offset-4 hover:underline"
                      >
                        {person.name}
                      </Link>
                      <span className="text-xs text-mfi-600">{roleLabels(person)}</span>
                      {person.positions.some((p) => p.shared_by > 1) ? (
                        <Chip tone="attention" title="This source lists more than one person in this role. We publish every name it gave; we do not know why.">
                          {Math.max(...person.positions.map((p) => p.shared_by))} listed
                        </Chip>
                      ) : null}
                      <StatusChip status={verificationStatus(person.meta.verification_status)} />
                    </li>
                  ))}
                </ul>
              )}
              {leadership.some((p) => p.meta.source_url) ? (
                <p className="mt-3 text-xs text-mfi-500">
                  Read from{" "}
                  {realUrl(leadership[0].meta.source_url) ? (
                    <a
                      href={leadership[0].meta.source_url as string}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="break-all underline underline-offset-2"
                    >
                      {displayHost(leadership[0].meta.source_url)}
                    </a>
                  ) : (
                    "the institution's site"
                  )}
                  .
                </p>
              ) : null}
            </Panel>

            <Panel
              title="Branches"
              count={`${publishedBranches.length}`}
              note={
                districts.length > 0
                  ? `Across ${districts.length} ${districts.length === 1 ? "district" : "districts"}: ${districts.join(", ")}`
                  : "Districts not recorded"
              }
            >
              {publishedBranches.length === 0 ? (
                <EmptyState
                  compact
                  title="No branches published"
                  detail="No branch list was published on a page we could read for this institution."
                />
              ) : (
                <ul className="lk-card lk-divide max-h-96 overflow-y-auto">
                  {publishedBranches.map((branch) => (
                    <li key={branch.id} className="px-3.5 py-2.5">
                      <p className="text-sm font-medium text-mfi-900">{branch.name}</p>
                      <p className="text-xs text-mfi-500">
                        {[branch.municipality, branch.district].filter(Boolean).join(", ") ||
                          "Location not stated"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Vacancies"
              count={`${vacancyList.length}`}
              note={
                vacancyList.length > 0
                  ? `${vacancyPostings.length} parsed posting(s), ${vacancyNotices.length} unread notice(s)`
                  : "None located"
              }
            >
              {vacancyList.length === 0 ? (
                <EmptyState
                  compact
                  title="No vacancies located"
                  detail="This institution links no vacancy we could record."
                />
              ) : (
                <ul className="lk-card lk-divide overflow-hidden">
                  {vacancyList.slice(0, 8).map((job) => (
                    <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-3">
                      <span className="min-w-0 flex-1 text-sm text-mfi-900">{job.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Chip tone={job.kind === "POSTING" ? "info" : "attention"}>
                          {job.kind === "POSTING" ? "posting" : "unread notice"}
                        </Chip>
                        {realUrl(job.sourceDocument) ? (
                          <a
                            href={job.sourceDocument as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
                          >
                            {displayHost(job.sourceDocument)} ↗
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Financial documents"
              count={`${institutionFinancials.length}`}
              note={institutionFinancials.length > 0 ? "Catalogued only — contents not read" : "None located"}
            >
              {institutionFinancials.length === 0 ? (
                <EmptyState
                  compact
                  title="No financial documents located"
                  detail="This institution links no report or rate notice we could record."
                />
              ) : (
                <>
                  <ul className="lk-card lk-divide overflow-hidden">
                    {[...finReports, ...finRates].slice(0, 10).map((doc) => (
                      <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
                        <span className="min-w-0 flex-1 break-words text-sm text-mfi-900">{doc.title}</span>
                        <Chip tone={doc.kind === "REPORT" ? "info" : "attention"}>
                          {doc.kind === "REPORT"
                            ? doc.reportType
                              ? humanize(doc.reportType)
                              : "report"
                            : "rate notice"}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                  {institutionFinancials.length > 10 ? (
                    <p className="mt-2 text-xs text-mfi-500">
                      Showing 10 of {institutionFinancials.length}.{" "}
                      <Link href="/financials" className="underline underline-offset-2">
                        See all financial documents
                      </Link>
                      .
                    </p>
                  ) : null}
                </>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Where this record comes from" note={directorySource.product}>
              <Provenance sources={sources} status={identity?.grade ?? null} compact />
            </Panel>

            {nrbEvents.length > 0 ? (
              <Panel title="Recorded changes" count={`${nrbEvents.length}`}>
                <ul className="lk-divide">
                  {nrbEvents.slice(0, 6).map((event) => (
                    <li key={event.id} className="py-2.5">
                      <Link
                        href={`/news/${event.id}`}
                        className="text-sm text-mfi-900 underline-offset-4 hover:underline"
                      >
                        {event.title}
                      </Link>
                      <p className="text-xs text-mfi-500">
                        {humanize(event.eventType) ?? event.eventType} ·{" "}
                        {formatDate(event.occurredAt) ?? "undated"}
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel title="Source monitoring" note={`${crawlSummary.snapshots} snapshots across ${crawlSummary.sources} sources`}>
              <dl className="space-y-2 text-xs">
                <Row term="Pipeline status" value={<StatusChip status={sourceStatus(crawl?.status)} />} />
                <Row term="Pages stored" value={crawl ? String(crawl.snapshots) : "—"} />
                <Row term="Crawl runs" value={crawl ? String(crawl.runs) : "—"} />
                <Row term="Last checked" value={formatDate(crawl?.lastRun) ?? "not recorded"} />
                {nrbLinksFor.length > 0 ? (
                  <Row term="NRB documents linked" value={String(nrbLinksFor.length)} />
                ) : null}
              </dl>
              <Link
                href="/ingestion"
                className="mt-3 inline-flex text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
              >
                Control room →
              </Link>
            </Panel>

            <Panel title="Compare" note="Against other institutions in the directory">
              <Link href={`/compare?a=${inst.slug}`} className="lk-button-secondary w-full">
                Add to comparison
              </Link>
            </Panel>
          </div>
        </div>
      </Container>
    </>
  );
}

function Panel({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lk-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-mfi-900">{title}</h2>
        {count ? <span className="font-mono text-xs text-mfi-500">{count}</span> : null}
      </div>
      {note ? <p className="mt-1 text-xs leading-relaxed text-mfi-500">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ term, value, fallback }: { term: string; value: string | null; fallback: string }) {
  return (
    <div className="bg-white px-4 py-4">
      <dt className="lk-eyebrow">{term}</dt>
      <dd className="lk-figure mt-1.5">
        {value ?? <span className="text-sm font-normal text-flag-700">{fallback}</span>}
      </dd>
    </div>
  );
}

function Row({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-mfi-500">{term}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-mfi-800">{value}</dd>
    </div>
  );
}
