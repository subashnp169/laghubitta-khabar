import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { SearchIndex } from "@/components/search/SearchIndex";
import { buildSearchEntries } from "@/util/search-index";

/**
 * Search.
 *
 * The site is a static export, so this page cannot read a query string at build
 * time and there is no runtime endpoint to ask. The index below is compiled into
 * the page and filtered in the browser by `SearchIndex`.
 *
 * That forces a trade-off worth being explicit about: the index carries a label
 * and one short line of context per record, not the whole record. It is a finding
 * aid — every entry links to the page that holds the detail and the sources.
 * Shipping full records to the client would be the alternative, and it would put
 * roughly 50 KB of institution and document data into this one page's payload to
 * avoid clicking through.
 *
 * With JavaScript off the page still lists everything, so search degrades to
 * browsing rather than to a blank screen.
 */

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search across Nepal's licensed microfinance institutions, their leadership, documents, vacancies and regulatory activity.",
  robots: { index: false, follow: true },
};

const ENTRIES = buildSearchEntries();
export default function SearchPage() {
  return (
    <Container>
      <PageHeader
        title="Search"
        description="Find institutions, people, documents, vacancies and regulatory activity across the record."
      />
      <SearchIndex entries={ENTRIES} />
    </Container>
  );
}

