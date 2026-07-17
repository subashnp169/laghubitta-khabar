import { posts } from "@/data/posts";

export default function Ticker() {
  return (
    <div className="bg-mfi-900 text-white text-xs py-1.5 overflow-hidden">
      <div className="flex whitespace-nowrap ticker-wrap">
        <span className="inline-flex items-center gap-6 mx-4">
          <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-accent-500" />
          <span className="font-semibold uppercase tracking-wider text-accent-300">Live</span>
          {posts.map((p) => (
            <span key={p.id} className="mx-4">
              {p.title}
              <span className="mx-2 text-slate-500">|</span>
            </span>
          ))}
        </span>
        <span className="inline-flex items-center gap-6 mx-4">
          <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-accent-500" />
          <span className="font-semibold uppercase tracking-wider text-accent-300">Live</span>
          {posts.map((p) => (
            <span key={p.id} className="mx-4">
              {p.title}
              <span className="mx-2 text-slate-500">|</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
