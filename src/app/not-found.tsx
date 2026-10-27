import Link from "next/link";
import { Container } from "@/components/ui/Section";

/**
 * 404 — a not-found page that stays on-brand.
 *
 * Next renders this inside the root layout, so the header, footer and skip link
 * are already present; this fills the <main> region that the framework default
 * left as a bare, unstyled "This page could not be found." It offers a way back
 * rather than a dead end.
 *
 * Metadata: App Router does not let `not-found.tsx` export `metadata`, and Next
 * already stamps this route `robots: noindex`. The conflicting `index, follow`
 * that used to ride along came from the root layout's global robots rule, which
 * is no longer declared (see `layout.tsx`).
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/institutions", label: "Institutions" },
  { href: "/news", label: "News & notices" },
  { href: "/search", label: "Search" },
];

export default function NotFound() {
  return (
    <Container className="py-16 sm:py-24">
      <p className="lk-eyebrow">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-mfi-900 sm:text-3xl">
        Page not found
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mfi-500">
        This address is not part of the directory. Laghubitta Khabar publishes only
        the institution records, documents and notices it can trace to a source, so
        the page you asked for may never have existed or may have moved.
      </p>
      <nav aria-label="Useful pages" className="mt-6">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-sm font-medium text-mfi-700 underline underline-offset-4 transition-colors hover:text-mfi-900"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Container>
  );
}
