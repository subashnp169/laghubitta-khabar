import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Page-width container. One definition so gutters stay identical on every
 * route and the 320px case is handled in one place rather than per page.
 */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1240px] px-4 sm:px-6 ${className}`}>{children}</div>;
}

/**
 * A section of the page.
 *
 * `id` is applied so the header can deep-link to a section, and the heading is
 * wired to it with `aria-labelledby` so the landmark is named for assistive
 * technology rather than being an anonymous region.
 */
export function Section({
  id,
  title,
  eyebrow,
  description,
  action,
  children,
  className = "",
  headingLevel = 2,
}: {
  id?: string;
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id={id} aria-labelledby={headingId} className={`scroll-mt-24 ${className}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {eyebrow ? <p className="lk-eyebrow mb-1">{eyebrow}</p> : null}
          <Heading id={headingId} className="text-lg font-semibold tracking-tight text-mfi-900 sm:text-xl">
            {title}
          </Heading>
          {description ? <p className="mt-1 max-w-prose text-sm leading-relaxed text-mfi-600">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** "View all →" style link used in a section header. */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded text-sm font-medium text-mfi-700 underline-offset-4 transition-colors hover:text-mfi-900 hover:underline"
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Page title block used at the top of every non-home route. */
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-mfi-100 bg-white">
      <Container className="py-8 sm:py-10">
        {eyebrow ? <p className="lk-eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-mfi-900 sm:text-3xl">{title}</h1>
        {description ? <div className="mt-2 max-w-2xl text-sm leading-relaxed text-mfi-600">{description}</div> : null}
        {children ? <div className="mt-5">{children}</div> : null}
      </Container>
    </header>
  );
}
