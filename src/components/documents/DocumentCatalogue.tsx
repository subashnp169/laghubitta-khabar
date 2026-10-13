"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { displayHost, formatDate, realUrl } from "@/util/format";
import { Stat } from "@/components/ui/Stat";
import {
  DOCUMENT_CLASS_DETAIL,
  DOCUMENT_CLASS_LABEL,
  DOCUMENT_CLASS_ORDER,
  documentTypeLabel,
  type DocumentClass,
} from "@/util/documents";

/**
 * Document catalogue with origin + class filtering.
 *
 * Filtering is client state rather than a URL query because the site is a static
 * export: a `?origin=` query cannot be read at build time and there is no server
 * to redirect on. The trade-off is that a filter is not linkable, which is why
 * the controls are sets of tabs with real counts rather than a hidden query — the
 * reader can see what selecting one will show.
 *
 * Two orthogonal facets: **origin** is who published the document (NRB vs an
 * institution's own site) and **class** is what the evidence says it is. They are
 * separate because the same class can only come from one origin today, and
 * conflating them would hide that a class is regulator-published rather than
 * institution-published.
 */

export interface DocumentRow {
  id: string;
  title: string;
  type: string;
  publisher: string;
  date: string | null;
  size: string | null;
  url: string | null;
  origin: "nrb" | "institution";
  /** Evidence-derived taxonomy class; see `src/util/documents.ts`. */
  docClass: DocumentClass;
  /**
   * Profile of the institution this document came from, resolved on the server.
   *
   * A document found on an institution's own site is evidence about that
   * institution, so the row links back to the profile that carries the rest of its
   * record. Regulator publications have no single institution and so carry none.
   */
  institutionProfileHref?: string | null;
}

type OriginFilter = "all" | "nrb" | "institution";
type ClassFilter = "all" | DocumentClass;

const ORIGIN_TABS: Array<{ key: OriginFilter; label: string }> = [
  { key: "all", label: "All documents" },
  { key: "nrb", label: "Published by NRB" },
  { key: "institution", label: "Located on institution sites" },
];

function tabClass(active: boolean): string {
  return `inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
    active
      ? "border-mfi-900 bg-mfi-900 text-white"
      : "border-mfi-200 bg-white text-mfi-700 hover:border-mfi-300 hover:bg-mfi-50"
  }`;
}

export function DocumentCatalogue({ rows }: { rows: DocumentRow[] }) {
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [docClass, setDocClass] = useState<ClassFilter>("all");

  const originRows = useMemo(
    () => (origin === "all" ? rows : rows.filter((r) => r.origin === origin)),
    [rows, origin],
  );

  const classCounts = useMemo(() => {
    const counts = new Map<DocumentClass, number>();
    for (const row of originRows) counts.set(row.docClass, (counts.get(row.docClass) ?? 0) + 1);
    return counts;
  }, [originRows]);

  const originCounts = useMemo(
    () => ({
      all: rows.length,
      nrb: rows.filter((r) => r.origin === "nrb").length,
      institution: rows.filter((r) => r.origin === "institution").length,
    }),
    [rows],
  );

  const visible = useMemo(
    () => (docClass === "all" ? originRows : originRows.filter((r) => r.docClass === docClass)),
    [originRows, docClass],
  );

  const dated = visible.filter((r) => r.date).length;
  const linked = visible.filter((r) => realUrl(r.url)).length;
  const classesPresent = DOCUMENT_CLASS_ORDER.filter((c) => (classCounts.get(c) ?? 0) > 0);

  function selectOrigin(next: OriginFilter) {
    setOrigin(next);
    // Class counts are scoped to the origin facet, so a class that just vanished
    // must not stay selected and silently show nothing.
    setDocClass("all");
  }

  return (
    <div>
      <div role="group" aria-label="Filter documents by origin" className="flex flex-wrap gap-2">
        {ORIGIN_TABS.map((tab) => {
          const active = origin === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectOrigin(tab.key)}
              aria-pressed={active}
              className={tabClass(active)}
            >
              {tab.label}
              <span className={`font-mono text-xs ${active ? "text-mfi-200" : "text-mfi-400"}`}>
                {originCounts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div role="group" aria-label="Filter documents by class" className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDocClass("all")}
          aria-pressed={docClass === "all"}
          className={tabClass(docClass === "all")}
        >
          All classes
          <span className={`font-mono text-xs ${docClass === "all" ? "text-mfi-200" : "text-mfi-400"}`}>
            {originRows.length}
          </span>
        </button>
        {classesPresent.map((key) => {
          const active = docClass === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDocClass(active ? "all" : key)}
              aria-pressed={active}
              title={DOCUMENT_CLASS_DETAIL[key]}
              className={tabClass(active)}
            >
              {DOCUMENT_CLASS_LABEL[key]}
              <span className={`font-mono text-xs ${active ? "text-mfi-200" : "text-mfi-400"}`}>
                {classCounts.get(key) ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
        <Stat term="Documents shown" value={String(visible.length)} />
        <Stat term="Classes present" value={String(classesPresent.length)} fallback="None" />
        <Stat term="With a date" value={String(dated)} />
        <Stat term="Linked" value={String(linked)} />
      </dl>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No documents in this category" detail="Nothing in the catalogue matches this filter." />
        </div>
      ) : (
        <ul className="lk-card lk-divide mt-6 overflow-hidden">
          {visible.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-mfi-50 sm:px-5"
            >
              <span className="min-w-0 flex-1 text-sm leading-snug text-mfi-900">
                {realUrl(row.url) ? (
                  <a
                    href={row.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </a>
                ) : (
                  row.title
                )}
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                <Chip tone={row.origin === "nrb" ? "info" : "neutral"} title={DOCUMENT_CLASS_LABEL[row.docClass]}>
                  {documentTypeLabel(row.type)}
                </Chip>
                <span className="font-mono text-xs text-mfi-500">{formatDate(row.date) ?? "undated"}</span>
                {realUrl(row.url) ? (
                  <span className="hidden text-xs text-mfi-400 sm:inline">
                    {displayHost(row.url) ?? "source"}
                  </span>
                ) : null}
                {/* Back-link to the institution this document was found on. */}
                {row.institutionProfileHref ? (
                  <Link
                    href={row.institutionProfileHref}
                    className="text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
                  >
                    Institution profile →
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
