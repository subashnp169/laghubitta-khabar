"use client";

import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { displayHost, formatDate, humanize, realUrl } from "@/util/format";

/**
 * Document catalogue with origin filtering.
 *
 * Filtering is client state rather than a URL query because the site is a static
 * export: a `?origin=` query cannot be read at build time and there is no server
 * to redirect on. The trade-off is that an origin filter is not linkable, which
 * is why the control is a set of tabs with real counts rather than a hidden
 * query — the reader can see what selecting one will show.
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
}

type Filter = "all" | "nrb" | "institution";

const TYPE_LABEL: Record<string, string> = {
  ENFORCEMENT: "Enforcement",
  KFI: "Financial inclusion",
  REPORT: "Report",
  REPORT_NOTICE: "Rate notice",
};

export function DocumentCatalogue({ rows }: { rows: DocumentRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      nrb: rows.filter((r) => r.origin === "nrb").length,
      institution: rows.filter((r) => r.origin === "institution").length,
    }),
    [rows],
  );

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.origin === filter)),
    [rows, filter],
  );

  const dated = visible.filter((r) => r.date).length;
  const linked = visible.filter((r) => realUrl(r.url)).length;

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "All documents" },
    { key: "nrb", label: "Published by NRB" },
    { key: "institution", label: "Located on institution sites" },
  ];

  return (
    <div>
      <div role="group" aria-label="Filter documents by origin" className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={active}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${
                active
                  ? "border-mfi-900 bg-mfi-900 text-white"
                  : "border-mfi-200 bg-white text-mfi-700 hover:border-mfi-300 hover:bg-mfi-50"
              }`}
            >
              {tab.label}
              <span className={`font-mono text-xs ${active ? "text-mfi-200" : "text-mfi-400"}`}>
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
        <Stat term="Documents" value={String(visible.length)} />
        <Stat term="With a date" value={String(dated)} />
        <Stat term="Without a date" value={String(visible.length - dated)} />
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
                <Chip tone={row.origin === "nrb" ? "info" : "neutral"}>
                  {TYPE_LABEL[row.type] ?? humanize(row.type) ?? row.type}
                </Chip>
                <span className="font-mono text-xs text-mfi-500">{formatDate(row.date) ?? "undated"}</span>
                {realUrl(row.url) ? (
                  <span className="hidden text-xs text-mfi-400 sm:inline">
                    {displayHost(row.url) ?? "source"}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
