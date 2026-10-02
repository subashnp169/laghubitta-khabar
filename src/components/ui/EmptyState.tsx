import type { ReactNode } from "react";

/**
 * The honest answer to "there is nothing here".
 *
 * Every data surface on this site has one of these rather than a blank region,
 * and none of them suggests the reader is looking at a broken page. `detail`
 * says *why* it is empty and, where that is knowable, what would fill it — an
 * empty state that names its own cause is information, not decoration.
 */
export function EmptyState({
  title,
  detail,
  action,
  compact = false,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-mfi-200 bg-mfi-50/50 text-center ${
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-12"
      }`}
      role="status"
    >
      <p className={`font-medium text-mfi-800 ${compact ? "text-sm" : "text-base"}`}>{title}</p>
      {detail ? <p className="max-w-prose text-sm leading-relaxed text-mfi-600">{detail}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Placeholder rows shown while a client-side view filters or paginates.
 *
 * Marked `aria-hidden` and paired with a live region by the caller, so a screen
 * reader hears "loading" once rather than a run of empty boxes.
 */
export function SkeletonRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="lk-skeleton h-14 rounded-lg" />
      ))}
    </div>
  );
}
