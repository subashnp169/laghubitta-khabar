"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { selectCompare, type CompareModel } from "../../../lib/compare";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Side-by-side comparison.
 *
 * Selection is client state, so it is not linkable and does not survive a reload.
 * That is a deliberate trade: the alternative is a URL query, which a static
 * export cannot read at build time. The URL is still written on mount when
 * `?ids=` is present, so an externally shared link does work — it just cannot be
 * produced by this page.
 *
 * "Highest" markers only ever mean "highest among the institutions you selected".
 * With one institution selected there is no comparison to draw, and the header
 * says so rather than crowning a sole entry.
 */

const DEFAULT_COUNT = 5;

function shortName(name: string): string {
  return name.replace(/ Laghubitta Bittiya Sanstha( Ltd\.?)?$/i, "").trim() || name;
}

function defaultSelection(model: CompareModel): string[] {
  const sorted = [...model.institutions].sort((a, b) => {
    const av = typeof a.series.paidUpCapitalCrore === "number" ? a.series.paidUpCapitalCrore : -1;
    const bv = typeof b.series.paidUpCapitalCrore === "number" ? b.series.paidUpCapitalCrore : -1;
    return bv - av;
  });
  return sorted.slice(0, DEFAULT_COUNT).map((i) => i.id);
}

export default function CompareView({ model }: { model: CompareModel }) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Read on the client only, so this does not require a server-rendered query.
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).getAll("ids");
      if (fromUrl.length > 0) return new Set(fromUrl);
    }
    return new Set(defaultSelection(model));
  });

  const view = useMemo(() => selectCompare(model, [...selected]), [model, selected]);
  const comparability = view.institutions.length > 1;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => setSelected(new Set(defaultSelection(model)));

  return (
    <div>
      <div className="lk-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="lk-eyebrow">
            {view.institutions.length} of {model.institutions.length} selected
          </span>
          <button type="button" onClick={reset} className="lk-button-secondary h-9 min-h-9 px-3 text-xs">
            Reset to the {DEFAULT_COUNT} largest by capital
          </button>
        </div>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {model.institutions.map((inst) => {
            const on = selected.has(inst.id);
            return (
              <label
                key={inst.id}
                className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  on ? "bg-mfi-50 font-medium text-mfi-900" : "text-mfi-600 hover:bg-mfi-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(inst.id)}
                  className="size-4 shrink-0 accent-mfi-700"
                />
                <span className="truncate">{shortName(inst.name)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {view.institutions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing selected"
            detail="Tick at least one institution above to compare. Empty rows are not filled in with estimates — a cell with no data stays empty."
          />
        </div>
      ) : (
        <div className="lk-card mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">
                {view.institutions.length} institutions compared across {view.metrics.length} recorded fields
              </caption>
              <thead>
                <tr className="border-b border-mfi-200 bg-mfi-50 text-left">
                  <th scope="col" className="sticky left-0 z-10 min-w-[180px] bg-mfi-50 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-mfi-500">
                    Recorded field
                  </th>
                  {view.institutions.map((inst) => (
                    <th key={inst.id} scope="col" className="min-w-[170px] px-3 py-2.5 align-top">
                      <span className="block font-semibold leading-tight text-mfi-900">
                        {shortName(inst.name)}
                      </span>
                      <Link
                        href={`/institutions/${inst.slug}`}
                        className="mt-0.5 block text-[11px] font-normal text-mfi-600 underline underline-offset-2"
                      >
                        profile
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.metrics.map((metric) => (
                  <tr key={metric.key} className="border-b border-mfi-100 last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white px-3 py-2.5 text-xs font-medium text-mfi-600"
                    >
                      {metric.label}
                    </th>
                    {view.institutions.map((inst) => {
                      const value = inst.series[metric.key];
                      const leader = comparability && view.leaders[metric.key] === inst.id;
                      const missing = value === null || value === undefined || value === "";
                      return (
                        <td
                          key={inst.id}
                          className={`px-3 py-2.5 align-top text-xs ${
                            missing
                              ? "text-mfi-300"
                              : leader
                                ? "bg-mfi-50 font-semibold text-mfi-900"
                                : "text-mfi-700"
                          }`}
                        >
                          {missing ? (
                            <span title="Not recorded in any source">not recorded</span>
                          ) : (
                            <>
                              {String(value)}
                              {leader && metric.kind === "number" ? (
                                <span
                                  title={`Highest ${metric.label.toLowerCase()} among the ${view.institutions.length} institutions you selected`}
                                  className="ml-1.5 rounded bg-mfi-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-mfi-700"
                                >
                                  highest
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!comparability && view.institutions.length > 0 ? (
        <p className="mt-4 text-xs text-mfi-500">
          One institution selected — there is nothing to compare against. Add a second to see which is
          highest on each numeric field.
        </p>
      ) : null}
    </div>
  );
}
