import type { Metadata } from "next";
import Link from "next/link";
import { crawlSources, crawlSummary } from "@/data/pilot";
import { institutions } from "@/data/institutions";

export const metadata: Metadata = {
  title: "Ingestion Control Room — Laghubitta Khabar",
  description: "Live evidence from the deterministic ingestion pipeline across all crawled institution websites.",
};

const statusClasses: Record<string, string> = {
  HEALTHY: "bg-green-50 text-nrb-700",
  DEGRADED: "bg-amber-50 text-amber-700",
  UNHEALTHY: "bg-red-50 text-red-700",
  "NEVER-RUN": "bg-slate-100 text-slate-500",
};

const lastStatusClasses: Record<string, string> = {
  SUCCESS: "bg-green-50 text-nrb-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  FAILED: "bg-red-50 text-red-700",
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className={`text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</div>
    </div>
  );
}

export default function IngestionPage() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-nrb-500" />
          <span>Deterministic ingestion snapshot · {crawlSummary.mode} · generated {crawlSummary.generatedAt.slice(0, 19).replace("T", " ")}Z</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Ingestion Control Room</h1>
        <p className="text-sm text-slate-500 mt-1">Evidence captured from {crawlSummary.sources} institution websites. No AI, no OCR, no browser automation; all assertions UNVERIFIED.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <Stat label="Sources" value={crawlSummary.sources} />
        <Stat label="Institutions Covered" value={`${crawlSummary.withEvidence}/${crawlSummary.institutions}`} tone="text-mfi-600" />
        <Stat label="Runs" value={crawlSummary.runs} />
        <Stat label="Snapshots" value={crawlSummary.snapshots} />
        <Stat label="Items" value={crawlSummary.items} />
        <Stat label="Documents" value={crawlSummary.documents} />
        <Stat label="Errors" value={crawlSummary.errors} tone={crawlSummary.errors > 0 ? "text-amber-700" : "text-nrb-700"} />
        <Stat label="Duplicate hash groups" value={crawlSummary.duplicateSnapshotGroups} tone={crawlSummary.duplicateSnapshotGroups === 0 ? "text-nrb-700" : "text-red-700"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Validation PASS" value={crawlSummary.passCount} tone="text-nrb-700" />
        <Stat label="Validation FAIL" value={crawlSummary.failCount} tone={crawlSummary.failCount > 0 ? "text-red-700" : "text-slate-800"} />
        <Stat label="Validation PENDING" value={crawlSummary.pendingCount} />
        <Stat label="Conflicts (open)" value={crawlSummary.conflictsOpen} tone={crawlSummary.conflictsOpen === 0 ? "text-nrb-700" : "text-red-700"} />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Source health:</span>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-50 text-nrb-700">{crawlSummary.healthy} HEALTHY</span>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700">{crawlSummary.degraded} DEGRADED</span>
        <span className="text-xs text-slate-400 ml-auto">{crawlSummary.pdfSnapshots} PDF snapshot (evidence only, no OCR)</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <th className="px-3 py-2">Institution</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">Capabilities</th>
              <th className="px-3 py-2 text-right">Runs</th>
              <th className="px-3 py-2 text-right">Snapshots</th>
              <th className="px-3 py-2 text-right">Items</th>
              <th className="px-3 py-2 text-right">Docs</th>
              <th className="px-3 py-2 text-right">Branches</th>
              <th className="px-3 py-2 text-right">Vacancies</th>
              <th className="px-3 py-2 text-right">Fin. Docs</th>
              <th className="px-3 py-2 text-right">Errors</th>
              <th className="px-3 py-2">Last Run</th>
              <th className="px-3 py-2">Health</th>
            </tr>
          </thead>
          <tbody>
            {crawlSources.map((c) => {
              const inst = institutions.find((i) => i.id === c.institutionId);
              return (
                <tr key={c.sourceId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-700">{inst?.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim() ?? c.institutionId}</div>
                    {inst && (
                      <Link href={`/institutions/${inst.slug}`} className="text-[10px] text-mfi-600 hover:underline">View profile →</Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <a href={c.website} target="_blank" rel="noopener" className="text-xs text-mfi-600 hover:underline block max-w-[180px] truncate">{c.website}</a>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {c.capabilities.map((cap) => {
                        const loc = c.capabilityPages?.find((l) => l.capability === cap);
                        if (loc?.knownUrl) {
                          return (
                            <a
                              key={cap}
                              href={loc.knownUrl}
                              target="_blank"
                              rel="noopener"
                              title={`${loc.knownUrl}\n${loc.note ?? ""}`}
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-mfi-50 text-mfi-700 hover:bg-mfi-100 hover:underline"
                            >
                              {cap}
                            </a>
                          );
                        }
                        return (
                          <span key={cap} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{cap}</span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.runs}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.snapshots}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.items}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.documents}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.branchCount}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.vacancyCount}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.documentCount}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{c.errors}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{c.lastRun ? c.lastRun.slice(0, 16).replace("T", " ") : "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit ${statusClasses[c.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {c.status}
                      </span>
                      {c.lastStatus && (
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full w-fit ${lastStatusClasses[c.lastStatus] ?? "bg-slate-100 text-slate-500"}`}>
                          {c.lastStatus}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400 mt-3">
        Snapshot file: src/data/pilot.ts (regenerated via <code className="bg-slate-100 px-1 rounded">npm run pilot:export -- &lt;db-path&gt;</code>). Extracted metadata is evidence-only and UNVERIFIED until human review.
      </p>
    </div>
  );
}