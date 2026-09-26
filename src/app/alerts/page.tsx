import type { Metadata } from "next";
import Link from "next/link";
import { buildAlerts, countBySeverity } from "../../../lib/alerts";
import { nrbRegulatoryEvents } from "@/data/nrb";
import { crawlSources } from "@/data/pilot";
import { institutions } from "@/data/institutions";

export const metadata: Metadata = {
  title: "Alerts — Laghubitta Khabar",
  description: "Deterministic regulatory and coverage alerts from NRB events and ingestion evidence.",
};

const severityClasses: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-red-100",
  medium: "bg-amber-50 text-amber-700 ring-amber-100",
  low: "bg-slate-100 text-slate-600 ring-slate-200",
};

export default function AlertsPage() {
  const alerts = buildAlerts(nrbRegulatoryEvents, crawlSources);
  const counts = countBySeverity(alerts);
  const nameByInst = new Map(institutions.map((i) => [i.id, i.name]));
  const coverage = alerts.filter((a) => a.kind === "COVERAGE");
  const events = alerts.filter((a) => a.kind === "REGULATORY_EVENT");

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-nrb-500" />
          <span>Phase 2 · Alerts · deterministic, opinion-free · source-linked</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Alerts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Regulatory events (NRB ledger) and coverage state (ingestion control room). Facts with evidence anchors —{" "}
          no AI summaries, no recommendations.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">By severity:</span>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-50 text-red-700">{counts.high} high</span>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700">{counts.medium} medium</span>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">{counts.low} low</span>
        <span className="text-xs text-slate-400 ml-auto">
          {events.length} regulatory · {coverage.length} coverage
        </span>
      </div>

      {alerts.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500">No alerts. Everything is healthy and no regulatory events are recorded.</div>
      )}

      {coverage.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Coverage</h2>
          <div className="space-y-2">
            {coverage.map((a) => {
              const name = a.institutionId ? (nameByInst.get(a.institutionId) ?? a.institutionId) : a.institutionId ?? "";
              return (
                <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5 ring-1 ${severityClasses[a.severity]}`}>
                    {a.severity.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{a.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{a.detail}</div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      <span className="text-mfi-600 font-medium">{name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</span>
                      {a.institutionSlug && (
                        <>
                          {" · "}
                          <Link href={`/institutions/${a.institutionSlug}`} className="hover:underline">view profile →</Link>
                        </>
                      )}
                      {a.occurredAt && <> · observed {a.occurredAt.slice(0, 10)}</>}
                      {" · "}
                      <span>{a.source}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Regulatory events</h2>
          <div className="space-y-2">
            {events.map((a) => (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5 ring-1 ${severityClasses[a.severity]}`}>
                  {a.severity.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{a.title}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{a.detail}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    <span className="text-mfi-600 font-medium">{a.institutionName}</span>
                    {a.institutionSlug && (
                      <>
                        {" · "}
                        <Link href={`/institutions/${a.institutionSlug}`} className="hover:underline">view profile →</Link>
                      </>
                    )}
                    {a.occurredAt && <> · observed {a.occurredAt.slice(0, 10)}</>}
                    {" · "}
                    <Link href="/nrb" className="hover:underline">NRB Center →</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[10px] text-slate-400 mt-6">
        Derived from src/data/nrb.ts and src/data/pilot.ts via lib/alerts.ts. Subscription/delivery wiring is a later
        slice; this feed is the deterministic alert surface only.
      </p>
    </div>
  );
}