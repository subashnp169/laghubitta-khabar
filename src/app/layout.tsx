import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { directorySource } from "@/data/institutions";
import { financialsProvenance } from "@/data/financials";
import { jobsProvenance } from "@/data/jobs";

/**
 * Site metadata.
 *
 * The description deliberately leads with what the site is rather than what it
 * has: the directory is a fixed snapshot and most document records are unread, so
 * promising "verified" coverage anywhere in the metadata would be a claim the data
 * cannot support. The real coverage statements live in the footer instead.
 */
export const metadata: Metadata = {
  // basePath is "/laghubitta-khabar", and Next resolves "./" for canonical/og:url
  // against metadataBase *without* adding basePath itself — verified empirically.
  // Putting basePath in metadataBase is what makes every emitted URL carry it
  // exactly once. Do not move this into next.config.ts or drop the path segment.
  metadataBase: new URL("https://laghubitta.sennaplatform.com/laghubitta-khabar"),
  // Relative, so all 334 pages get their own correct canonical from one
  // declaration. Hardcoding per-page URLs is unnecessary and would rot.
  alternates: { canonical: "./" },
  title: {
    default: "Laghubitta Khabar — Nepal's microfinance institution records",
    template: "%s · Laghubitta Khabar",
  },
  description:
    "A source-linked record of Nepal's licensed microfinance institutions: leadership, branch networks, published documents and vacancies, each traced to the source it came from.",
  applicationName: "Laghubitta Khabar",
  openGraph: {
    // og:url is NOT derived from canonical automatically — it must be declared.
    url: "./",
    type: "website",
    siteName: "Laghubitta Khabar",
    title: "Laghubitta Khabar — Nepal's microfinance institution records",
    description:
      "Source-linked records for Nepal's licensed microfinance institutions, built on the Nepal Rastra Bank BFI directory.",
  },
  // Nothing here is user-specific, and the whole dataset is public information.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#16233c",
  colorScheme: "light",
};

/**
 * Prevents a "no snapshot available" flash on the directory by making it obvious
 * that a figure has a vintage rather than implying it is current.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "DataCatalog",
  name: "Laghubitta Khabar",
  description:
    "Source-linked records for Nepal's licensed microfinance institutions.",
  provider: {
    "@type": "Organization",
    name: "Laghubitta Khabar",
  },
  temporalCoverage: directorySource.asOf,
  variableMeasured: [
    "microfinance institution identity",
    "institution leadership",
    "branch networks",
    "published documents",
    "vacancy notices",
  ],
  citation: [
    financialsProvenance,
    jobsProvenance,
    "Institution directory as published by Nepal Rastra Bank.",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-mfi-50">
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <script
          type="application/ld+json"
          // Static, author-controlled JSON-LD describing the dataset itself.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </body>
    </html>
  );
}
