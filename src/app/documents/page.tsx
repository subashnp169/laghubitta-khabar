import type { Metadata } from "next";
import { documents } from "@/data/documents";

export const metadata: Metadata = {
  title: "Documents — Laghubitta Khabar",
  description: "Download regulatory documents, reports, and data files on Nepal's microfinance sector.",
};

export default function DocumentsPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Documents Library</h1>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider hidden md:table-cell">Source</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider hidden md:table-cell">Date</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Size</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3">
                  <a href={doc.url} className="font-medium text-mfi-600 hover:underline text-sm">{doc.title}</a>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 hidden md:table-cell">{doc.institution}</td>
                <td className="px-4 py-3 text-xs text-slate-500 hidden md:table-cell">{doc.date}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{doc.size}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{doc.type}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
