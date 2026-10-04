import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { nrbSummary, nrbRegulatoryEvents } from "@/data/nrb";
import { distinctNrbDocuments } from "@/util/activity";
import { formatDate, humanize } from "@/util/format";
import { institutionHrefForSlug } from "@/util/institution-profile";
import type { Tone } from "@/util/evidence";
import { Stat } from "@/components/ui/Stat";

/**
 * NRB snapshot.
 *
 * This is the regulator's own catalogue: what it published, and what it recorded
 * happening to licensed institutions. Two things it deliberately does not do.
 *
 * It does not summarise documents. No PDF has been parsed, so a row can say a
 * report exists and when it was published, and nothing more. The previous version
 * of this page implied more coverage than existed by describing the corpus as
 * "evidence-backed", which is only true of the titles and dates.
 *
 * It does not infer event dates. Where the regulator records that a merger
 * happened but not when, the row says the date came from the observation date of
 * the snapshot rather than from the event itself.
 */

export const metadata: Metadata = {
  title: "NRB snapshot",
  description: `Documents published by Nepal Rastra Bank and structural changes it recorded, ${distinctNrbDocuments().length} documents and ${nrbSummary.regulatoryEvents} events. Catalogued, not read.`,
};

const DOC_TONE: Record<string, Tone> = {
  REPORT: "info",
  KFI: "positive",
  ENFORCEMENT: "conflict",
};

const EVENT_TONE: Record<string, Tone> = {
  MERGED: "info",
  ACQUIRED: "attention",
  RENAMED: "conflict",
};

export default function NrbPage() {
  // Deduplicated so the type counts and the rows below describe the same documents.
  const DOCS = distinctNrbDocuments();
  const docsByType = new Map<string, number>();
  for (const d of DOCS) docsByType.set(d.docType, (docsByType.get(d.docType) ?? 0) + 1);
  const docTypes = [...docsByType.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type);
  const eventTypes = Object.entries(nrbSummary.eventsByType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type);

  const dated = nrbRegulatoryEvents.filter((e) => e.occurredAt && !e.occurredAt.startsWith("1900")).length;
  const undated = nrbRegulatoryEvents.length - dated;

  return (
    <>
      <PageHeader
        eyebrow="Nepal Rastra Bank"
        title="The regulator&apos;s own record"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {DOCS.length} documents published by Nepal Rastra Bank and{" "}
          {nrbSummary.regulatoryEvents} structural changes it recorded across{" "}
          {nrbSummary.institutions} licensed institutions. Generated{" "}
          {formatDate(nrbSummary.generatedAt) ?? "at an unrecorded time"} from a universe observed{" "}
          {formatDate(nrbSummary.observedAt) ?? "at an unrecorded time"}. No PDF has been parsed and no OCR
          has been run, so nothing here summarises a document.
        </p>
        {nrbSummary.documents > DOCS.length ? (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mfi-600">
            The source lists carry {nrbSummary.documents} entries. Repeated documents are shown once
            here, so this page lists {DOCS.length} distinct documents rather than{" "}
            {nrbSummary.documents}. The reporting and financial-inclusion series are also listed on
            their own{" "}
            <Link href="/reports" className="underline underline-offset-4 hover:text-mfi-900">
              Reports
            </Link>{" "}
            page.
          </p>
        ) : null}
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 lg:grid-cols-4">
          <Stat term="Documents" value={DOCS.length} />
          <Stat term="Structural changes" value={nrbSummary.regulatoryEvents} />
          <Stat term="Institutions licensed" value={nrbSummary.institutions} />
          <Stat term="Source lists read" value={nrbSummary.sources.length} />
        </dl>

        <nav aria-label="Jump to a category" className="mt-6 flex flex-wrap gap-2">
          {docTypes.map((type) => (
            <a key={`d-${type}`} href={`#doc-${type.toLowerCase()}`}>
              <Chip tone={DOC_TONE[type] ?? "neutral"}>
                {humanize(type) ?? type} · {docsByType.get(type)}
              </Chip>
            </a>
          ))}
          {eventTypes.map((type) => (
            <a key={`e-${type}`} href={`#evt-${type.toLowerCase()}`}>
              <Chip tone={EVENT_TONE[type] ?? "neutral"}>
                {humanize(type) ?? type} · {nrbSummary.eventsByType[type]}
              </Chip>
            </a>
          ))}
        </nav>

        {docTypes.map((type) => {
          const docs = DOCS.filter((d) => d.docType === type);
          return (
            <section key={type} id={`doc-${type.toLowerCase()}`} className="mt-10 scroll-mt-24">
              <div className="flex flex-wrap items-baseline gap-2 border-b border-mfi-200 pb-2">
                <h2 className="text-base font-semibold tracking-tight text-mfi-900">
                  {humanize(type) ?? type}
                </h2>
                <span className="text-xs text-mfi-500">
                  {docs.length} documents · titles and dates only
                </span>
              </div>
              <ul className="lk-card lk-divide mt-3 overflow-hidden">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-mfi-50 sm:px-5"
                  >
                    <span className="min-w-0 flex-1 text-sm leading-snug text-mfi-900">
                      <a
                        href={doc.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {doc.title}
                      </a>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      {doc.topic ? <Chip>{doc.topic}</Chip> : null}
                      {doc.size ? (
                        <span className="font-mono text-xs text-mfi-400">{doc.size}</span>
                      ) : null}
                      <span className="font-mono text-xs tabular-nums text-mfi-500">
                        {formatDate(doc.publishedAt) ?? "undated"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="mt-12">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-mfi-200 pb-2">
            <h2 className="text-base font-semibold tracking-tight text-mfi-900">
              Structural changes
            </h2>
            <span className="text-xs text-mfi-500">
              {nrbSummary.regulatoryEvents} events · {dated} dated by the event, {undated} undated
            </span>
          </div>

          {eventTypes.map((type) => {
            const events = nrbRegulatoryEvents.filter((e) => e.eventType === type);
            return (
              <div key={type} id={`evt-${type.toLowerCase()}`} className="mt-5 scroll-mt-24">
                <div className="flex items-center gap-2">
                  <Chip tone={EVENT_TONE[type] ?? "neutral"}>{humanize(type) ?? type}</Chip>
                  <span className="text-xs text-mfi-500">{events.length} events</span>
                </div>
                <ul className="lk-card lk-divide mt-2 overflow-hidden">
                  {events.map((evt) => {
                    // Resolved server-side: some events name an institution the
                    // directory has no row for any more, so there is no profile
                    // page to point at and no link should be rendered.
                    const profile = institutionHrefForSlug(evt.institutionSlug);
                    return (
                      <li
                        key={evt.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3.5 transition-colors hover:bg-mfi-50 sm:px-5"
                      >
                        {profile ? (
                          <Link
                            href={profile}
                            className="text-sm font-medium text-mfi-900 underline-offset-4 hover:underline"
                          >
                            {evt.institutionName}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-mfi-900">{evt.institutionName}</span>
                        )}
                        <span className="min-w-0 flex-1 text-sm text-mfi-600">{evt.description}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-mfi-500">
                          {formatDate(evt.occurredAt) ?? "undated"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-mfi-500">
          Regenerated from the NRB public listing. Where the regulator records a structural change without
          an explicit event date, the row falls back to the date the universe was observed — so an
          &ldquo;undated&rdquo; row is a statement about the source, not a gap in this site. Aggregate
          catalogue only: no document contents are read, no per-institution figures are extracted here, and
          nothing is written by a model.
        </p>
      </Container>
    </>
  );
}

