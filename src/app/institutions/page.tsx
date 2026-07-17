import type { Metadata } from "next";
import { institutions } from "@/data/institutions";
import InstitutionCard from "@/components/institutions/InstitutionCard";

export const metadata: Metadata = {
  title: "MFI Directory — Laghubitta Khabar",
  description: "Complete directory of 51 Class D microfinance institutions licensed by Nepal Rastra Bank.",
};

export default function InstitutionsPage() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-nrb-500" />
          <span>Verified Source: NRB BFI List Mid-May 2026</span>
          <a href="https://www.nrb.org.np" target="_blank" rel="noopener" className="text-mfi-600 hover:underline">View source →</a>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">MFI Directory</h1>
        <p className="text-sm text-slate-500 mt-1">{institutions.length} licensed Class D institutions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {institutions.map((inst) => (
          <InstitutionCard key={inst.id} institution={inst} />
        ))}
      </div>
    </div>
  );
}
