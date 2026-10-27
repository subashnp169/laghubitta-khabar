import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Support",
  description:
    "How to support Laghubitta Khabar. No paid products exist; support is voluntary and goes through GitHub Sponsors.",
};

export default function SupportPage() {
  return (
    <>
      <PageHeader eyebrow="Support" title="Support this project">
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Laghubitta Khabar is free and has no paid tier, no subscription and no advertising. Nothing is monetised.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10 space-y-8">
        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">Voluntary support</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mfi-600">
            If this record is useful to you, you can sponsor the maintainer on GitHub. Sponsorship is voluntary and
            does not buy features, priority or access — the site stays free and read-only either way.
          </p>
          <p className="mt-3">
            <a
              href="https://github.com/sponsors/subashnp169"
              className="inline-flex items-center rounded-md border border-mfi-200 bg-white px-3 py-2 text-sm font-medium text-mfi-700 underline-offset-2 transition-colors hover:border-mfi-300 hover:bg-mfi-50"
              rel="noopener noreferrer"
              target="_blank"
            >
              Sponsor on GitHub
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">Why there is no store</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mfi-600">
            Commerce (paid exports, API tiers, sponsored content) is a product decision, not a feature. Building a
            checkout before anyone asks for a product would be fabrication, and the frozen spec keeps monetisation
            out of V1. If you have a concrete use case, open a GitHub issue and describe what you would pay for
            and why.
          </p>
          <p className="mt-3">
            <a
              href="https://github.com/subashnp169/laghubitta-khabar/issues/new"
              className="inline-flex items-center rounded-md border border-mfi-200 bg-white px-3 py-2 text-sm font-medium text-mfi-700 underline-offset-2 transition-colors hover:border-mfi-300 hover:bg-mfi-50"
              rel="noopener noreferrer"
              target="_blank"
            >
              Open a GitHub issue
            </a>
          </p>
        </section>

        <p className="text-xs leading-relaxed text-mfi-500">
          V1 scope is read-only and free. Monetisation, if it ever happens, requires an explicit product decision
          and will be announced, not silently introduced.
        </p>
      </Container>
    </>
  );
}
