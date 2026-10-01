import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { institutions, getInstitutionBySlug } from "@/data/institutions";
import { crawlSources, crawlSummary } from "@/data/pilot";
import { nrbInstitutionLinks, nrbRegulatoryEvents } from "@/data/nrb";
import { institutionLeadership } from "../../../../lib/api/repository";
import type { PersonDto } from "../../../../lib/repository/types";
import Link from "next/link";

const STATUS_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  CONFLICT: {
    label: "Conflict",
    cls: "bg-amber-50 text-amber-700",
    title: "Sources disagree about this role. The person is listed; the attribution is not confirmed.",
  },
  UNVERIFIED: {
    label: "Unverified",
    cls: "bg-slate-100 text-slate-600",
    title: "Extracted from a source snapshot that has not been independently confirmed yet.",
  },
  AUTO_VERIFIED: { label: "Auto-verified", cls: "bg-blue-50 text-blue-700", title: "Matched automatically across sources." },
  HUMAN_VERIFIED: { label: "Verified", cls: "bg-green-50 text-nrb-700", title: "Confirmed by a human reviewer." },
};

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { label: status, cls: "bg-slate-100 text-slate-600", title: "" };
}

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
  const crawl = crawlSources.find((c) => c.institutionId === inst.id);
  const website = crawl?.website ?? inst.officialWebsite;
  const nrbLinksFor = nrbInstitutionLinks.filter((l) => l.institutionId === inst.id);
  const nrbClassLinks = nrbLinksFor.filter((l) => l.linkType === "CLASS" || l.linkType === "LICENSE");
  const nrbMatchedDocs = nrbLinksFor.filter((l) => l.nrbDocumentId);
  const nrbEvents = nrbRegulatoryEvents.filter((e) => e.institutionId === inst.id);

  // Published leadership comes from the validated People read model, not from the
  // legacy crawl summary. The crawl widget's peopleNames is 0 for every institution
  // and must never be shown as an "extracted" count for public leadership.
  const leadershipResponse = institutionLeadership(inst.slug, {});
  const leadership =
    leadershipResponse.status === 200 && "data" in leadershipResponse.body
      ? (leadershipResponse.body.data as PersonDto[])
      : [];
  const leadershipTotal =
    leadershipResponse.status === 200 && "pagination" in leadershipResponse.body
      ? leadershipResponse.body.pagination?.total ?? leadership.length
      : leadership.length;

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
                {website ? (
                  <a href={website} target="_blank" rel="noopener" className="text-mfi-600 hover:underline">{website}</a>
                ) : (
                  <span className="text-slate-400">Not available</span>
                )}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-sm text-slate-700">Leadership</h2>
          <span className="text-[10px] text-slate-400">
            {leadershipTotal} {leadershipTotal === 1 ? "person" : "people"} extracted from source evidence
          </span>
        </div>

        {leadership.length === 0 ? (
          <p className="text-xs text-slate-400">
            No leadership has been extracted for this institution yet. We publish nothing until a source shows it.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {leadership.map((p) => {
              const badge = statusBadge(p.meta.verification_status);
              return (
                <li key={p.id} className="py-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm text-slate-800 font-medium">{p.name}</span>
                  <span className="text-xs text-slate-500">{p.positions.map((x) => x.title).join(", ")}</span>
                  <span
                    title={badge.title}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[10px] text-slate-400 mt-3">
          Roles are extracted from source evidence, not confirmed by a second source. Anything with a conflict is flagged.
        </p>
      </div>

      {crawl && (
                  <span className="inline-flex items-center gap-1 ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">crawl-verified</span>
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

      {nrbClassLinks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-slate-700">NRB Registry</h2>
            <Link href="/nrb" className="text-[10px] text-mfi-600 hover:underline">NRB Center →</Link>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {nrbClassLinks.map((l) => (
              <span key={l.id} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-nrb-50 text-nrb-700">
                NRB {l.linkType} {l.linkType === "CLASS" ? inst.licenseClass : ""} · verified {l.linkDate ?? "—"}
              </span>
            ))}
          </div>

          {nrbMatchedDocs.length > 0 ? (
            <div className="space-y-1">
              {nrbMatchedDocs.map((l) => (
                <div key={l.id} className="text-xs text-slate-600">{l.nrbDocumentId}</div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No institution-specific NRB documents — NRB publishes aggregate regulator documents for this slice (no per-institution values).</p>
          )}

          {nrbEvents.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Regulatory events</div>
              <div className="space-y-1">
                {nrbEvents.map((evt) => (
                  <div key={evt.id} className="flex items-center justify-between gap-3 py-1 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${evt.eventType === "MERGED" ? "bg-blue-50 text-blue-700" : evt.eventType === "ACQUIRED" ? "bg-purple-50 text-purple-700" : "bg-amber-50 text-amber-700"}`}>{evt.eventType}</span>
                      <span className="text-xs text-slate-600">{evt.title}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{evt.occurredAt ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {crawl && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-slate-700">Crawl Evidence</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${crawl.status === "HEALTHY" ? "bg-green-50 text-nrb-700" : "bg-amber-50 text-amber-700"}`}>
              {crawl.status} · {crawl.lastStatus}
            </span>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.runs}</div>
              <div className="text-[10px] text-slate-500">Runs</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.snapshots}</div>
              <div className="text-[10px] text-slate-500">Snapshots</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.items}</div>
              <div className="text-[10px] text-slate-500">Items</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.discoveredUrls}</div>
              <div className="text-[10px] text-slate-500">Discovered</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.documents}</div>
              <div className="text-[10px] text-slate-500">Documents</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <div className="text-sm font-bold text-slate-800">{crawl.errors}</div>
              <div className="text-[10px] text-slate-500">Errors</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Leadership <span className="normal-case text-slate-400">({leadershipTotal} published)</span></div>
              <ul className="space-y-1">
                {leadership.slice(0, 6).map((p) => (
                  <li key={p.id} className="text-xs text-slate-600">{p.name}</li>
                ))}
                {leadershipTotal > leadership.slice(0, 6).length && (
                  <li className="text-xs text-slate-400">+{leadershipTotal - leadership.slice(0, 6).length} more below</li>
                )}
                {leadershipTotal === 0 && <li className="text-xs text-slate-400">None published</li>}
              </ul>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Branches <span className="normal-case text-slate-400">({crawl.branchCount} extracted)</span></div>
              <ul className="space-y-1">
                {crawl.branchNames.map((b) => (
                  <li key={b} className="text-xs text-slate-600">{b}</li>
                ))}
                {crawl.branchNames.length === 0 && <li className="text-xs text-slate-400">None extracted</li>}
              </ul>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Vacancies <span className="normal-case text-slate-400">({crawl.vacancyCount} extracted)</span></div>
              <ul className="space-y-1">
                {crawl.vacancyTitles.map((v) => (
                  <li key={v} className="text-xs text-slate-600">{v}</li>
                ))}
                {crawl.vacancyTitles.length === 0 && <li className="text-xs text-slate-400">None extracted</li>}
              </ul>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Financial documents <span className="normal-case text-slate-400">({crawl.documentCount} extracted)</span></div>
              <ul className="space-y-1">
                {crawl.documentTitles.map((d) => (
                  <li key={d} className="text-xs text-slate-600 truncate">{d}</li>
                ))}
                {crawl.documentTitles.length === 0 && <li className="text-xs text-slate-400">None extracted</li>}
              </ul>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-slate-400">
            Deterministic ingestion snapshot (mode: {crawlSummary.mode}), evidence extracted without AI/OCR, all assertions UNVERIFIED.
            <Link href="/ingestion" className="text-mfi-600 hover:underline ml-1">Ingestion Control Room →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
