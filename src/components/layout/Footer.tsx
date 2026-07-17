import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-mfi-800 text-slate-300 mt-12">
      <div className="max-w-[1400px] mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-bold text-lg mb-3">Laghubitta Khabar</h3>
            <p className="text-sm text-slate-400">Nepal&apos;s premier microfinance intelligence platform. Data-driven insights on 51 Class D MFIs licensed by NRB.</p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/institutions" className="hover:text-white transition">Institutions</Link></li>
              <li><Link href="/news" className="hover:text-white transition">News</Link></li>
              <li><Link href="/reports" className="hover:text-white transition">Reports</Link></li>
              <li><Link href="/jobs" className="hover:text-white transition">Jobs</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/nrb" className="hover:text-white transition">NRB Center</Link></li>
              <li><Link href="/documents" className="hover:text-white transition">Documents</Link></li>
              <li><Link href="/research" className="hover:text-white transition">Research</Link></li>
              <li><Link href="/videos" className="hover:text-white transition">Videos</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Data Source</h4>
            <p className="text-sm text-slate-400">Data verified from <a href="https://www.nrb.org.np" target="_blank" rel="noopener" className="text-mfi-300 hover:text-white transition">Nepal Rastra Bank</a> BFI List as of Mid-May 2026.</p>
          </div>
        </div>
        <div className="border-t border-slate-700 mt-8 pt-6 text-center text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Laghubitta Khabar. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
