import type { Metadata } from "next";
import Link from "next/link";
import { buildAlerts, countBySeverity } from "../../../lib/alerts";
import { nrbRegulatoryEvents } from "@/data/nrb";
import { crawlSources } from "@/data/pilot";
import { institutions } from "@/data/institutions";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { institutionHrefForId, institutionHrefForSlug } from "@/util/institution-profile";
import { formatDate } from "@/util/format";
import type { Tone } from "@/util/evidence";

/**
 * Alerts.
 *
 * Every row here is derived mechanically from a record that exists: a regulatory
 * event in the NRB ledger, or a gap in ingestion coverage. Nothing is inferred,
 * scored by opinion, or recommended — which is why the page can state that
 * outright.
 *
 * The previous header labelled this "Phase 2 · Alerts · deterministic,
 * opinion-free", which is internal milestone vocabulary. Whether the logic is
 * deterministic is a property of the code, not something a reader of the page can
 * verify from the page, so it is described by what it produces instead.
 */

export const metadata: Metadata = {
  title: "Alerts",
  description:
    "Regulatory events and coverage gaps derived from this project's records. Each alert links to the record that produced it.",
};

const SEVERITY_TONE: Record<string, Tone> = {
  high: "conflict",
  medium: "attention",
  low: "neutral",
};

export default function AlertsPage() {
  const alerts = buildAlerts(nrbRegulatoryEvents, crawlSources);
  const counts = countBySeverity(alerts);
  const nameByInst = new Map(institutions.map((i) => [i.id, i.name]));
  const coverage = alerts.filter((a) => a.kind === "COVERAGE");
  const events = alerts.filter((a) => a.kind === "REGULATORY_EVENT");

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="What changed, and what we still do not have"
      >
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Two kinds of alert, both derived directly from records: structural changes the NRB directory
          recorded, and institutions whose pages we could not read. No interpretation, no recommendations.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="lk-eyebrow">By severity</span>
          <Chip tone="conflict">{counts.high} high</Chip>
          <Chip tone="attention">{counts.medium} medium</Chip>
          <Chip tone="neutral">{counts.low} low</Chip>
          <span className="ml-auto text-xs text-mfi-500">
            {events.length} regulatory · {coverage.length} coverage
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No alerts"
              detail="Nothing is flagged: no regulatory events are recorded and no coverage gaps were detected in this snapshot."
            />
          </div>
        ) : null}

        {coverage.length > 0 ? (
          <AlertGroup
            title="Coverage gaps"
            note="Institutions whose pages we could not read, or which have no records yet. These are absences in our data, not faults at the institution."
          >
            {coverage.map((a) => {
              const name = a.institutionId
                ? (nameByInst.get(a.institutionId) ?? a.institutionId)
                : (a.institutionId ?? "");
              // Coverage alerts carry an institution *id* in a field named
              // `institutionSlug` (see lib/alerts.ts), so they are resolved by id.
              const profile = institutionHrefForId(a.institutionId);
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                  <Chip tone={SEVERITY_TONE[a.severity] ?? "neutral"} className="mt-0.5 shrink-0">
                    {a.severity}
                  </Chip>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-mfi-900">{a.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">{a.detail}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mfi-500">
                      {profile ? (
                        <Link href={profile} className="font-medium text-mfi-700 underline underline-offset-2">
                          {name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim()}
                        </Link>
                      ) : (
                        <span className="font-medium text-mfi-700">
                          {name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim()}
                        </span>
                      )}
                      {a.occurredAt ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>observed {formatDate(a.occurredAt)}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span>{a.source}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </AlertGroup>
        ) : null}

        {events.length > 0 ? (
          <AlertGroup
            title="Regulatory events"
            note="Structural changes recorded in the NRB BFI directory. Each links to the record it came from."
          >
            {events.map((a) => {
              // Some regulatory events name an institution the directory has no
              // row for any more (merged or renamed away). The record stays; the
              // link does not, because there is no page to link to.
              const profile = institutionHrefForSlug(a.institutionSlug);
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                  <Chip tone={SEVERITY_TONE[a.severity] ?? "neutral"} className="mt-0.5 shrink-0">
                    {a.severity}
                  </Chip>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-mfi-900">{a.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">{a.detail}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mfi-500">
                      {profile ? (
                        <Link href={profile} className="font-medium text-mfi-700 underline underline-offset-2">
                          {a.institutionName}
                        </Link>
                      ) : (
                        <span className="font-medium text-mfi-700">{a.institutionName}</span>
                      )}
                      {a.occurredAt ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>observed {formatDate(a.occurredAt)}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <Link href="/news" className="underline underline-offset-2">
                        sector activity
                      </Link>
                    </p>
                  </div>
                </li>
              );
            })}
          </AlertGroup>
        ) : null}

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">
          Alerts are derived from the NRB event ledger and the source-monitoring summary. This page is the
          alert surface only — nothing is emailed, messaged or pushed anywhere, because the site is a static
          build with no delivery channel.
        </p>
      </Container>
    </>
  );
}

function AlertGroup({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mfi-500">{note}</p>
      <ul className="lk-card lk-divide mt-3 overflow-hidden">{children}</ul>
    </section>
  );
}
