import Link from "next/link";
import {
  CONTENT_BUCKET_DETAIL,
  CONTENT_BUCKET_HREF,
  CONTENT_BUCKET_LABEL,
  CONTENT_BUCKET_ORDER,
  type ContentBucket,
} from "@/util/buckets";

/**
 * The three content buckets, rendered as one legend so a reader sees the same
 * names and the same counts on every page that carries them. Buckets holding
 * nothing are shown too, with a count of zero and their explanation — an absent
 * bucket is a fact about the dataset, not a reason to hide the category.
 *
 * Server component: no state, no per-bucket counts passed in, so the legend is
 * identical wherever it appears.
 */
export function ContentBuckets({
  counts,
  current,
}: {
  counts: Record<ContentBucket, number>;
  current?: ContentBucket;
}) {
  return (
    <dl
      aria-label="Content buckets"
      className="grid gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-3"
    >
      {CONTENT_BUCKET_ORDER.map((bucket) => {
        const href = CONTENT_BUCKET_HREF[bucket];
        const count = counts[bucket];
        const isCurrent = bucket === current;
        const body = (
          <>
            <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <dt className="text-sm font-semibold text-mfi-900">{CONTENT_BUCKET_LABEL[bucket]}</dt>
              <dd className="font-mono text-xs text-mfi-500">
                {count === 0 ? "empty" : `${count} record${count === 1 ? "" : "s"}`}
              </dd>
            </span>
            <dd className="mt-1 text-xs leading-relaxed text-mfi-500">{CONTENT_BUCKET_DETAIL[bucket]}</dd>
          </>
        );
        const shared = `block bg-white px-4 py-3.5 ${isCurrent ? "ring-1 ring-inset ring-mfi-900" : ""}`;
        return href && count > 0 ? (
          <Link
            key={bucket}
            href={href}
            aria-current={isCurrent ? "true" : undefined}
            className={`${shared} transition-colors hover:bg-mfi-50`}
          >
            {body}
          </Link>
        ) : (
          <div key={bucket} className={shared}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}
