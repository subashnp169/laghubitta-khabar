import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-[1400px] mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tight text-mfi-600">LAGHUBITTA</span>
            <span className="hidden sm:inline text-sm font-medium text-slate-400">|</span>
            <span className="hidden sm:inline text-sm font-medium text-slate-500">Khabar</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <Link href="/institutions" className="text-slate-600 hover:text-mfi-600 transition">Institutions</Link>
            <Link href="/news" className="text-slate-600 hover:text-mfi-600 transition">News</Link>
            <Link href="/reports" className="text-slate-600 hover:text-mfi-600 transition">Reports</Link>
            <Link href="/jobs" className="text-slate-600 hover:text-mfi-600 transition">Jobs</Link>
            <Link href="/nrb" className="text-slate-600 hover:text-mfi-600 transition">NRB</Link>
            <Link href="/research" className="text-slate-600 hover:text-mfi-600 transition">Research</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/documents" className="text-xs font-medium text-mfi-600 border border-mfi-200 rounded-lg px-3 py-1.5 hover:bg-mfi-50 transition">
              Documents
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
