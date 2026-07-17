import Link from "next/link";
import { posts } from "@/data/posts";

export default function NewsFeed() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-slate-800">Latest News & Analysis</h2>
        <Link href="/news" className="text-xs font-medium text-mfi-600 hover:text-mfi-700 transition">View all →</Link>
      </div>
      <div className="space-y-3">
        {posts.map((post) => (
          <Link key={post.id} href={`/news/${post.slug}`} className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-mfi-200 hover:shadow-sm transition">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mfi-600 bg-mfi-50 px-2 py-0.5 rounded">{post.category}</span>
              <span className="text-xs text-slate-400">{post.publishedAt}</span>
            </div>
            <h3 className="font-semibold text-slate-800 text-sm mb-1">{post.title}</h3>
            <p className="text-xs text-slate-500 line-clamp-2">{post.excerpt}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
