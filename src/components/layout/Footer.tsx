import Link from "next/link";
import { directorySource } from "@/data/institutions";
import { financialsProvenance } from "@/data/financials";
import { jobsProvenance } from "@/data/jobs";
import { crawlSummary } from "@/data/pilot";
import { formatDate } from "@/util/format";

/**
 * Footer.
 *
 * This is the one place on the site that can state plainly what the data is and
 * when it was last touched, so it does: which directory snapshot the institution
 * records come from, and the fact that most financial and vacancy records are
 * documents whose contents have not been read. A reader who wants to know how
 * much to trust a figure should be able to find that out without asking.
 */
export default function Footer() {
  const sections = [
    {
      title: "Sector",
      links: [
        { href: "/news", label: "News & notices" },
        { href: "/institutions", label: "Institutions" },
        { href: "/people", label: "People" },
        { href: "/nrb", label: "NRB & regulatory" },
      ],
    },
    {
      title: "Information",
      links: [
        { href: "/financials", label: "Financial information" },
        { href: "/interest-rates", label: "Interest rates" },
        { href: "/jobs", label: "Vacancies" },
        { href: "/documents", label: "Documents" },
        { href: "/research", label: "Research" },
      ],
    },
    {
      title: "Operations",
      links: [
        { href: "/ingestion", label: "Ingestion" },
        { href: "/alerts", label: "Alerts" },
        { href: "/compare", label: "Compare" },
        { href: "/search", label: "Search" },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-mfi-800 bg-mfi-950 text-mfi-200">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:pr-8">
            <p className="text-base font-bold tracking-tight text-white">Laghubitta Khabar</p>
            <p className="mt-2 text-sm leading-relaxed text-mfi-300">
              A record of Nepal&apos;s licensed microfinance institutions: who runs them, what they publish, and
              which source each statement came from.
            </p>
          </div>

          {sections.map((section) => (
            <nav key={section.title} aria-label={section.title}>
              <h2 className="lk-eyebrow text-mfi-400">{section.title}</h2>
              <ul className="mt-3 space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-8 items-center text-sm text-mfi-300 underline-offset-4 transition-colors hover:text-white hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 space-y-2 border-t border-mfi-800 pt-6 text-xs leading-relaxed text-mfi-400">
          <p>
            <span className="font-medium text-mfi-200">Institution directory:</span>{" "}
            {directorySource.product}, as of {formatDate(directorySource.asOf) ?? "an unrecorded date"};{" "}
            {directorySource.publishedByNRB
              ? `published by Nepal Rastra Bank on ${formatDate(directorySource.publishedByNRB)}.`
              : "publication date not recorded."}
          </p>
          <p>
            <span className="font-medium text-mfi-200">Financial records:</span> {financialsProvenance}.
          </p>
          <p>
            <span className="font-medium text-mfi-200">Vacancies:</span> {jobsProvenance}.
          </p>
          <p>
            <span className="font-medium text-mfi-200">Source monitoring:</span>{" "}
            {crawlSummary.institutions} sources checked, {crawlSummary.snapshots} page snapshots stored, last
            report {formatDate(crawlSummary.generatedAt) ?? "not recorded"}.
          </p>
          <p className="pt-2 text-mfi-500">
            Records are transcribed from the sources listed on each page. Coverage varies by source: an
            institution with no published leadership page shows none rather than an assumed value.
          </p>
        </div>
      </div>
    </footer>
  );
}
