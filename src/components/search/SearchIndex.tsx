"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";

/**
 * Search over a prerendered index.
 *
 * The site builds with `output: "export"`, so there is no runtime server and no
 * query string to read at build time. The index is therefore compiled into this
 * page as a prop and filtered in the browser.
 *
 * The index is deliberately narrow — id, href, label, one short subtitle, one
 * kind — because it ships to the client on this page. Full record detail stays on
 * the record's own page, so nothing here needs to carry it.
 *
 * With JavaScript off the page still renders: it lists every group with its full
 * contents, which is the honest no-JS behaviour for a static export and is why
 * the unfiltered view is not hidden behind an input.
 */

export type IndexKind = "institution" | "person" | "job" | "document" | "event";

export interface IndexEntry {
  id: string;
  kind: IndexKind;
  label: string;
  /** One short line of context. Never a sentence built from unknown values. */
  meta: string;
  href: string | null;
  /** Extra text folded into the haystack but not displayed. */
  keywords?: string;
}

const KIND_LABEL: Record<IndexKind, string> = {
  institution: "Institutions",
  person: "People",
  job: "Vacancies",
  document: "Documents",
  event: "Regulatory activity",
};

const KIND_ORDER: IndexKind[] = ["institution", "person", "job", "event", "document"];

const MAX_PER_GROUP = 25;

export function SearchIndex({ entries }: { entries: IndexEntry[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const needle = deferred.trim().toLowerCase();

  const groups = useMemo(() => {
    const matched = needle
      ? entries.filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) ||
            entry.meta.toLowerCase().includes(needle) ||
            (entry.keywords ?? "").toLowerCase().includes(needle),
        )
      : entries;

    const byKind = new Map<IndexKind, IndexEntry[]>();
    for (const entry of matched) {
      const list = byKind.get(entry.kind);
      if (list) list.push(entry);
      else byKind.set(entry.kind, [entry]);
    }
    return byKind;
  }, [entries, needle]);

  const total = useMemo(() => {
    let sum = 0;
    for (const list of groups.values()) sum += list.length;
    return sum;
  }, [groups]);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="site-search" className="sr-only">
          Search the record
        </label>
        <input
          id="site-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Institution, person, vacancy, document…"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-md border border-mfi-200 bg-white px-3 text-sm text-mfi-900 outline-none placeholder:text-mfi-400 focus:border-mfi-500 focus:ring-2 focus:ring-mfi-200"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} className="lk-button-secondary shrink-0">
            Clear
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="mt-3 text-sm text-mfi-600">
        {needle ? (
          <>
            <span className="font-medium text-mfi-900">{total}</span>{" "}
            {total === 1 ? "match" : "matches"} for <span className="font-medium text-mfi-900">“{query.trim()}”</span>
          </>
        ) : (
          <>
            <span className="font-medium text-mfi-900">{entries.length}</span> records indexed
          </>
        )}
      </p>

      {needle && total === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No matches"
            detail="Nothing in this dataset contains that text. Records only exist where a source published one, so an absent result usually means the source did not say it."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {KIND_ORDER.map((kind) => {
            const list = groups.get(kind);
            if (!list || list.length === 0) return null;
            const shown = list.slice(0, MAX_PER_GROUP);
            return (
              <section key={kind} aria-labelledby={`kind-${kind}`}>
                <h2
                  id={`kind-${kind}`}
                  className="flex items-baseline gap-2 border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900"
                >
                  {KIND_LABEL[kind]}
                  <span className="font-mono text-xs font-normal text-mfi-500">{list.length}</span>
                </h2>

                <ul className="lk-card lk-divide mt-3 overflow-hidden">
                  {shown.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-mfi-50">
                      {entry.href ? (
                        <Link
                          href={entry.href}
                          className="min-w-0 flex-1 text-sm text-mfi-900 underline-offset-4 hover:underline"
                        >
                          {entry.label}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 text-sm text-mfi-900">{entry.label}</span>
                      )}
                      <span className="flex shrink-0 items-center gap-2">
                        {entry.meta ? (
                          <span className="truncate text-xs text-mfi-500">{entry.meta}</span>
                        ) : null}
                        {entry.href && entry.href.startsWith("http") ? (
                          <Chip tone="info">external</Chip>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                {list.length > MAX_PER_GROUP ? (
                  <p className="mt-2 text-xs text-mfi-500">
                    Showing {MAX_PER_GROUP} of {list.length}. Narrow the search to see the rest.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
