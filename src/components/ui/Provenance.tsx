import { Chip, StatusChip } from "./Chip";
import { TONE_DOT, verificationStatus } from "@/util/evidence";
import {
  NOT_AVAILABLE,
  displayHost,
  formatDateTime,
  formatRelative,
  humanize,
  isFresh,
  realUrl,
} from "@/util/format";

export interface ProvenanceSource {
  id: string;
  url?: string | null;
  observedAt?: string | null;
  label?: string | null;
  status?: string | null;
}

export interface ProvenanceProps {
  sources?: ProvenanceSource[];
  /** When the record itself was last observed, if known. */
  observedAt?: string | null;
  /** Verification status of the record, if it has one. */
  status?: string | null;
  /** Suppress the expandable panel for dense repeated rows. */
  compact?: boolean;
  className?: string;
}

/**
 * The evidence line under a record.
 *
 * This is the part of the product that a news site cannot copy, so it is built
 * to be read by a sceptical person: it states how many independent sources back
 * the record, when each was seen, and where each came from — and it refuses to
 * claim corroboration it does not have. "Source-backed" specifically means a
 * snapshot was observed and attributed; it never implies anyone checked the
 * content, and it is never shown for a record with no observation.
 *
 * The panel is a native <details>, so it works with no JavaScript, is
 * keyboard-operable for free, and stays closed until a reader asks for it.
 */
export function Provenance({
  sources = [],
  observedAt,
  status,
  compact = false,
  className = "",
}: ProvenanceProps) {
  const usable = sources.filter((s) => s && (s.url || s.observedAt || s.label));
  const latest = observedAt ?? usable.map((s) => s.observedAt).filter(Boolean).sort().at(-1) ?? null;
  const verifiedLabel = formatDateTime(latest);
  const relative = formatRelative(latest);

  if (usable.length === 0 && !observedAt) {
    return (
      <p className={`text-xs text-mfi-500 ${className}`}>
        No source has been recorded for this record yet.
      </p>
    );
  }

  const distinctSources = new Set(usable.map((s) => s.id)).size;
  const corroborating = distinctSources > 1;
  // Only shown when the record actually has a status. A missing status must not
  // render as "unverified" — that would invent a verification claim in reverse.
  const recordStatus = status ? verificationStatus(status) : null;

  return (
    <div className={`text-xs ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {recordStatus ? <StatusChip status={recordStatus} /> : null}

        {distinctSources > 0 ? (
          <Chip tone={corroborating ? "positive" : "neutral"} title={corroborating ? `${distinctSources} independent sources report this, which is corroboration rather than a single claim.` : "Recorded from a single source, so it is not corroborated."}>
            {distinctSources === 1 ? "1 source" : `${distinctSources} sources`}
          </Chip>
        ) : null}

        {latest ? (
          <span className="inline-flex items-center gap-1.5 text-mfi-600">
            {isFresh(latest) ? (
              <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT.positive} lk-fresh-dot`} aria-hidden="true" />
            ) : null}
            <span>
              Last observed {verifiedLabel ?? NOT_AVAILABLE}
              {relative ? <span className="text-mfi-400"> · {relative}</span> : null}
            </span>
          </span>
        ) : null}

        {!compact && usable.length > 0 ? (
          <details className="group inline">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-medium text-mfi-700 underline-offset-4 hover:underline">
              Sources
              <span className="text-mfi-400 transition-transform group-open:rotate-90" aria-hidden="true">
                ›
              </span>
            </summary>
            <ul className="mt-2 space-y-1.5 rounded-md border border-mfi-100 bg-mfi-50/60 p-2.5">
              {usable.map((source) => (
                <li key={source.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium text-mfi-800">{humanize(source.label) ?? source.id}</span>
                  {displayHost(source.url) ? (
                    realUrl(source.url) ? (
                      <a
                        href={realUrl(source.url)!}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="truncate text-mfi-500 underline-offset-2 hover:text-mfi-700 hover:underline"
                      >
                        {displayHost(source.url)}
                      </a>
                    ) : (
                      <span className="text-mfi-500">{displayHost(source.url)}</span>
                    )
                  ) : null}
                  {source.observedAt ? (
                    <span className="text-mfi-500">· seen {formatDateTime(source.observedAt)}</span>
                  ) : null}
                  {source.status ? (
                    <span className="text-mfi-500">· {humanize(source.status) ?? statusLabel(source.status)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}
