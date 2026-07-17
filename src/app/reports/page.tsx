import type { Metadata } from "next";
import { industryReports } from "@/data/reports";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Reports — Laghubitta Khabar",
  description: "Industry reports, performance analysis, and metric dashboards for Nepal's microfinance sector.",
};

export default function ReportsPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Industry Reports</h1>
      <div className="space-y-6">
        {industryReports.map((report) => (
          <div key={report.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mfi-600 bg-mfi-50 px-2 py-0.5 rounded">{report.category}</span>
              <span className="text-xs text-slate-400">{report.period}</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-400">{report.publishedAt}</span>
            </div>
            <h2 className="font-bold text-lg text-slate-800 mb-2">{report.title}</h2>
            <p className="text-sm text-slate-500 mb-4">{report.summary}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {report.metrics.map((metric) => (
                <div key={metric.label} className="bg-slate-50 rounded-xl p-3">
                  <div className="text-[10px] text-slate-500 font-medium">{metric.label}</div>
                  <div className="text-lg font-bold text-slate-800">{metric.value}</div>
                  <div className={`text-[10px] font-medium ${metric.trend === "up" ? "text-nrb-600" : metric.trend === "down" ? "text-red-500" : "text-slate-400"}`}>
                    {metric.change}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
