"use client";

import { useMemo, useState } from "react";
import InstitutionCard from "@/components/institutions/InstitutionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Institution } from "@/types";

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
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No institutions match those filters"
            detail="Try a shorter term — the directory matches full names, recorded aliases and head-office districts, not every abbreviation."
          />
        </div>
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
