import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { InstitutionDirectory } from "@/components/institutions/InstitutionDirectory";
import { directorySource, institutions } from "@/data/institutions";
import { crawlSummary } from "@/data/pilot";
import { formatDate } from "@/util/format";

/**
 * The directory.
 *
 * Filtering and sorting happen in the browser over data compiled into the page,
 * because the site is a static export: there is no server to read `?q=` or handle
 * a form GET. See `InstitutionDirectory` for what that costs.
 *
 * The working-area options are derived from the values actually present in the
 * data rather than a hand-maintained list, so a coverage type added upstream
 * appears without a code change - and cannot appear as a dead filter option.
 */

export const metadata: Metadata = {
  title: "Institutions",
  description: `Directory of ${institutions.length} microfinance institutions licensed by Nepal Rastra Bank, from the ${formatDate(directorySource.asOf) ?? "published"} BFI directory.`,
};

/** Built once at build time; passed down so the client needs no data module. */
const AREAS = [...new Set(institutions.map((i) => i.workingArea))].sort();

export default function InstitutionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Microfinance institutions"
        description={`${institutions.length} institutions from the Nepal Rastra Bank BFI directory, as of ${formatDate(directorySource.asOf) ?? "an unrecorded date"}. Records come from the regulator's published list; other details are collected from each institution's own site where one could be found.`}
      />

      <Container className="py-8 sm:py-10">
        <InstitutionDirectory institutions={institutions} areas={AREAS} />

        <p className="mt-10 rounded-md border border-mfi-200 bg-white px-4 py-3 text-xs leading-relaxed text-mfi-600">
          <span className="font-semibold text-mfi-800">On coverage: </span>
          Paid-up capital and working area come from the NRB directory for every institution here. Official
          websites are recorded as &ldquo;candidate&rdquo; across the current snapshot, which is why the cards
          show no site link.{" "}
          {crawlSummary.withEvidence} of {institutions.length} institutions have page snapshots from the
          monitoring pipeline - see the{" "}
          <Link href="/ingestion" className="underline underline-offset-2">
            control room
          </Link>
          .
        </p>
      </Container>
    </>
  );
}