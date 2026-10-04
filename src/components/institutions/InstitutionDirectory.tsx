"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import InstitutionCard from "@/components/institutions/InstitutionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Institution } from "@/types";
import { formatCrore, formatDate, humanize, initials } from "@/util/format";

/**
 * Directory with client-side search, filter and sort.
 *
 * The site is a static export, so `?q=` cannot be read at build time and there is
 * no server to handle a form GET. Filtering therefore happens in the browser
 * over the directory already in the page.
 *
 * That gives up linkable filtered views, which is a real cost and is why each
 * control shows what it can do: the result count updates as you type, and the
 * filter options are built from the values present in the data rather than a
 * hand-written list, so a coverage type cannot appear as a dead option.
 */

type Sort = "capital" | "name" | "oldest";

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: "capital", label: "Paid-up capital" },
  { key: "name", label: "Name (A–Z)" },
  { key: "oldest", label: "Oldest first" },
];

/**
 * Display preference, kept out of the filter state on purpose: switching between
 * card and table changes how the same results are shown, so it must not clear a
 * search the reader has already typed.
 */
type View = "grid" | "table";
const VIEW_KEY = "lk-directory-view";
const VIEW_DEFAULT: View = "grid";

/**
 * The stored layout is an external store rather than plain component state.
 *
 * `useSyncExternalStore` is what makes this safe for a static export: the server
 * snapshot is always the grid default, so the pre-rendered HTML and the first
 * client render agree, and React applies the stored preference afterwards without
 * a hydration mismatch. Writing the preference notifies the same-tab subscribers,
 * which `localStorage` alone does not do.
 */
const viewListeners = new Set<() => void>();

function readStoredView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "table" ? "table" : VIEW_DEFAULT;
  } catch {
    // Private browsing or blocked storage: the default view still renders.
    return VIEW_DEFAULT;
  }
}

function subscribeView(onChange: () => void) {
  viewListeners.add(onChange);
  // Another tab changing the preference should move this one too.
  window.addEventListener("storage", onChange);
  return () => {
    viewListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeStoredView(next: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    // A preference that cannot be persisted is not worth an error message.
  }
  for (const listener of viewListeners) listener();
}

export function InstitutionDirectory({
  institutions,
  areas,
}: {
  institutions: Institution[];
  areas: string[];
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [sort, setSort] = useState<Sort>("capital");
  const view = useSyncExternalStore(subscribeView, readStoredView, () => VIEW_DEFAULT);

  const changeView = (next: View) => writeStoredView(next);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = institutions.filter((inst) => {
      if (area && inst.workingArea !== area) return false;
      if (!needle) return true;
      return (
        inst.name.toLowerCase().includes(needle) ||
        inst.sourceNameRaw.toLowerCase().includes(needle) ||
        // Aliases matter: readers type "MITHILA" or "deprosc", and the directory
        // records those as alternate names. Matching them makes the filter behave
        // the way someone typing an abbreviation would expect.
        inst.aliases.some((alias) => alias.toLowerCase().includes(needle)) ||
        inst.headOffice.toLowerCase().includes(needle)
      );
    });

    return [...matched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "oldest") {
        // The 1900-01-09 sentinel and unknown dates sort last, not first, so
        // "oldest first" cannot be led by institutions that were never dated.
        const av = Number(a.operationDate.slice(0, 4)) || 9999;
        const bv = Number(b.operationDate.slice(0, 4)) || 9999;
        return av - bv;
      }
      return b.paidUpCapitalCrore - a.paidUpCapitalCrore;
    });
  }, [institutions, query, area, sort]);

  const hasFilters = query.trim() !== "" || area !== "" || sort !== "capital";

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="dir-q" className="sr-only">
            Filter by name, alias or city
          </label>
          <input
            id="dir-q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, alias or city…"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-mfi-200 bg-white px-3 text-sm text-mfi-900 outline-none placeholder:text-mfi-400 focus:border-mfi-500 focus:ring-2 focus:ring-mfi-200"
          />
        </div>

        <div>
          <label htmlFor="dir-area" className="sr-only">
            Filter by working area
          </label>
          <select
            id="dir-area"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            className="h-11 w-full rounded-md border border-mfi-200 bg-white px-3 text-sm text-mfi-900 outline-none focus:border-mfi-500 focus:ring-2 focus:ring-mfi-200"
          >
            <option value="">All working areas</option>
            {areas.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="dir-sort" className="sr-only">
            Sort order
          </label>
          <select
            id="dir-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="h-11 w-full rounded-md border border-mfi-200 bg-white px-3 text-sm text-mfi-900 outline-none focus:border-mfi-500 focus:ring-2 focus:ring-mfi-200"
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-mfi-600">
          {hasFilters ? (
            <>
              <span className="font-medium text-mfi-900">{filtered.length}</span> of{" "}
              {institutions.length} institutions
              {query.trim() ? (
                <>
                  {" "}
                  matching <span className="font-medium text-mfi-900">“{query.trim()}”</span>
                </>
              ) : null}
              {area ? ` in ${area}` : ""}
            </>
          ) : (
            <>
              Showing all{" "}
              <span className="font-medium text-mfi-900">{institutions.length}</span> institutions
            </>
          )}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setArea("");
              setSort("capital");
            }}
            className="lk-button-secondary h-9 min-h-9 px-3 text-xs"
          >
            Clear filters
          </button>
        ) : null}

        <div
          className="flex items-center gap-1 rounded-md border border-mfi-200 bg-white p-0.5"
          role="group"
          aria-label="Result layout"
        >
          {(
            [
              { key: "grid", label: "Cards" },
              { key: "table", label: "Table" },
            ] as Array<{ key: View; label: string }>
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => changeView(option.key)}
              aria-pressed={view === option.key}
              className={`h-8 min-h-8 rounded px-3 text-xs font-medium transition-colors ${
                view === option.key
                  ? "bg-mfi-800 text-white"
                  : "text-mfi-600 hover:bg-mfi-100 hover:text-mfi-900"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No institutions match those filters"
            detail="Try a shorter term — the directory matches full names, recorded aliases and head-office districts, not every abbreviation."
          />
        </div>
      ) : view === "table" ? (
        <InstitutionTable institutions={filtered} />
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((inst) => (
            <InstitutionCard key={inst.id} institution={inst} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tabular view of the same filtered rows.
 *
 * Carries no fields the cards do not already show, and every cell uses the same
 * formatters, so switching views cannot reveal a value the grid view hid. Dates
 * that failed to parse upstream format as "Not stated" rather than as a sentinel
 * year, and a missing capital reads as an em dash, not as zero.
 */
function InstitutionTable({ institutions }: { institutions: Institution[] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-md border border-mfi-200 bg-white">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">
          Microfinance institutions matching the current filters, with the same values shown on each card.
        </caption>
        <thead>
          <tr className="border-b border-mfi-200 bg-mfi-50">
            <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-mfi-700">
              Institution
            </th>
            <th scope="col" className="hidden px-3 py-2.5 text-xs font-semibold text-mfi-700 sm:table-cell">
              Head office
            </th>
            <th scope="col" className="hidden px-3 py-2.5 text-xs font-semibold text-mfi-700 md:table-cell">
              Working area
            </th>
            <th
              scope="col"
              className="px-3 py-2.5 text-right text-xs font-semibold text-mfi-700"
            >
              Paid-up capital
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 text-xs font-semibold text-mfi-700 lg:table-cell"
            >
              Operating since
            </th>
          </tr>
        </thead>
        <tbody>
          {institutions.map((inst) => {
            const since = formatDate(inst.operationDate);
            return (
              <tr key={inst.id} className="border-b border-mfi-100 last:border-0">
                <th scope="row" className="px-3 py-2.5 font-normal">
                  <Link
                    href={`/institutions/${inst.slug}`}
                    className="flex items-center gap-2.5 hover:underline hover:underline-offset-2"
                  >
                    <span aria-hidden="true" className="lk-monogram shrink-0 text-xs">
                      {initials(inst.name)}
                    </span>
                    <span className="font-medium text-mfi-900">{inst.name}</span>
                  </Link>
                </th>
                <td className="hidden px-3 py-2.5 text-mfi-700 sm:table-cell">
                  {humanize(inst.headOffice) ?? <span className="text-mfi-400">Not stated</span>}
                </td>
                <td className="hidden px-3 py-2.5 text-mfi-700 md:table-cell">
                  {humanize(inst.workingArea) ?? "Not stated"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-mfi-800">
                  {formatCrore(inst.paidUpCapitalCrore) ?? "—"}
                </td>
                <td className="hidden px-3 py-2.5 text-mfi-700 lg:table-cell">
                  {since ?? <span className="text-mfi-400">Not stated</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
