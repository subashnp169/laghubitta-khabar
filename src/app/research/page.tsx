import type { Metadata } from "next";
import { researchItems } from "@/data/research";

export const metadata: Metadata = {
  title: "Research — Laghubitta Khabar",
  description: "Research papers, analysis, and reports on Nepal's microfinance industry.",
};

export default function ResearchPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Research Portal</h1>
      <div className="space-y-4">
        {researchItems.map((item) => (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-mfi-200 hover:shadow-sm transition">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mfi-600 bg-mfi-50 px-2 py-0.5 rounded">{item.category}</span>
              <span className="text-xs text-slate-400">{item.date}</span>
            </div>
            <h2 className="font-semibold text-sm text-slate-800 mb-1">{item.title}</h2>
            <p className="text-xs text-slate-500 mb-2">{item.summary}</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">By {item.author}</span>
              <a href={item.url} className="text-xs font-medium text-mfi-600 hover:underline">Read full paper →</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
