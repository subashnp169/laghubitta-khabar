import type { Metadata } from "next";
import Link from "next/link";
import { buildAlerts, countBySeverity } from "../../../lib/alerts";
import type { ConflictAlertInput, ConflictRecordType } from "../../../lib/alerts";
import {
  nrbRegulatoryEvents,
  crawlSources,
  institutions,
  openBranchConflicts,
  openPeopleConflicts,
  openFinancialConflicts,
  openDocumentConflicts,
} from "@/lib/site-data";
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
    "Unresolved evidence conflicts, regulatory events and coverage gaps derived from this project's records. Each alert links to the record that produced it.",
};

/**
 * A conflict row names the institution either by id (people) or inside an
 * entity id (`mfi-001|…`, `financial-mfi-002|…`, `document-mfi-003|…`). One
 * pattern reads the institution out of any of them, so no register needs a
 * bespoke parser.
 */
const INSTITUTION_ID = /(mfi-\d+)/i;

const institutionsById = new Map(institutions.map((i) => [i.id, i]));

function conflictInput(
  recordType: ConflictRecordType,
  scope: string,
  field: string,
): ConflictAlertInput {
  const match = scope.match(INSTITUTION_ID);
  const institutionId = match ? match[1] : null;
  const inst = institutionId ? institutionsById.get(institutionId) : undefined;
  return {
    id: `${scope}|${field}`,
    recordType,
    field,
    institutionId,
    institutionSlug: inst?.slug ?? null,
    institutionName: inst?.name ?? null,
  };
}

const SEVERITY_TONE: Record<string, Tone> = {
  high: "conflict",
  medium: "attention",
  low: "neutral",
};

export default function AlertsPage() {
  // Open conflicts are real rows in the evidence layer: two sources asserting
  // the same field differently. Today all four registers are empty, so this
  // contributes nothing but still reports that honestly (see the note below the
  // summary). It is wired, not faked — a conflict would appear the moment one is
  // recorded, with no invented date.
  const conflictInputs: ConflictAlertInput[] = [
    ...openBranchConflicts.map((c) => conflictInput("branch", c.entity_id, c.field_name)),
    ...openPeopleConflicts.map((c) => conflictInput("person", c.institution_id, c.field_name)),
    ...openFinancialConflicts.map((c) => conflictInput("financial", c.entity_id, c.field_name)),
    ...openDocumentConflicts.map((c) => conflictInput("document", c.entity_id, c.field_name)),
  ];

  const alerts = buildAlerts(nrbRegulatoryEvents, crawlSources, conflictInputs);
  const counts = countBySeverity(alerts);
  const nameByInst = new Map(institutions.map((i) => [i.id, i.name]));
  const conflicts = alerts.filter((a) => a.kind === "EVIDENCE_CONFLICT");
  const coverage = alerts.filter((a) => a.kind === "COVERAGE");
  const events = alerts.filter((a) => a.kind === "REGULATORY_EVENT");

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="What changed, and what we still do not have"
      >
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Three kinds of alert, all derived directly from records: fields where sources disagree, regulatory
          events the NRB directory recorded, and institutions whose pages we could not read. No
          interpretation, no recommendations.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="lk-eyebrow">By severity</span>
          <Chip tone="conflict">{counts.high} high</Chip>
          <Chip tone="attention">{counts.medium} medium</Chip>
          <Chip tone="neutral">{counts.low} low</Chip>
          <span className="ml-auto text-xs text-mfi-500">
            {conflicts.length} conflicts · {events.length} regulatory · {coverage.length} coverage
          </span>
        </div>

        {conflicts.length === 0 ? (
          <p className="mt-4 max-w-2xl text-xs leading-relaxed text-mfi-500">
            No unresolved evidence conflicts in this snapshot: across branches, leadership, financials and
            documents, no field is currently asserted two different ways. When one is, it appears above as a
            conflict — but only the disagreement is recorded, never an invented date for when it began.
          </p>
        ) : null}

        {alerts.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No alerts"
              detail="Nothing is flagged: no regulatory events are recorded and no coverage gaps were detected in this snapshot."
            />
          </div>
        ) : null}

        {conflicts.length > 0 ? (
          <AlertGroup
            title="Evidence conflicts"
            note="Fields two or more sources assert differently. The record is kept as-is and the disagreement is shown, never silently resolved to one value."
          >
            {conflicts.map((a) => {
              const profile = institutionHrefForSlug(a.institutionSlug);
              const name = a.institutionName ?? a.institutionId ?? "";
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                  <Chip tone={SEVERITY_TONE[a.severity] ?? "neutral"} className="mt-0.5 shrink-0">
                    {a.severity}
                  </Chip>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-mfi-900">{a.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">{a.detail}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mfi-500">
                      {profile && name ? (
                        <Link href={profile} className="font-medium text-mfi-700 underline underline-offset-2">
                          {name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim()}
                        </Link>
                      ) : name ? (
                        <span className="font-medium text-mfi-700">
                          {name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim()}
                        </span>
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
          Alerts are derived from the open conflict registers of the evidence layer, the NRB event ledger and
          the source-monitoring summary. This page is the alert surface only — nothing is emailed, messaged or
          pushed anywhere, because the site is a static build with no delivery channel.
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
