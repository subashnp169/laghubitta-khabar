import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { posts } from "@/data/posts";
import Link from "next/link";

export async function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) return {};
  return { title: `${post.title} — Laghubitta Khabar`, description: post.excerpt };
}

export default async function NewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      <Link href="/news" className="text-xs text-mfi-600 hover:underline">&larr; Back to News</Link>
      <article className="mt-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mfi-600 bg-mfi-50 px-2 py-0.5 rounded">{post.category}</span>
          <span className="text-xs text-slate-400">{post.publishedAt}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">{post.title}</h1>
        <div className="text-sm text-slate-400 mb-6">By {post.author}</div>
        <div className="prose prose-sm max-w-none text-slate-700">
          <p className="text-sm leading-relaxed">{post.content}</p>
          <p className="text-sm leading-relaxed mt-4">This is a detailed analysis article. In the full version, comprehensive coverage would include expert commentary, data visualizations, and regulatory context. Stay tuned for the complete report.</p>
        </div>
      </article>
    </div>
  );
}
