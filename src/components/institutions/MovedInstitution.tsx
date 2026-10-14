"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Container } from "@/components/ui/Section";

/**
 * Superseded-slug landing page.
 *
 * A corrected identity changes an institution's canonical slug, but the old URL is
 * still live inbound traffic. Previously this page called `permanentRedirect()`,
 * which the static export could not turn into a real 301: Next emitted a bare
 * client-redirect shell with no `lang`, `<main>`, `<h1>` or skip link, so the old
 * URLs were error pages for crawlers and no-JS visitors (and failed
 * `scripts/audit-export.cjs`).
 *
 * This renders a real, accessible page through the root layout and performs the
 * same client-side redirect with `router.replace`. The redirect behaviour is
 * unchanged; the page is now readable and indexable instead of an error shell.
 */
export default function MovedInstitution({
  fromSlug,
  toSlug,
}: {
  fromSlug: string;
  toSlug: string;
}) {
  const router = useRouter();
  const target = `/institutions/${toSlug}`;

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return (
    <Container className="py-16 sm:py-24">
      <section className="lk-card mx-auto max-w-xl p-6 sm:p-8">
        <p className="lk-eyebrow">Institution record</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-mfi-900 sm:text-3xl">
          This page has moved
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-mfi-700">
          The institution formerly published at{" "}
          <span className="font-medium text-mfi-900">/institutions/{fromSlug}</span> is now
          recorded at{" "}
          <Link
            href={target}
            className="font-medium text-mfi-700 underline underline-offset-4 hover:text-mfi-900"
          >
            /institutions/{toSlug}
          </Link>
          . If you are not redirected automatically, follow that link.
        </p>
      </section>
    </Container>
  );
}