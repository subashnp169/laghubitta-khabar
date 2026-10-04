import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { crawlSources, crawlSummary } from "@/data/pilot";
import { institutions } from "@/data/institutions";
import { formatDateTime, humanize } from "@/util/format";
import type { Tone } from "@/util/evidence";
import { Stat as MetricCell } from "@/components/ui/Stat";

/**
 * Every figure on this page is a pipeline count rather than a published fact, so
 * they all render in the dense cell. Wrapping once keeps twelve call sites
 * reading as plain metrics while the markup still has a single definition.
 */
function Stat(props: { term: string; value: string | number; tone?: Tone }) {
  return <MetricCell dense {...props} />;
}

/**
 * Ingestion control room.
 *
 * The previous version of this page described its own contents as "Live evidence
 * from the deterministic ingestion pipeline". That was not true of the page: it is
 * a static build, so the numbers on it were frozen when the site was last
 * generated. Nothing here refreshes while you watch it, and saying "live" invited
 * a reader to treat a stale number as current. The heading now states when the
 * snapshot was taken instead.
 *
 * Everything here is UNVERIFIED by default, which is why that word is in the
 * description rather than buried at the bottom.
 */

export const metadata: Metadata = {
  title: "Ingestion control room",
  description: `Source-monitoring snapshot: what was fetched from ${crawlSummary.sources} institution websites, and what is still missing. All extracted assertions are UNVERIFIED until human review.`,
};

const HEALTH_TONE: Record<string, Tone> = {
  HEALTHY: "positive",
  DEGRADED: "attention",
  UNHEALTHY: "conflict",
  "NEVER-RUN": "neutral",
};

const LAST_RUN_TONE: Record<string, Tone> = {
  SUCCESS: "positive",
  PARTIAL: "attention",
  FAILED: "conflict",
};

export default function IngestionPage() {
  const { schedule } = crawlSummary;
  // Failures are the interesting number on this page. Presenting "74 errors"
  // without the fetch/reason breakdown would overstate breakage; presenting it
  // without the pass count would understate health. Both are shown.
  const validationTotal = crawlSummary.passCount + crawlSummary.failCount + crawlSummary.pendingCount;

  return (
    <>
      <PageHeader
        eyebrow="Source monitoring"
        title="What we could fetch, and what we could not"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          A snapshot of {crawlSummary.sources} institution websites, taken{" "}
          {formatDateTime(crawlSummary.generatedAt) ?? "at an unrecorded time"}. It is a build artifact, not a
          live feed — the figures below are as of that moment. Nothing here is written by a model, nothing
          is OCR&apos;d, and every extracted assertion stays UNVERIFIED until a person reviews it.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4 lg:grid-cols-8">
          <Stat term="Sources" value={crawlSummary.sources} />
          <Stat
            term="With pages read"
            value={`${crawlSummary.withEvidence}/${crawlSummary.institutions}`}
            tone={crawlSummary.withEvidence === crawlSummary.institutions ? "positive" : "attention"}
          />
          <Stat term="Runs" value={crawlSummary.runs} />
          <Stat term="Snapshots" value={crawlSummary.snapshots} />
          <Stat term="Items captured" value={crawlSummary.items} />
          <Stat term="Documents" value={crawlSummary.documents} />
          <Stat term="Fetch errors" value={crawlSummary.errors} tone={crawlSummary.errors > 0 ? "attention" : "positive"} />
          <Stat
            term="Duplicate hash groups"
            value={crawlSummary.duplicateSnapshotGroups}
            tone={crawlSummary.duplicateSnapshotGroups === 0 ? "positive" : "attention"}
          />
        </dl>

        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Stat term="Validation passed" value={crawlSummary.passCount} tone="positive" />
          <Stat term="Validation failed" value={crawlSummary.failCount} tone={crawlSummary.failCount > 0 ? "conflict" : "neutral"} />
          <Stat term="Awaiting review" value={crawlSummary.pendingCount} />
          <Stat term="Open conflicts" value={crawlSummary.conflictsOpen} tone={crawlSummary.conflictsOpen === 0 ? "positive" : "conflict"} />
        </dl>

        <p className="mt-3 text-xs leading-relaxed text-mfi-500">
          {crawlSummary.passCount + crawlSummary.failCount} of {validationTotal.toLocaleString()} captured
          assertions have been checked, leaving {crawlSummary.pendingCount.toLocaleString()} awaiting a
          human. The two duplicate hash groups are identical page content recorded against different
          sources — expected where institutions share a template, and the reason{" "}
          {crawlSummary.documents} documents is below the number of distinct pages fetched.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="lk-eyebrow">Source health</span>
          <Chip tone="positive">{crawlSummary.healthy} healthy</Chip>
          <Chip tone="attention">{crawlSummary.degraded} degraded</Chip>
          <span className="ml-auto text-xs text-mfi-500">
            {crawlSummary.pdfSnapshots} PDFs stored as evidence, contents never read
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="lk-eyebrow">Fetch cadence</span>
          <Chip tone="info">{schedule.frequent} frequent</Chip>
          {schedule.periodic > 0 ? <Chip tone="neutral">{schedule.periodic} periodic</Chip> : null}
          {schedule.slow > 0 ? <Chip tone="neutral">{schedule.slow} slow</Chip> : null}
          {schedule.dueNow > 0 ? <Chip tone="attention">{schedule.dueNow} due for a refetch</Chip> : null}
          {schedule.paused > 0 ? <Chip tone="conflict">{schedule.paused} paused</Chip> : null}
          <span className="ml-auto text-xs text-mfi-500">
            Next fetch = last fetch + the cadence its site permits
          </span>
        </div>

        <div className="lk-card mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <caption className="sr-only">
                Per-source fetch history: runs, snapshots, items, documents, errors, cadence and health
              </caption>
              <thead>
                <tr className="border-b border-mfi-200 bg-mfi-50 text-left">
                  <Th>Institution</Th>
                  <Th>Website</Th>
                  <Th>Pages located</Th>
                  <Th align="right">Runs</Th>
                  <Th align="right">Snapshots</Th>
                  <Th align="right">Items</Th>
                  <Th align="right">Docs</Th>
                  <Th align="right">Branches</Th>
                  <Th align="right">Vacancies</Th>
                  <Th align="right">Fin. docs</Th>
                  <Th align="right">Errors</Th>
                  <Th>Last fetch</Th>
                  <Th>Cadence</Th>
                  <Th>Next</Th>
                  <Th>Health</Th>
                </tr>
              </thead>
              <tbody>
                {crawlSources.map((c) => {
                  const inst = institutions.find((i) => i.id === c.institutionId);
                  return (
                    <tr key={c.sourceId} className="border-b border-mfi-100 transition-colors last:border-0 hover:bg-mfi-50">
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium text-mfi-900">
                          {inst
                            ? inst.name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim()
                            : c.institutionId}
                        </div>
                        {inst ? (
                          <Link
                            href={`/institutions/${inst.slug}`}
                            className="text-[11px] text-mfi-600 underline underline-offset-2"
                          >
                            profile
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-[190px] truncate text-xs text-mfi-600 underline underline-offset-2"
                        >
                          {c.website}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex max-w-[230px] flex-wrap gap-1">
                          {c.capabilities.map((cap) => {
                            const loc = c.capabilityPages?.find((l) => l.capability === cap);
                            const label = humanize(cap) ?? cap;
                            return loc?.knownUrl ? (
                              <a
                                key={cap}
                                href={loc.knownUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Page located for ${label.toLowerCase()}: ${loc.knownUrl}`}
                                className="rounded bg-mfi-50 px-1.5 py-0.5 text-[10px] font-medium text-mfi-700 underline-offset-2 hover:bg-mfi-100 hover:underline"
                              >
                                {label}
                              </a>
                            ) : (
                              <span
                                key={cap}
                                title="No page located for this capability"
                                className="rounded bg-mfi-100 px-1.5 py-0.5 text-[10px] font-medium text-mfi-500"
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <Num>{c.runs}</Num>
                      <Num>{c.snapshots}</Num>
                      <Num>{c.items}</Num>
                      <Num>{c.documents}</Num>
                      <Num>{c.branchCount}</Num>
                      <Num>{c.vacancyCount}</Num>
                      <Num>{c.documentCount}</Num>
                      <Num tone={c.errors > 0 ? "attention" : undefined}>{c.errors}</Num>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs text-mfi-500">
                        {formatDateTime(c.lastRun) ?? "never"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top">
                        <span className="text-xs text-mfi-700">{c.cadenceMinutes} min</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top">
                        {c.paused ? (
                          <Chip tone="neutral">paused</Chip>
                        ) : c.isDue ? (
                          <Chip tone="attention">due</Chip>
                        ) : (
                          <span className="font-mono text-xs text-mfi-500">
                            {formatDateTime(c.nextDueAt) ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col items-start gap-1">
                          <Chip tone={HEALTH_TONE[c.status] ?? "neutral"} dot>
                            {humanize(c.status) ?? c.status}
                          </Chip>
                          {c.lastStatus ? (
                            <Chip tone={LAST_RUN_TONE[c.lastStatus] ?? "neutral"}>
                              {humanize(c.lastStatus) ?? c.lastStatus}
                            </Chip>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-mfi-500">
          This is the fetch log, not the truth about those institutions. A site can return HTTP 200 and still
          publish nothing findable; a page can be captured and later disappear. Counts above describe what
          the pipeline saw, and{" "}
          <Link href="/alerts" className="underline underline-offset-2">
            alerts
          </Link>{" "}
          lists the coverage gaps that result.
        </p>
      </Container>
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-mfi-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Num({ children, tone }: { children: React.ReactNode; tone?: Tone }) {
  const accent: Record<Tone, string> = {
    positive: "text-nrb-700",
    attention: "text-flag-700",
    conflict: "text-alert-700",
    info: "text-mfi-700",
    neutral: "text-mfi-600",
  };
  return (
    <td
      className={`px-3 py-2.5 text-right align-top tabular-nums ${
        tone ? accent[tone] : "text-mfi-600"
      }`}
    >
      {children}
    </td>
  );
}
