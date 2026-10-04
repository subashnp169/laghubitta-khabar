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
import { Container } from "@/components/ui/Section";
import { Breadcrumb, Panel, SectionNav, SectionSidebar } from "@/components/ui/Panel";
import { Row, Stat, StatGrid } from "@/components/ui/Stat";
import { Chip, StatusChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Provenance } from "@/components/ui/Provenance";
import { sourceStatus, verificationStatus, type Tone } from "@/util/evidence";
import { hasSharedRole, maxSharedBy, roleLabels } from "@/util/roles";
import {
  displayHost,
  formatCrore,
  formatDate,
  humanize,
  initials,
  realUrl,
} from "@/util/format";

/**
 * Institution profile — the platform's microsite template.
 *
 * This page is meant to read like a small institutional website rather than a
 * record in a directory table: a wide identity block, navigation across the
 * sections that actually exist, then the sections themselves, then the evidence.
 * The sidebar it used to carry is gone — nothing here was earning the space, and
 * it forced the primary content into two thirds of the viewport.
 *
 * The data wiring is load-bearing and is preserved exactly. Leadership, branches,
 * vacancies and financial documents all come from their validated read models
 * and never from the legacy crawl summary, whose counters describe pipeline
 * metrics rather than published facts.
 *
 * Honesty rules that shaped the layout:
 *
 *  - A field with no source says so. Nothing is inferred from a sibling record.
 *  - "NRB documents linked" was removed rather than relabelled. Every one of
 *    those 76 links carries a null `nrbDocumentId`; they are regulatory
 *    classifications and rulings, not documents, so counting them as documents
 *    overstated what we hold. The section that replaces it says what they are.
 *  - The per-field evidence table below exposes grades we already hold instead of
 *    summarising the record as a single "verified" claim.
 *  - Collection telemetry moved out of the profile body. Crawl runs and snapshot
 *    counts describe our pipeline, not this institution, so they now sit under
 *    Sources and methodology where they belong.
 */

/** Evidence grade to visual tone. A grade is a source-strength claim, not a status. */
const GRADE_TONE: Record<string, Tone> = {
  A: "positive",
  B: "info",
  C: "attention",
  D: "conflict",
};

/** What a regulatory link actually is. These are rulings and classifications. */
const LINK_TYPE_LABEL: Record<string, string> = {
  CLASS: "Classification",
  MERGED_BY_NRB: "Merger approved by NRB",
  ACTION: "Regulatory action",
};

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
  const operationDate =
    inst.operationDateStatus === "source_anomaly" ? null : formatDate(inst.operationDate);

  /**
   * Timeline events are assembled only from records this institution actually
   * has: the operation date we can evidence, branch establishments the branch
   * read model published, and NRB regulatory events. An event with no date is
   * not shown rather than being placed at an invented point in the sequence.
   */
  const timelineEvents = [
    ...(operationDate
      ? [
          {
            id: "established",
            date: operationDate,
            title: "Operation recorded",
            detail: `Establishment date published by ${directorySource.source.title}.`,
          },
        ]
      : []),
    ...publishedBranches
      .filter((b) => b.established_on)
      .map((b) => ({
        id: `branch-${b.id}`,
        date: formatDate(b.established_on) ?? b.established_on,
        title: `Branch established: ${b.name}`,
        detail: [b.municipality, b.district].filter(Boolean).join(", ") || "Location not stated",
      })),
    ...nrbEvents
      .filter((e) => e.occurredAt)
      .map((e) => ({
        id: e.id,
        date: formatDate(e.occurredAt) ?? (e.occurredAt as string),
        title: e.title,
        detail: e.description,
      })),
  ].sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    return da < db ? 1 : da > db ? -1 : 0;
  });

  const identity = inst.evidence.identity;
  const sources = [
    {
      id: identity?.sourceId ?? directorySource.source.id,
      label: directorySource.source.title,
      url: directorySource.source.url,
      observedAt: identity?.verifiedOn ?? null,
    },
  ];

  const shortName =
    inst.name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim() || inst.name;

  /**
   * Per-field evidence. These grades are already held on the record; showing them
   * is the difference between "we have this" and "here is how we know".
   */
  const evidenceRows: {
    field: string;
    value: string | null;
    grade?: string;
    seen?: string | null;
    state?: string | null;
  }[] = [
    {
      field: "Institution name",
      value: inst.name,
      grade: inst.evidence.identity?.grade,
      seen: inst.evidence.identity?.verifiedOn,
    },
    {
      field: "Head office",
      value: humanize(inst.headOffice),
      grade: inst.evidence.headOffice?.grade,
      seen: inst.evidence.headOffice?.verifiedOn ?? inst.evidence.headOffice?.asOf,
    },
    {
      field: "Working area",
      value: humanize(inst.workingArea),
      grade: inst.evidence.workingArea?.grade,
      seen: inst.evidence.workingArea?.verifiedOn ?? inst.evidence.workingArea?.asOf,
    },
    {
      field: "Paid-up capital",
      value: formatCrore(inst.paidUpCapitalCrore),
      grade: inst.evidence.paidUpCapitalCrore?.grade,
      seen: inst.evidence.paidUpCapitalCrore?.asOf,
    },
    {
      field: "Official website",
      value: websiteUrl ? displayHost(websiteUrl) : "Not confirmed",
      grade: inst.evidence.officialWebsite?.grade,
      state: inst.evidence.officialWebsite?.status,
    },
  ];

  const navItems = [
    { href: "#overview", label: "Overview" },
    { href: "#leadership", label: "Leadership", count: leadership.length },
    { href: "#branches", label: "Branches", count: publishedBranches.length },
    { href: "#financials", label: "Financials", count: finReports.length },
    { href: "#interest-rates", label: "Interest rates", count: finRates.length },
    { href: "#activity", label: "Activity", count: nrbEvents.length },
    { href: "#documents", label: "Documents", count: institutionFinancials.length },
    { href: "#careers", label: "Careers", count: vacancyList.length },
    { href: "#regulatory", label: "Regulatory", count: nrbLinksFor.length },
    { href: "#timeline", label: "Timeline" },
    { href: "#sources", label: "Sources" },
  ];

  return (
    <>
      {/* Institutional identity block. Full width, because this is the page's subject. */}
      <header className="border-b border-mfi-100 bg-white">
        <Container className="py-6 sm:py-8">
          <Breadcrumb
            items={[
              { href: "/", label: "Home" },
              { href: "/institutions", label: "Institutions" },
              { label: shortName },
            ]}
          />

          <div className="mt-4 flex items-start gap-4">
            <span aria-hidden="true" className="lk-monogram size-12 shrink-0 text-sm sm:size-14 sm:text-base">
              {initials(inst.name)}
            </span>
            <div className="min-w-0 flex-1">
              {/*
                The label is deliberate. This is our indexed record of an
                institution, not the institution's own website, and the page must
                not read as though we are speaking for them.
              */}
              <p className="lk-eyebrow">Laghubitta Khabar institutional profile</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-mfi-900 sm:text-3xl">
                {inst.name}
              </h1>
              {inst.aliases.length > 0 ? (
                <p className="mt-1.5 text-sm leading-relaxed text-mfi-500">
                  Also recorded as {inst.aliases.join(" · ")}
                </p>
              ) : null}
            </div>
          </div>

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
              <Chip
                tone="attention"
                title="The directory records a candidate website that has not been confirmed."
              >
                official website not confirmed
              </Chip>
            )}
          </div>

          <StatGrid className="mt-6">
            <Stat term="Paid-up capital" value={formatCrore(inst.paidUpCapitalCrore)} fallback="Not published" />
            <Stat term="In operation since" value={operationDate} fallback="Not published" />
            <Stat term="Published people" value={String(leadership.length)} fallback="None published" />
            <Stat term="Published branches" value={String(publishedBranches.length)} fallback="None published" />
          </StatGrid>

          {inst.operationDateStatus === "source_anomaly" ? (
            <p className="mt-3 text-sm leading-relaxed text-mfi-600">
              The NRB directory currently shows an implausible start date for this institution, so we do
              not reproduce it.{" "}
              {inst.operationDateNote
                ? `${inst.operationDateNote}.`
                : "The record is awaiting clarification from the source."}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="text-xs leading-relaxed text-mfi-500">
              Directory record as of {formatDate(directorySource.asOf) ?? "an unrecorded date"} ·{" "}
              {directorySource.source.publisher} · not the institution&apos;s own website
            </p>
            <Link
              href={`/compare?a=${inst.slug}`}
              className="lk-button-secondary shrink-0 px-3 text-xs"
            >
              Compare with others
            </Link>
          </div>
        </Container>
      </header>

      <Container className="py-6 sm:py-8">
        {/* Section navigation. Sticky, and every entry is a real anchor. The
            horizontal bar is the narrow-viewport presentation; wide viewports get
            the side rail below instead, so the links are never duplicated. */}
        <div className="sticky top-14 z-40 sm:top-16 lg:hidden">
          <SectionNav items={navItems} label="Institution sections" />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <SectionSidebar items={navItems} label="Institution sections">
                <p className="lk-eyebrow">Related</p>
                <ul className="mt-2 space-y-0.5">
                  <li>
                    <Link
                      href="/institutions"
                      className="flex min-h-9 items-center text-mfi-700 underline-offset-4 hover:text-mfi-900 hover:underline"
                    >
                      All institutions
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={`/compare?a=${inst.slug}`}
                      className="flex min-h-9 items-center text-mfi-700 underline-offset-4 hover:text-mfi-900 hover:underline"
                    >
                      Compare with others
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/interest-rates"
                      className="flex min-h-9 items-center text-mfi-700 underline-offset-4 hover:text-mfi-900 hover:underline"
                    >
                      Interest rates explained
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/nrb"
                      className="flex min-h-9 items-center text-mfi-700 underline-offset-4 hover:text-mfi-900 hover:underline"
                    >
                      NRB regulatory layer
                    </Link>
                  </li>
                </ul>
              </SectionSidebar>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
          <Panel
            id="overview"
            title="Overview"
            note="Every figure below is shown with the evidence grade we hold for that specific field."
          >
            <p className="max-w-prose text-sm leading-relaxed text-mfi-700">
              {inst.name}{" "}
              {inst.licenseStatus === "licensed"
                ? "is a licensed microfinance institution in the Nepal Rastra Bank directory."
                : "appears in the Nepal Rastra Bank directory with a status we could not read as licensed."}{" "}
              {humanize(inst.headOffice) ? `Its recorded head office is ${humanize(inst.headOffice)}. ` : ""}
              {humanize(inst.workingArea) ? `It works at ${humanize(inst.workingArea)}.` : ""}
            </p>

            <dl className="mt-4 divide-y divide-mfi-100 border-t border-mfi-100">
              {evidenceRows.map((row) => (
                <div
                  key={row.field}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                >
                  <dt className="text-sm text-mfi-500">{row.field}</dt>
                  <dd className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-mfi-900">
                      {row.value ?? "Not stated in the source"}
                    </span>
                    {row.grade ? (
                      <Chip
                        tone={GRADE_TONE[row.grade] ?? "neutral"}
                        title={`Source grade ${row.grade} for this field. A grade describes how strong the source is, not whether we verified the claim ourselves.`}
                      >
                        Grade {row.grade}
                      </Chip>
                    ) : null}
                    {row.state ? <Chip tone="attention">{humanize(row.state)}</Chip> : null}
                    {row.seen ? (
                      <span className="text-xs text-mfi-500">
                        as of {formatDate(row.seen) ?? row.seen}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>

            {inst.sourceNameRaw && inst.sourceNameRaw !== inst.name ? (
              <p className="mt-3 text-xs leading-relaxed text-mfi-500">
                The directory spells this institution &ldquo;{inst.sourceNameRaw}&rdquo;. We keep the
                regulator&apos;s spelling unchanged.
              </p>
            ) : null}
          </Panel>

          <Panel
            id="leadership"
            title="Leadership"
            count={leadership.length === 1 ? "1 person" : `${leadership.length} people`}
            note="Current roles only. Past officeholders are not shown."
          >
            {leadership.length === 0 ? (
              <EmptyState
                compact
                title="No leadership published"
                detail="This institution has no leadership page we could read. That is a gap in what we found, not a claim that it has no leadership."
                action={
                  <Link href="/people" className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline">
                    See all published people
                  </Link>
                }
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
                    {hasSharedRole(person) ? (
                      <Chip
                        tone="attention"
                        title="This source lists more than one person in this role. We publish every name it gave; we do not know why."
                      >
                        {maxSharedBy(person)} listed
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
            id="branches"
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
              <ul className="lk-card lk-divide max-h-[28rem] overflow-y-auto">
                {publishedBranches.map((branch) => (
                  <li key={branch.id} className="px-3.5 py-2.5">
                    <p className="text-sm font-medium text-mfi-900">{branch.name}</p>
                    <p className="text-xs text-mfi-500">
                      {[branch.address, branch.municipality, branch.district].filter(Boolean).join(", ") ||
                        "Location not stated"}
                    </p>
                    {branch.established_on ? (
                      <p className="mt-0.5 text-xs text-mfi-500">
                        Established {formatDate(branch.established_on) ?? branch.established_on}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            id="financials"
            title="Financial documents"
            count={`${finReports.length}`}
            note="Reports this institution published, catalogued by type. Contents have not been read, so no figure from them is shown."
          >
            {finReports.length === 0 ? (
              <EmptyState
                compact
                title="No financial reports located"
                detail="No annual, quarterly or interim report from this institution has been catalogued."
              />
            ) : (
              <ul className="lk-card lk-divide overflow-hidden">
                {finReports.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1 break-words text-sm text-mfi-900">{doc.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-mfi-500">
                        last verified {formatDate(doc.lastSeenAt) ?? "undated"}
                      </span>
                      <Chip tone="info">
                        {doc.reportType ? humanize(doc.reportType) : "report"}
                      </Chip>
                      {realUrl(doc.sourceDocument) ? (
                        <a
                          href={doc.sourceDocument as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
                        >
                          {displayHost(doc.sourceDocument)} ↗
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            id="interest-rates"
            title="Interest rates"
            count={`${finRates.length}`}
            note="Rate notices this institution published. No rate value has been extracted from any notice, so none is shown."
          >
            {finRates.length === 0 ? (
              <EmptyState
                compact
                title="Not extracted"
                detail="No interest-rate notice from this institution has been catalogued. Absence here is not a rate of zero."
              />
            ) : (
              <>
                <ul className="lk-card lk-divide overflow-hidden">
                  {finRates.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5"
                    >
                      <span className="min-w-0 flex-1 break-words text-sm text-mfi-900">{doc.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-mfi-500">
                          last verified {formatDate(doc.lastSeenAt) ?? "undated"}
                        </span>
                        <Chip tone="attention">
                          {doc.rateKind ? humanize(doc.rateKind) : "rate notice"}
                        </Chip>
                        {realUrl(doc.sourceDocument) ? (
                          <a
                            href={doc.sourceDocument as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
                          >
                            {displayHost(doc.sourceDocument)} ↗
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-mfi-500">
                  Rate values are not extracted from these notices.{" "}
                  <Link href="/interest-rates" className="underline underline-offset-2">
                    Why there are no rates
                  </Link>
                  .
                </p>
              </>
            )}
          </Panel>

          <Panel
            id="timeline"
            title="Timeline"
            count={`${timelineEvents.length}`}
            note="Events we can evidence for this institution, most recent first. An event without a verifiable date is not listed."
          >
            {timelineEvents.length === 0 ? (
              <EmptyState
                compact
                title="No dated events"
                detail="No establishment date, branch opening or regulatory event with a verifiable date is on record."
              />
            ) : (
              <ol className="lk-card lk-divide overflow-hidden">
                {timelineEvents.slice(0, 25).map((event) => (
                  <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5">
                    <span className="shrink-0 font-mono text-xs text-mfi-500">{event.date}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-mfi-900">{event.title}</span>
                      {event.detail ? (
                        <span className="block text-xs text-mfi-500">{event.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {timelineEvents.length > 25 ? (
              <p className="mt-3 text-xs text-mfi-500">
                Showing 25 of {timelineEvents.length} dated events.
              </p>
            ) : null}
          </Panel>

          <Panel
            id="activity"
            title="Latest activity"
            count={`${nrbEvents.length}`}
            note="Regulatory activity Nepal Rastra Bank has recorded against this institution."
          >
            {nrbEvents.length === 0 ? (
              <EmptyState
                compact
                title="No recorded activity"
                detail="The regulator's published lists record no event against this institution. Absence of a record is not evidence that nothing happened."
              />
            ) : (
              <ul className="lk-divide">
                {nrbEvents.slice(0, 10).map((event) => (
                  <li key={event.id} className="py-2.5">
                    <Link
                      href={`/news/${event.id}`}
                      className="text-sm text-mfi-900 underline-offset-4 hover:underline"
                    >
                      {event.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-mfi-500">
                      {humanize(event.eventType) ?? event.eventType} ·{" "}
                      {formatDate(event.occurredAt) ?? "undated"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {nrbEvents.length > 10 ? (
              <p className="mt-3 text-xs text-mfi-500">
                Showing 10 of {nrbEvents.length}.{" "}
                <Link href="/nrb" className="underline underline-offset-2">
                  See the full regulatory record
                </Link>
                .
              </p>
            ) : null}
          </Panel>

          <Panel
            id="documents"
            title="Documents"
            count={`${institutionFinancials.length}`}
            note="Catalogued from this institution's own site. Contents have not been read."
          >
            {institutionFinancials.length === 0 ? (
              <EmptyState
                compact
                title="No documents located"
                detail="This institution links no report or rate notice we could record."
              />
            ) : (
              <>
                <ul className="lk-card lk-divide overflow-hidden">
                  {[...finReports, ...finRates].slice(0, 12).map((doc) => (
                    <li
                      key={doc.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-2.5"
                    >
                      <span className="min-w-0 flex-1 break-words text-sm text-mfi-900">
                        {doc.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-mfi-500">
                          {formatDate(doc.lastSeenAt) ?? "undated"}
                        </span>
                        <Chip tone={doc.kind === "REPORT" ? "info" : "attention"}>
                          {doc.kind === "REPORT"
                            ? doc.reportType
                              ? humanize(doc.reportType)
                              : "report"
                            : "rate notice"}
                        </Chip>
                        {realUrl(doc.sourceDocument) ? (
                          <a
                            href={doc.sourceDocument as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
                          >
                            {displayHost(doc.sourceDocument)} ↗
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-mfi-500">
                  {institutionFinancials.length > 12
                    ? `Showing 12 of ${institutionFinancials.length}. `
                    : ""}
                  <Link href="/financials" className="underline underline-offset-2">
                    See all financial documents
                  </Link>
                  .
                </p>
              </>
            )}
          </Panel>

          <Panel
            id="careers"
            title="Careers"
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
                {vacancyList.slice(0, 10).map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-mfi-900">{job.title}</span>
                      <span className="mt-0.5 block text-xs text-mfi-500">
                        {[humanize(job.type), humanize(job.location), humanize(job.status)]
                          .filter(Boolean)
                          .join(" · ") || "Role details not stated"}
                        {job.deadline ? ` · deadline ${formatDate(job.deadline) ?? job.deadline}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip
                        tone={job.kind === "POSTING" ? "info" : "attention"}
                        title={
                          job.kind === "POSTING"
                            ? "A posting we parsed out of a page, so its fields were readable."
                            : "A notice we linked but did not open. We have not read it."
                        }
                      >
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
            id="regulatory"
            title="Regulatory record"
            count={`${nrbLinksFor.length}`}
            note="Classifications and rulings the regulator's published lists attach to this institution. These are not documents we hold."
          >
            {nrbLinksFor.length === 0 ? (
              <EmptyState
                compact
                title="No regulatory links recorded"
                detail="The regulator's published lists attach no classification or ruling to this institution."
              />
            ) : (
              <ul className="lk-divide">
                {nrbLinksFor.map((link) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5"
                  >
                    <span className="text-sm text-mfi-900">
                      {humanize(link.linkType) ?? link.linkType}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip tone={link.linkType === "ACTION" ? "attention" : "info"}>
                        {LINK_TYPE_LABEL[link.linkType] ?? humanize(link.linkType) ?? link.linkType}
                      </Chip>
                      <span className="text-xs text-mfi-500">
                        {formatDate(link.linkDate) ?? "undated"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs leading-relaxed text-mfi-500">
              <Link href="/nrb" className="underline underline-offset-2">
                See the regulator&apos;s published record
              </Link>{" "}
              for how these are counted and where they come from.
            </p>
          </Panel>

          <Panel
            id="sources"
            title="Sources and methodology"
            note="What this page is built from, and how our own collection is checked."
          >
            <Provenance sources={sources} status={identity?.grade ?? null} />

            <p className="mt-4 max-w-prose text-xs leading-relaxed text-mfi-600">
              Identity, head office, working area and paid-up capital come from the{" "}
              {directorySource.source.publisher} directory snapshot of{" "}
              {formatDate(directorySource.asOf) ?? "an unrecorded date"}. Leadership, branches and
              vacancies come from pages on the institution&apos;s own website that we could read. We
              have not read any financial document and no figure on this page comes from one.
            </p>

            <dl className="mt-4 space-y-2 border-t border-mfi-100 pt-4 text-xs">
              <Row term="Pipeline status" value={<StatusChip status={sourceStatus(crawl?.status)} />} />
              <Row term="Pages stored" value={crawl ? String(crawl.snapshots) : "—"} />
              <Row term="Crawl runs" value={crawl ? String(crawl.runs) : "—"} />
              <Row term="Institution site last checked" value={formatDate(crawl?.lastRun) ?? "not recorded"} />
              <Row term="Directory snapshot" value={formatDate(directorySource.asOf) ?? "not recorded"} />
              <Row term="Published by regulator" value={formatDate(directorySource.publishedByNRB) ?? "not recorded"} />
            </dl>

            <p className="mt-3 text-xs text-mfi-500">
              These last figures describe our collection process, not this institution.{" "}
              <Link href="/ingestion" className="font-medium text-mfi-700 underline underline-offset-2">
                Collection control room
              </Link>
              .
            </p>
          </Panel>
          </div>
        </div>
      </Container>
    </>
  );
}