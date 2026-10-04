import type { ReactNode } from "react";
import type { Tone } from "@/util/evidence";

/**
 * One label/value cell for a statistics strip.
 *
 * This was previously a page-local function copied into nine routes, which is how
 * the same concept ended up looking slightly different depending on the page. It
 * is now defined once so a figure reads identically everywhere.
 *
 * A cell shows a value or, when the value is genuinely absent, an honest
 * fallback. The fallback is styled as a caveat rather than as a figure so a
 * missing number can never be mistaken for a measured one.
 */
const ACCENT: Record<Tone, string> = {
  positive: "text-nrb-700",
  attention: "text-flag-700",
  conflict: "text-alert-700",
  info: "text-mfi-700",
  neutral: "text-mfi-900",
};

export function Stat({
  term,
  value,
  fallback,
  tone = "neutral",
  hint,
  dense = false,
}: {
  term: string;
  value: ReactNode | null | undefined;
  /** Shown when there is no value. Required so absence is always stated. */
  fallback?: string;
  tone?: Tone;
  /** Optional qualifier rendered under the value. */
  hint?: ReactNode;
  /**
   * Tighter cell for dense operational readouts (the collection control room),
   * where a strip carries more cells and the figures are pipeline counts rather
   * than published facts.
   */
  dense?: boolean;
}) {
  return (
    <div className={`bg-white px-4 ${dense ? "py-3.5" : "py-4"}`}>
      <dt className="lk-eyebrow">{term}</dt>
      <dd
        className={
          dense
            ? `mt-1 text-xl font-semibold tabular-nums tracking-tight ${value ? ACCENT[tone] : "text-mfi-500"}`
            : `lk-figure mt-1.5 ${value ? ACCENT[tone] : ""}`
        }
      >
        {value ?? (
          <span className="text-sm font-normal text-flag-700">{fallback ?? "Not recorded"}</span>
        )}
        {value && hint ? <span className="mt-1 block text-xs font-normal text-mfi-500">{hint}</span> : null}
      </dd>
    </div>
  );
}

/**
 * The `<dl>` wrapper for a strip of `Stat` cells. The hairline gap and border
 * colour are what produce the ledger look, so they live with the cells.
 */
export function StatGrid({
  children,
  columns = 4,
  className = "",
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <dl
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 ${cols} ${className}`}
    >
      {children}
    </dl>
  );
}

/** A term/value pair inside a dense definition list. */
export function Row({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-mfi-500">{term}</dt>
      <dd className="min-w-0 text-right font-medium text-mfi-800">{value}</dd>
    </div>
  );
}