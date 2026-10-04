import type { ReactNode } from "react";
import Link from "next/link";

/**
 * A titled block of content.
 *
 * Previously defined inside the institution profile only, where it was used nine
 * times. Promoting it gives every page one card treatment, and lets the optional
 * `id` drive the in-page navigation on pages that have one.
 */
export function Panel({
  title,
  count,
  note,
  id,
  headingLevel = 2,
  action,
  children,
  className = "",
}: {
  title: string;
  count?: string;
  note?: ReactNode;
  /** Anchor target for in-page navigation. */
  id?: string;
  headingLevel?: 2 | 3;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id={id} aria-labelledby={headingId} className={`lk-card scroll-mt-28 p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={headingId} className="text-sm font-semibold text-mfi-900">
          {title}
        </Heading>
        <div className="flex shrink-0 items-baseline gap-3">
          {action}
          {count ? <span className="font-mono text-xs text-mfi-500">{count}</span> : null}
        </div>
      </div>
      {note ? <p className="mt-1 text-xs leading-relaxed text-mfi-500">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * In-page navigation for a long page.
 *
 * A client component only in that it highlights the section in view; the links
 * themselves are ordinary anchors, so they work with no JavaScript at all.
 */
export function SectionNav({
  items,
  label = "On this page",
}: {
  items: { href: string; label: string; count?: number | string }[];
  label?: string;
}) {
  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="lk-scroll-x -mx-4 border-y border-mfi-100 bg-white/95 px-4 backdrop-blur-sm sm:mx-0 sm:rounded-lg sm:border">
      <ul className="flex min-w-max items-center gap-1 py-1.5">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-mfi-700 transition-colors hover:bg-mfi-50 hover:text-mfi-900"
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="font-mono text-xs text-mfi-400">{item.count}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Breadcrumb trail. Shared so the separator, sizing and link treatment match on
 * every page that shows one.
 */
export function Breadcrumb({
  items,
  label = "Breadcrumb",
}: {
  items: { href?: string; label: string }[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className="text-xs text-mfi-500">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="underline-offset-4 hover:text-mfi-800 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-mfi-700" : undefined} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {last ? null : (
                <span aria-hidden="true" className="text-mfi-300">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}