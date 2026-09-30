import type { Metadata } from "next";
import { jobs, jobsProvenance } from "@/data/jobs";

export const metadata: Metadata = {
  title: "MFI Jobs — Laghubitta Khabar",
  description:
    "Job openings at Nepal's microfinance institutions, listed only where the institution's own site has been read and the posting parsed.",
};

export default function JobsPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">MFI Jobs</h1>
      <p className="text-sm text-slate-500 mb-6">
        Vacancies at Nepal&apos;s microfinance institutions
      </p>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-2">No vacancies published yet</h2>
          <p className="text-sm text-slate-600 mb-3">
            This page lists a vacancy only after the institution&apos;s own website has
            been fetched and the posting has been parsed out of it. Right now no
            institution&apos;s site has yielded a posting that could be read without
            guessing, so this list is empty.
          </p>
          <p className="text-sm text-slate-600 mb-3">
            That is a deliberate result, not a gap in the data. Several institutions
            publish vacancies only through an external job portal, or build the list
            in the browser after the page loads. Neither can be read as evidence
            without either scraping a third party or running the page, so neither is
            used.
          </p>
          <p className="text-xs text-slate-400">{jobsProvenance}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:border-mfi-200 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800">{job.title}</h2>
                  <p className="text-sm text-slate-500">
                    {job.institution} — {job.location}
                  </p>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">
                  {job.type}
                </span>
              </div>
              {job.description ? (
                <p className="text-xs text-slate-500 mt-2">{job.description}</p>
              ) : null}
              <div className="flex items-center justify-between mt-3 text-xs">
                <span className="text-slate-400">
                  {/* A deadline is shown only when it was read as a date. A notice
                      that merely mentions one says so in the description above,
                      rather than the page guessing at a year. */}
                  {job.deadline ? `Deadline: ${job.deadline}` : "No deadline observed"}
                </span>
                <span className="text-mfi-600 font-medium">
                  {job.sourceName ? `Source: ${job.sourceName}` : "Source recorded"}
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-400 pt-2">{jobsProvenance}</p>
        </div>
      )}
    </div>
  );
}
