import type { Metadata } from "next";
import { jobs } from "@/data/jobs";

export const metadata: Metadata = {
  title: "MFI Jobs — Laghubitta Khabar",
  description: "Latest job openings in Nepal's microfinance institutions. Browse career opportunities at 51 MFIs.",
};

export default function JobsPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">MFI Jobs</h1>
      <p className="text-sm text-slate-500 mb-6">Latest career opportunities in Nepal&apos;s microfinance sector</p>
      <div className="space-y-3">
        {jobs.map((job) => (
          <div key={job.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-mfi-200 hover:shadow-sm transition">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-slate-800">{job.title}</h2>
                <p className="text-sm text-slate-500">{job.institution} — {job.location}</p>
              </div>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">{job.type}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">{job.description}</p>
            <div className="flex items-center justify-between mt-3 text-xs">
              <span className="text-slate-400">Deadline: {job.deadline}</span>
              <span className="text-mfi-600 font-medium">Apply →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
