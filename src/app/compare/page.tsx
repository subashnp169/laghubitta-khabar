import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { buildCompareModel } from "../../../lib/compare";
import { institutions } from "@/data/institutions";
import { crawlSources } from "@/data/pilot";
import { nrbDocuments, nrbInstitutionLinks, nrbRegulatoryEvents } from "@/data/nrb";
import CompareView from "@/components/compare/CompareView";

/**
 * Comparison.
 *
 * Every column is a field that exists in a source; every cell is either the
 * recorded value or the words "not recorded". The previous framing called this
 * "deterministic sourced evidence", which described the pipeline rather than what
 * a reader sees. What a reader sees is a comparison table with honest gaps, and
 * that is what this page now says about itself.
 */

export const metadata: Metadata = {
  title: "Compare",
  description: `Side-by-side comparison of ${institutions.length} microfinance institutions across identity, capital, geography, web evidence and regulatory footprint. Unrecorded fields stay empty.`,
};

export default function ComparePage() {
  const model = buildCompareModel(institutions, crawlSources, {
    documents: nrbDocuments,
    links: nrbInstitutionLinks,
    events: nrbRegulatoryEvents,
  });

  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title="Side by side"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {model.institutions.length} institutions, compared field by field: identity, capital, geography,
          what we could fetch from their websites, and their recorded regulatory footprint. A cell with no
          source says <span className="font-medium text-mfi-800">not recorded</span> — it is never filled in
          with an estimate, a guess, or a value from a different institution.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <CompareView model={model} />

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-mfi-500">
          Built from the NRB directory, the NRB document and event ledgers, and the source-monitoring
          snapshot — computed at build time from those records alone. A &ldquo;highest&rdquo; marker means
          highest among the institutions you have selected, not in the sector; select more than one to make
          the comparison mean anything. Your selection is not saved or sent anywhere.
        </p>
      </Container>
    </>
  );
}
