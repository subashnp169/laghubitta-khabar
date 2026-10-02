"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, humanize, realUrl } from "@/util/format";

/**
 * Sector activity feed with a kind filter.
 *
 * Client state rather than a `?kind=` query: the site is a static export, so a
 * query cannot be read at build time. The tabs carry counts so selecting one is
 * never a guess about how many rows will appear.
 */

export interface ActivityRow {
  id: string;
  kind: "regulatory" | "publication";
  occurredAt: string | null;
  title: string;
  detail: string;
  institutionSlug: string | null;
  institutionName: string | null;
  /**
   * Resolved by the server page, not looked up here. This is a client component:
   * importing the institution directory to check the slug would ship all 51
   * records and their evidence objects to the browser. Some regulatory events
   * name an institution the directory has no row for, and those rows must render
   * without a profile link rather than link to a 404.
   */
  institutionProfileHref: string | null;
  sourceTitle: string;
  href: string | null;
  label: string | null;
}

type Filter = "all" | "regulatory" | "publication";

const EVENT_TONE: Record<string, "attention" | "info" | "conflict"> = {
  MERGED: "info",
  ACQUIRED: "attention",
  RENAMED: "conflict",
};

export function ActivityFeed({ items }: { items: ActivityRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  const undated = visible.filter((i) => !i.occurredAt).length;

  const tabs: Array<{ key: Filter; label: string; blurb: string }> = [
    { key: "all", label: "Everything", blurb: "Records and publications" },
    { key: "regulatory", label: "Regulatory record", blurb: "Mergers, acquisitions, renames" },
    { key: "publication", label: "NRB publications", blurb: "Documents the regulator published" },
  ];

  return (
    <div>
      <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = filter === tab.key;
          const count =
            tab.key === "all" ? items.length : items.filter((i) => i.kind === tab.key).length;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={active}
              className={`inline-flex min-h-9 flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-1.5 text-left transition-colors ${
                active
                  ? "border-mfi-900 bg-mfi-900 text-white"
                  : "border-mfi-200 bg-white text-mfi-700 hover:border-mfi-300 hover:bg-mfi-50"
              }`}
            >
              <span className="text-sm font-medium">{tab.label}</span>
              <span className={`text-[11px] ${active ? "text-mfi-200" : "text-mfi-400"}`}>
                {count} · {tab.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-mfi-600">
        <span className="font-medium text-mfi-900">{visible.length}</span>{" "}
        {visible.length === 1 ? "record" : "records"}
        {undated > 0 ? <span className="text-mfi-500"> · {undated} without a date, listed last</span> : null}
      </p>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No records in this category" detail="Nothing in the current dataset matches this filter." />
        </div>
      ) : (
        <ol className="lk-card lk-divide mt-5 overflow-hidden">
          {visible.map((item) => {
            const tone = item.kind === "regulatory" ? EVENT_TONE[item.label ?? ""] ?? "info" : "neutral";
            const label = item.kind === "regulatory" ? item.label ?? "change" : "publication";
            return (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 py-4 transition-colors hover:bg-mfi-50 sm:px-5">
                <span className="font-mono text-xs tabular-nums text-mfi-500">
                  {formatDate(item.occurredAt) ?? "undated"}
                </span>
                <Chip tone={tone}>{humanize(label) ?? label}</Chip>

                <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-mfi-900">
                  {item.href ? (
                    item.href.startsWith("/") ? (
                      <Link href={item.href} className="underline-offset-4 hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      <a
                        href={realUrl(item.href) ?? item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {item.title}
                      </a>
                    )
                  ) : (
                    item.title
                  )}
                </span>

                {item.institutionProfileHref ? (
                  <Link
                    href={item.institutionProfileHref}
                    className="shrink-0 text-xs text-mfi-600 underline-offset-4 hover:underline"
                  >
                    {item.institutionName}
                  </Link>
                ) : item.institutionName ? (
                  <span className="shrink-0 text-xs text-mfi-600">{item.institutionName}</span>
                ) : null}

                <span className="w-full text-xs text-mfi-500 sm:ml-auto sm:w-auto">
                  {item.sourceTitle}
                  {item.kind === "publication" ? ` · ${item.detail}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
