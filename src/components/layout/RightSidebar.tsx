import Link from "next/link";
import { institutions } from "@/data/institutions";
import { posts } from "@/data/posts";

export default function RightSidebar() {
  const topInstitutions = [...institutions].sort((a, b) => b.paidUpCapitalCrore - a.paidUpCapitalCrore).slice(0, 5);
  const latestPosts = posts.slice(0, 3);

  return (
    <aside className="lg:col-span-3 hidden lg:block">
      <div className="sticky top-20 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wider mb-3">Market Radar</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Total MFIs</span>
              <span className="font-semibold">{institutions.length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">National Level</span>
              <span className="font-semibold">{institutions.filter(i => i.coverageType === "national").length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Province Level</span>
              <span className="font-semibold">{institutions.filter(i => i.coverageType === "province").length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Merged Entities</span>
              <span className="font-semibold">{institutions.filter(i => i.operationDateIsJointAfterMerger).length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Total Capital</span>
              <span className="font-semibold">Rs {institutions.reduce((s, i) => s + i.paidUpCapitalCrore, 0).toFixed(0)} Cr</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wider mb-3">Top MFIs by Capital</h3>
          <div className="space-y-2">
            {topInstitutions.map((inst) => (
              <Link key={inst.id} href={`/institutions/${inst.slug}`} className="block text-xs hover:bg-slate-50 -mx-2 px-2 py-1.5 rounded transition">
                <div className="font-medium text-slate-700 truncate">{inst.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</div>
                <div className="text-slate-400">Rs {inst.paidUpCapitalCrore} Cr</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wider mb-3">Latest News</h3>
          <div className="space-y-2">
            {latestPosts.map((p) => (
              <Link key={p.id} href={`/news/${p.slug}`} className="block text-xs hover:bg-slate-50 -mx-2 px-2 py-1.5 rounded transition">
                <div className="font-medium text-slate-700">{p.title}</div>
                <div className="text-slate-400 mt-0.5">{p.publishedAt}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
