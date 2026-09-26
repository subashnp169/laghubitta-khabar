"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { selectCompare, type CompareModel } from "../../../lib/compare";

const DEFAULT_COUNT = 5;

function defaultSelection(model: CompareModel): string[] {
  const sorted = [...model.institutions].sort(
    (a, b) =>
      (typeof b.series.paidUpCapitalCrore === "number" ? b.series.paidUpCapitalCrore : -1) -
      (typeof a.series.paidUpCapitalCrore === "number" ? a.series.paidUpCapitalCrore : -1),
  );
  return sorted.slice(0, DEFAULT_COUNT).map((i) => i.id);
}

export default function CompareView({ model }: { model: CompareModel }) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).getAll("ids") : [];
    if (fromUrl.length > 0) return new Set(fromUrl);
    return new Set(defaultSelection(model));
  });

  const view = useMemo(() => selectCompare(model, [...selected]), [model, selected]);

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
      <div className="mb-6 bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Institutions ({view.institutions.length} selected)
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
          >
            Reset to top {DEFAULT_COUNT} by capital
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-1 max-h-52 overflow-y-auto pr-2">
          {model.institutions.map((inst) => (
            <label
              key={inst.id}
              className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${selected.has(inst.id) ? "bg-nrb-50 text-nrb-800" : "bg-slate-50 text-slate-600"}`}
            >
              <input
                type="checkbox"
                checked={selected.has(inst.id)}
                onChange={() => toggle(inst.id)}
                className="accent-nrb-600"
              />
              <span className="truncate">{inst.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <th className="px-3 py-2 min-w-[180px]">Metric</th>
              {view.institutions.map((inst) => (
                <th key={inst.id} className="px-3 py-2 min-w-[160px]">
                  <div className="font-semibold text-slate-700">{inst.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</div>
                  <Link href={`/institutions/${inst.slug}`} className="text-[10px] text-mfi-600 hover:underline font-normal">
                    View profile →
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.metrics.map((metric) => (
              <tr key={metric.key} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 text-xs text-slate-600 font-medium">{metric.label}</td>
                {view.institutions.map((inst) => {
                  const value = inst.series[metric.key];
                  const leader = view.leaders[metric.key] === inst.id;
                  const missing = value === null || value === undefined;
                  return (
                    <td
                      key={inst.id}
                      className={`px-3 py-2 text-xs ${leader ? "bg-amber-50 text-amber-800 font-semibold" : missing ? "text-slate-300" : "text-slate-700"}`}
                    >
                      {missing ? "—" : String(value)}
                      {leader && metric.kind === "number" && <span className="ml-1 text-[9px] font-bold text-amber-600">TOP</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}