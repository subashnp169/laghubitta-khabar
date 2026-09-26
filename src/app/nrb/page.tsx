import type { Metadata } from "next";
import Link from "next/link";
import { nrbSummary, nrbDocuments, nrbRegulatoryEvents } from "@/data/nrb";

export const metadata: Metadata = {
  title: "NRB Center — Laghubitta Khabar",
  description: "Deterministic, evidence-backed NRB documents and regulatory timeline for Nepalese microfinance institutions.",
};

const docTypeLabels: Record<string, string> = {
  REPORT: "Report",
  KFI: "Key Financial Indicators",
  ENFORCEMENT: "Enforcement",
};

const docTypeClasses: Record<string, string> = {
  REPORT: "bg-blue-50 text-blue-700",
  KFI: "bg-purple-50 text-purple-700",
  ENFORCEMENT: "bg-red-50 text-red-700",
};

const eventTypeLabels: Record<string, string> = {
  MERGED: "Merger",
  ACQUIRED: "Acquisition",
  RENAMED: "Renamed",
};

const eventTypeClasses: Record<string, string> = {
  MERGED: "bg-blue-50 text-blue-700",
  ACQUIRED: "bg-purple-50 text-purple-700",
  RENAMED: "bg-amber-50 text-amber-700",
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className={`text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</div>
    </div>
  );
}

export default function NrbPage() {
  const docTypeOrder = Object.entries(nrbSummary.documentsByType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
  const eventTypeOrder = Object.entries(nrbSummary.eventsByType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span className="inline-block w-2 h-2 rounded-full bg-nrb-500" />
          <span>Evidence-backed NRB snapshot · generated {nrbSummary.generatedAt.slice(0, 19).replace("T", " ")}Z · universe observed {nrbSummary.observedAt}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">NRB Center</h1>
        <p className="text-sm text-slate-500 mt-1">Nepal Rastra Bank documents and regulatory events, captured by the deterministic ingestion pipeline. No AI, no OCR; all assertions UNVERIFIED.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Documents" value={nrbSummary.documents} tone="text-nrb-700" />
        <Stat label="Regulatory events" value={nrbSummary.regulatoryEvents} />
        <Stat label="Institutions under NRB" value={nrbSummary.institutions} />
        <Stat label="NRB sources" value={nrbSummary.sources.length} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-8">
        {docTypeOrder.map((t) => (
          <a key={t} href={`#doc-${t.toLowerCase()}`} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${docTypeClasses[t] ?? "bg-slate-100 text-slate-600"}`}>
            {docTypeLabels[t] ?? t} · {nrbSummary.documentsByType[t]}
          </a>
        ))}
        {eventTypeOrder.map((t) => (
          <a key={t} href={`#evt-${t.toLowerCase()}`} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${eventTypeClasses[t] ?? "bg-slate-100 text-slate-600"}`}>
            {eventTypeLabels[t] ?? t} · {nrbSummary.eventsByType[t]}
          </a>
        ))}
      </div>

      {docTypeOrder.map((type) => {
        const docs = nrbDocuments.filter((d) => d.docType === type);
        return (
          <section key={type} id={`doc-${type.toLowerCase()}`} className="mb-10">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${docTypeClasses[type] ?? "bg-slate-100 text-slate-600"}`}>{docTypeLabels[type] ?? type}</span>
              <h2 className="font-bold text-sm text-slate-700">{type}</h2>
              <span className="text-xs text-slate-400">· {docs.length} documents</span>
            </div>
            <div className="space-y-2">
              {docs.map((doc) => (
                <div key={doc.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-nrb-200 transition">
                  <div className="flex items-start justify-between gap-3">
                    <a href={doc.officialUrl} target="_blank" rel="noopener" className="font-semibold text-sm text-slate-800 hover:text-mfi-600">{doc.title}</a>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{doc.publishedAt ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400">{doc.sourceTitle}</span>
                    {doc.size && <span className="text-[10px] text-slate-400">· {doc.size}</span>}
                    {doc.topic && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{doc.topic}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section id="timeline" className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-bold text-sm text-slate-700">Regulatory Timeline</h2>
          <span className="text-xs text-slate-400">· {nrbSummary.regulatoryEvents} events from the NRB universe</span>
        </div>

        {eventTypeOrder.map((type) => {
          const events = nrbRegulatoryEvents.filter((e) => e.eventType === type);
          return (
            <div key={type} id={`evt-${type.toLowerCase()}`} className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${eventTypeClasses[type] ?? "bg-slate-100 text-slate-600"}`}>{eventTypeLabels[type] ?? type}</span>
                <span className="text-xs text-slate-400">{events.length} events</span>
              </div>
              <div className="space-y-2">
                {events.map((evt) => (
                  <div key={evt.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/institutions/${evt.institutionSlug}`} className="font-semibold text-sm text-slate-800 hover:text-mfi-600">{evt.institutionName}</Link>
                        <p className="text-xs text-slate-500 mt-1">{evt.description}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{evt.occurredAt ?? "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <p className="text-[10px] text-slate-400 mt-3">
        Snapshot: src/data/nrb.ts (regenerated via <code className="bg-slate-100 px-1 rounded">npm run nrb:data</code> from the NRB ledger). Event dates fall back to the universe observation date ({nrbSummary.observedAt}) where NRB does not publish an explicit event date. Aggregate regulator documents only — no PDF parsing, no per-institution values in this slice.
      </p>
    </div>
  );
}