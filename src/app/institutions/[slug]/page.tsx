import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { institutions, getInstitutionBySlug } from "@/data/institutions";
import Link from "next/link";

export async function generateStaticParams() {
  return institutions.map((inst) => ({ slug: inst.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const inst = getInstitutionBySlug(slug);
  if (!inst) return {};
  return { title: `${inst.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()} — Laghubitta Khabar`, description: `${inst.name} profile with paid-up capital, head office, working area and NRB-verified data.` };
}

export default async function InstitutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inst = getInstitutionBySlug(slug);
  if (!inst) notFound();

  const evidenceEntries = Object.entries(inst.evidence);

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="mb-4">
        <Link href="/institutions" className="text-xs text-mfi-600 hover:underline">&larr; Back to Directory</Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{inst.name}</h1>
            <p className="text-sm text-slate-500 mt-1">{inst.headOffice}</p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${inst.coverageType === "national" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
            {inst.coverageType.charAt(0).toUpperCase() + inst.coverageType.slice(1)} Level
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">License Class</div>
            <div className="text-lg font-bold text-slate-800">{inst.licenseClass}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Status</div>
            <div className="text-lg font-bold text-nrb-600">{inst.licenseStatus.charAt(0).toUpperCase() + inst.licenseStatus.slice(1)}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Operation Date</div>
            <div className="text-lg font-bold text-slate-800">{inst.operationDate}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Paid-Up Capital</div>
            <div className="text-lg font-bold text-slate-800">Rs {inst.paidUpCapitalCrore} Cr</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-bold text-sm text-slate-700 mb-3">Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <dt className="text-slate-500">Working Area</dt>
              <dd className="font-medium text-slate-700 text-right">{inst.workingArea}</dd>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <dt className="text-slate-500">Head Office</dt>
              <dd className="font-medium text-slate-700 text-right">{inst.headOffice}</dd>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <dt className="text-slate-500">Website</dt>
              <dd className="font-medium text-slate-700 text-right">
                {inst.officialWebsite ? (
                  <a href={inst.officialWebsite} target="_blank" rel="noopener" className="text-mfi-600 hover:underline">{inst.officialWebsite}</a>
                ) : (
                  <span className="text-slate-400">Not available</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <dt className="text-slate-500">Merged Entity</dt>
              <dd className="font-medium text-slate-700 text-right">{inst.operationDateIsJointAfterMerger ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-slate-500">Aliases</dt>
              <dd className="font-medium text-slate-700 text-right text-xs">{inst.aliases.join(", ")}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-bold text-sm text-slate-700 mb-3">Evidence Grades</h2>
          <div className="space-y-2">
            {evidenceEntries.map(([field, evidence]) => (
              <div key={field} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
                <span className="text-xs text-slate-500 capitalize">{field.replace(/([A-Z])/g, " $1").trim()}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${evidence.grade === "A" ? "bg-green-50 text-nrb-700" : "bg-amber-50 text-amber-700"}`}>
                    {evidence.grade}
                  </span>
                  {evidence.sourceId && <span className="text-[10px] text-slate-400">{evidence.sourceId}</span>}
                </div>
              </div>
            ))}
          </div>
          {inst.operationDateStatus === "source_anomaly" && (
            <div className="mt-3 p-2 bg-amber-50 rounded-lg text-xs text-amber-800">
              Note: NRB displays 1900-01-09, awaiting clarification.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
