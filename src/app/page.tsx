import LeftSidebar from "@/components/layout/LeftSidebar";
import RightSidebar from "@/components/layout/RightSidebar";
import KpiDashboard from "@/components/home/KpiDashboard";
import NewsFeed from "@/components/home/NewsFeed";
import Link from "next/link";
import { institutions } from "@/data/institutions";

export default function HomePage() {
  const topMfis = [...institutions].sort((a, b) => b.paidUpCapitalCrore - a.paidUpCapitalCrore).slice(0, 6);

  return (
    <div className="max-w-[1400px] w-full mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow">
      <LeftSidebar />

      <main className="lg:col-span-7 flex flex-col gap-6">
        <div className="bg-gradient-to-r from-mfi-600 to-mfi-800 rounded-2xl p-6 text-white">
          <h1 className="text-2xl font-bold mb-2">Nepal&apos;s MFI Intelligence Platform</h1>
          <p className="text-sm text-mfi-200 mb-4">Real-time data on all 51 Class D microfinance institutions licensed by Nepal Rastra Bank.</p>
          <div className="flex gap-3">
            <Link href="/institutions" className="px-4 py-2 bg-white text-mfi-700 rounded-lg text-sm font-bold hover:bg-mfi-50 transition">Explore Institutions</Link>
            <Link href="/reports" className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition border border-white/20">View Reports</Link>
          </div>
        </div>

        <KpiDashboard />

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-slate-700 uppercase tracking-wider">Top MFIs by Paid-Up Capital</h2>
            <Link href="/institutions" className="text-xs font-medium text-mfi-600">View all →</Link>
          </div>
          <div className="space-y-2">
            {topMfis.map((inst) => (
              <Link key={inst.id} href={`/institutions/${inst.slug}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition">
                <div>
                  <div className="text-sm font-medium text-slate-700">{inst.name.replace("Laghubitta Bittiya Sanstha Ltd.", "").trim()}</div>
                  <div className="text-xs text-slate-400">{inst.headOffice}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-800">Rs {inst.paidUpCapitalCrore} Cr</div>
                  <div className="text-[10px] text-slate-400">{inst.coverageType}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <NewsFeed />
      </main>

      <RightSidebar />
    </div>
  );
}
