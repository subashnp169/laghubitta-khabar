import type { Metadata } from "next";
import { buildCompareModel } from "../../../lib/compare";
import { institutions } from "@/data/institutions";
import { crawlSources } from "@/data/pilot";
import { nrbDocuments, nrbInstitutionLinks, nrbRegulatoryEvents } from "@/data/nrb";
import CompareView from "@/components/compare/CompareView";

export const metadata: Metadata = {
  title: "Compare MFBs — Laghubitta Khabar",
  description: "Side-by-side comparison of Nepal's Class D microfinance institutions from deterministic sourced evidence.",
};

export default function ComparePage() {
  const model = buildCompareModel(institutions, crawlSources, {
    documents: nrbDocuments,
    links: nrbInstitutionLinks,
    events: nrbRegulatoryEvents,
  });
  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-nrb-500" />
          <span>Phase 2 · Compare · deterministic sourced evidence · UNVERIFIED until review</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Compare Microfinance Institutions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Side-by-side from {model.institutions.length} institutions — identity, capital, geography, web evidence, and NRB
          regulatory footprint. Missing data renders as —.
        </p>
      </div>
      <CompareView model={model} />
      <p className="text-[10px] text-slate-400 mt-3">
        Derived from the generated modules (src/data/institutions.ts, pilot.ts, nrb.ts) via lib/compare.ts — no schema
        change, no AI, no invented values. Highlighted cells mark the leader among the selected institutions for numeric metrics.
      </p>
    </div>
  );
}