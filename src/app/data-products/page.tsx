import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Data products",
  description:
    "The read surfaces Laghubitta Khabar publishes today — search, compare, API, sitemap — and the rule that no paid product is built before demand is validated.",
};

const SURFACES = [
  { href: "/search", label: "Search", detail: "Entity-type labels across institutions, people, documents and vacancies." },
  { href: "/compare", label: "Compare", detail: "Side-by-side institution comparison with period and comparability labels." },
  { href: "/api", label: "Public API (v1)", detail: "Read-only JSON contract with discovery index and OpenAPI 3.1 document." },
  { href: "/sitemap.xml", label: "Sitemap", detail: "Machine-readable index of every published page (374 URLs)." },
  { href: "/research", label: "Research", detail: "Labelled fact / calculation / analysis / external statements, each sourced." },
  { href: "/reports", label: "Reports", detail: "Published reports and methodology notes." },
];

export default function DataProductsPage() {
  return (
    <>
      <PageHeader eyebrow="Data products" title="What you can read today">
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Laghubitta Khabar publishes read surfaces, not products for sale. Every one of them is free, sourced and
          versioned. Nothing is monetised.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10 space-y-8">
        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">Available read surfaces</h2>
          <ul className="lk-card lk-divide mt-3 overflow-hidden">
            {SURFACES.map((s) => (
              <li key={s.href} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <Link
                    href={s.href}
                    className="text-sm font-semibold text-mfi-900 underline underline-offset-2"
                  >
                    {s.label}
                  </Link>
                  <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">Paid products and commerce</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mfi-600">
            None are built yet, and none will be until demand is validated. The frozen spec (P16/P17) treats
            commerce as a later decision, not a feature: building a store before anyone asks for a product would
            be fabrication. If you want a bulk export, an API tier or a research product, open a GitHub issue and
            say what you would use it for.
          </p>
          <p className="mt-3">
            <a
              href="https://github.com/subashnp169/laghubitta-khabar/issues/new"
              className="inline-flex items-center rounded-md border border-mfi-200 bg-white px-3 py-2 text-sm font-medium text-mfi-700 underline-offset-2 transition-colors hover:border-mfi-300 hover:bg-mfi-50"
              rel="noopener noreferrer"
              target="_blank"
            >
              Request a data product
            </a>
          </p>
        </section>

        <p className="text-xs leading-relaxed text-mfi-500">
          Research authoring follows the same honesty rule: every statement is labelled Fact, Calculation,
          Analysis or External, and every one links to its source. See /research.
        </p>
      </Container>
    </>
  );
}
