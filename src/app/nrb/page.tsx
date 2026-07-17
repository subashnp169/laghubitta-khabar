import type { Metadata } from "next";
import { nrbCirculars } from "@/data/nrb";

export const metadata: Metadata = {
  title: "NRB Center — Laghubitta Khabar",
  description: "Nepal Rastra Bank circulars, directives, and regulatory updates for microfinance institutions.",
};

export default function NrbPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">NRB Center</h1>
          <p className="text-sm text-slate-500">Regulatory updates from Nepal Rastra Bank</p>
        </div>
      </div>
      <div className="space-y-3">
        {nrbCirculars.map((circular) => (
          <div key={circular.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-nrb-200 transition">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-nrb-700 bg-nrb-50 px-2 py-0.5 rounded">{circular.category}</span>
              <span className="text-xs text-slate-400">{circular.date}</span>
            </div>
            <h2 className="font-semibold text-sm text-slate-800 mb-1">{circular.title}</h2>
            <p className="text-xs text-slate-500">{circular.summary}</p>
            <a href={circular.url} target="_blank" rel="noopener" className="inline-block mt-2 text-xs font-medium text-mfi-600 hover:underline">Read full circular →</a>
          </div>
        ))}
      </div>
    </div>
  );
}
