import Link from "next/link";
import { Institution } from "@/types";

export default function InstitutionCard({ institution }: { institution: Institution }) {
  return (
    <Link href={`/institutions/${institution.slug}`} className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-mfi-200 hover:shadow-sm transition">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-sm text-slate-800 leading-tight">{institution.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</h3>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${institution.coverageType === "national" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
          {institution.coverageType === "national" ? "National" : institution.coverageType === "province" ? "Province" : "District"}
        </span>
      </div>
      <div className="space-y-1 text-xs text-slate-500">
        <div className="flex justify-between">
          <span>Head Office</span>
          <span className="font-medium text-slate-700">{institution.headOffice}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid-Up Capital</span>
          <span className="font-medium text-slate-700">Rs {institution.paidUpCapitalCrore} Cr</span>
        </div>
        <div className="flex justify-between">
          <span>Since</span>
          <span className="font-medium text-slate-700">{institution.operationDate.split("-")[0]}</span>
        </div>
        <div className="flex justify-between">
          <span>Working Area</span>
          <span className="font-medium text-slate-700 text-[10px]">{institution.workingArea}</span>
        </div>
      </div>
    </Link>
  );
}
