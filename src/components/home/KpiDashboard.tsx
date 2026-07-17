import { institutions } from "@/data/institutions";

export default function KpiDashboard() {
  const totalCapital = institutions.reduce((s, i) => s + i.paidUpCapitalCrore, 0);
  const nationalCount = institutions.filter(i => i.coverageType === "national").length;
  const mergedCount = institutions.filter(i => i.operationDateIsJointAfterMerger).length;
  const withWebsite = institutions.filter(i => i.officialWebsite).length;

  const kpis = [
    { label: "Licensed MFIs", value: institutions.length, change: "NRB verified" },
    { label: "Total Capital", value: `Rs ${totalCapital.toFixed(0)} Cr`, change: `Avg Rs ${(totalCapital / institutions.length).toFixed(1)} Cr` },
    { label: "National Level", value: nationalCount, change: `${institutions.length - nationalCount} province/district level` },
    { label: "Merged Entities", value: mergedCount, change: `${(mergedCount / institutions.length * 100).toFixed(0)}% of total` },
    { label: "Verified Websites", value: withWebsite, change: `${institutions.filter(i => i.websiteStatus === "verified").length} verified` },
    { label: "Source Grade A", value: "100%", change: "NRB BFI List Mid-May 2026" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-xs text-slate-500 font-medium mb-1">{kpi.label}</div>
          <div className="text-lg font-bold text-slate-800">{kpi.value}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{kpi.change}</div>
        </div>
      ))}
    </div>
  );
}
