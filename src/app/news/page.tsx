import type { Metadata } from "next";
import Link from "next/link";
import { posts } from "@/data/posts";

export const metadata: Metadata = {
  title: "News — Laghubitta Khabar",
  description: "Latest microfinance news, analysis, and regulatory updates from Nepal's MFI sector.",
};

export default function NewsPage() {
  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">News & Analysis</h1>
      <div className="space-y-4">
        {posts.map((post) => (
          <Link key={post.id} href={`/news/${post.slug}`} className="block bg-white rounded-xl border border-slate-200 p-5 hover:border-mfi-200 hover:shadow-sm transition">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mfi-600 bg-mfi-50 px-2 py-0.5 rounded">{post.category}</span>
              <span className="text-xs text-slate-400">{post.publishedAt}</span>
            </div>
            <h2 className="font-bold text-slate-800 mb-1">{post.title}</h2>
            <p className="text-sm text-slate-500">{post.excerpt}</p>
            <div className="text-xs text-slate-400 mt-2">By {post.author}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
