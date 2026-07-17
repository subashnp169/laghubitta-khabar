import type { Metadata } from "next";
import { videos } from "@/data/videos";

export const metadata: Metadata = {
  title: "Videos — Laghubitta Khabar",
  description: "Microfinance video library covering sector analysis, interviews, and educational content.",
};

export default function VideosPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Video Library</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {videos.map((video) => (
          <div key={video.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-sm transition">
            <div className="aspect-video bg-slate-100 flex items-center justify-center">
              <div className="text-4xl text-slate-300">▶</div>
            </div>
            <div className="p-3">
              <h3 className="font-semibold text-sm text-slate-800">{video.title}</h3>
              <div className="flex items-center justify-between mt-1 text-xs text-slate-400">
                <span>{video.channel}</span>
                <span>{video.duration}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">{video.publishedAt}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
