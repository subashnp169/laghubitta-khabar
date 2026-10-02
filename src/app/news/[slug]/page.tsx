import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { nrbDocuments, nrbRegulatoryEvents } from "@/data/nrb";
import { formatDate, humanize, realUrl } from "@/util/format";
import { institutionHrefForSlug } from "@/util/institution-profile";

/**
 * A single regulatory record.
 *
 * Replaces the previous editorial-article route, which rendered invented posts.
 * Everything shown here is the directory's own wording: the event type, the
 * counterparty name, the date, and the evidence reference the record carries.
 *
 * The description field sometimes ends with an evidence pointer, sometimes with a
 * PDF URL. Both are rendered as given rather than being rewritten into prose, so
 * the reader can see what the source actually supplied.
 */

const EVENT_TONE: Record<string, "attention" | "info" | "conflict"> = {
  MERGED: "info",
  ACQUIRED: "attention",
  RENAMED: "conflict",
};

const EVENT_PHRASE: Record<string, string> = {
  MERGED: "Merged with",
  ACQUIRED: "Acquired",
  RENAMED: "Renamed to",
};

export function generateStaticParams() {
  return [
    ...nrbRegulatoryEvents.map((e) => ({ slug: e.id })),
    ...nrbDocuments.map((d) => ({ slug: d.id })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = nrbRegulatoryEvents.find((e) => e.id === slug);
  if (event) {
    return {
      title: `${EVENT_PHRASE[event.eventType] ?? event.eventType} ${event.title}`,
      description: `Recorded in the Nepal Rastra Bank BFI directory for ${event.institutionName}.`,
    };
  }
  const doc = nrbDocuments.find((d) => d.id === slug);
  if (doc) {
    return { title: doc.title, description: doc.sourceTitle };
  }
  return { title: "Not found" };
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const event = nrbRegulatoryEvents.find((e) => e.id === slug);
  if (event) {
    const phrase = EVENT_PHRASE[event.eventType] ?? event.eventType;
    const siblings = nrbRegulatoryEvents
      .filter((e) => e.institutionId === event.institutionId && e.id !== event.id)
      .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
      .slice(0, 8);

    return (
      <>
        <Container className="py-8 sm:py-10">
          <nav aria-label="Breadcrumb" className="text-xs text-mfi-500">
            <Link href="/news" className="underline-offset-4 hover:underline">
              News &amp; notices
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-mfi-700">{event.eventType.toLowerCase()}</span>
          </nav>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone={EVENT_TONE[event.eventType] ?? "info"}>{humanize(event.eventType)}</Chip>
            <span className="font-mono text-xs text-mfi-500">
              {formatDate(event.occurredAt) ?? "No date recorded"}
            </span>
          </div>

          <h1 className="mt-3 max-w-3xl text-2xl font-bold leading-tight tracking-tight text-mfi-900 sm:text-3xl">
            {phrase} {event.title}
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-mfi-600">{event.description}</p>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
            <Field term="Institution" value={event.institutionName} href={institutionHrefForSlug(event.institutionSlug) ?? undefined} />
            <Field term="Change" value={humanize(event.eventType) ?? event.eventType} />
            <Field term="Date" value={formatDate(event.occurredAt) ?? "Not recorded"} />
          </dl>

          <p className="mt-6 rounded-md border border-mfi-200 bg-white px-4 py-3 text-xs leading-relaxed text-mfi-600">
            <span className="font-semibold text-mfi-800">Source: </span>
            Nepal Rastra Bank BFI directory. The description above is the directory&apos;s own wording, not a
            summary written here.
          </p>

          {siblings.length > 0 ? (
            <section aria-labelledby="other-changes" className="mt-10">
              <h2 id="other-changes" className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
                Other recorded changes at {event.institutionName}
              </h2>
              <ul className="lk-card lk-divide mt-4 overflow-hidden">
                {siblings.map((sibling) => (
                  <li key={sibling.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                    <span className="font-mono text-xs text-mfi-500">
                      {formatDate(sibling.occurredAt) ?? "undated"}
                    </span>
                    <Link
                      href={`/news/${sibling.id}`}
                      className="min-w-0 flex-1 text-sm text-mfi-900 underline-offset-4 hover:underline"
                    >
                      {EVENT_PHRASE[sibling.eventType] ?? sibling.eventType} {sibling.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </Container>
      </>
    );
  }

  const doc = nrbDocuments.find((d) => d.id === slug);
  if (doc) {
    const url = realUrl(doc.officialUrl);
    return (
      <>
        <Container className="py-8 sm:py-10">
          <nav aria-label="Breadcrumb" className="text-xs text-mfi-500">
            <Link href="/news?kind=publication" className="underline-offset-4 hover:underline">
              NRB publications
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-mfi-700">{doc.docType.toLowerCase()}</span>
          </nav>

          <h1 className="mt-3 max-w-3xl text-2xl font-bold leading-tight tracking-tight text-mfi-900 sm:text-3xl">
            {doc.title}
          </h1>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3">
            <Field term="Published" value={formatDate(doc.publishedAt) ?? "Not recorded"} />
            <Field term="Type" value={humanize(doc.docType) ?? doc.docType} />
            <Field term="Size" value={doc.size ?? "Not recorded"} />
          </dl>

          <p className="mt-6 rounded-md border border-flag-200 bg-flag-50 px-4 py-3 text-xs leading-relaxed text-flag-700">
            <span className="font-semibold">This document has not been read.</span>{" "}
            {doc.sourceTitle} is recorded as published on {formatDate(doc.publishedAt) ?? "an unrecorded date"}.
            Nothing on this page summarises it, because nothing here has read it.
          </p>

          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="lk-button mt-4"
            >
              Open the source document ↗
            </a>
          ) : (
            <p className="mt-4 text-sm text-mfi-600">No usable link was recorded for this document.</p>
          )}

          <section aria-labelledby="related" className="mt-10">
            <h2 id="related" className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
              Related documents
            </h2>
            <ul className="lk-card lk-divide mt-4 overflow-hidden">
              {nrbDocuments
                .filter((d) => d.id !== doc.id && d.docType === doc.docType)
                .slice(0, 8)
                .map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                    <Link href={`/news/${d.id}`} className="min-w-0 flex-1 text-sm text-mfi-900 underline-offset-4 hover:underline">
                      {d.title}
                    </Link>
                    <span className="shrink-0 font-mono text-xs text-mfi-500">
                      {formatDate(d.publishedAt) ?? "undated"}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        </Container>
      </>
    );
  }

  notFound();
}

function Field({ term, value, href }: { term: string; value: string; href?: string }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <dt className="lk-eyebrow">{term}</dt>
      <dd className="mt-1 text-sm font-medium text-mfi-900">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
