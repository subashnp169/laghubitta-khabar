import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { ActivityFeed, type ActivityRow } from "@/components/news/ActivityFeed";
import { allActivity } from "@/util/activity";
import { institutionHrefForSlug } from "@/util/institution-profile";

/**
 * Sector activity.
 *
 * This page previously listed eight invented articles written to make the site
 * look populated, including a fabricated analysis of "MFIs competing for
 * deposits" and invented market-share figures. None of it had a source, and a
 * reader had no way to tell.
 *
 * What replaces it is the only news the dataset can actually support: structural
 * changes the Nepal Rastra Bank BFI directory records - mergers, acquisitions and
 * renames - plus documents the NRB has published. Both are dated by the source and
 * linked back to it. Where a date is missing the row says "undated" rather than
 * being sorted into a recent-looking position.
 *
 * There is no opinion, no summary and no "what this means" paragraph here, because
 * producing those would mean writing about the sector rather than reporting it.
 */

export const metadata: Metadata = {
  title: "News & notices",
  description:
    "Structural changes recorded in the Nepal Rastra Bank BFI directory - mergers, acquisitions and renames - and documents published by the regulator, each dated and sourced.",
};

/**
 * Institution profile links are resolved here, on the server, and handed to the
 * client feed as a finished path. The feed is a client component; resolving the
 * slug inside it would ship the entire 51-record directory to the browser. Rows
 * for institutions the directory no longer lists get `null` and render as plain
 * text instead of linking to a page that does not exist.
 */
const ITEMS: ActivityRow[] = allActivity().map((row) => ({
  ...row,
  institutionProfileHref: institutionHrefForSlug(row.institutionSlug),
}));

export default function NewsPage() {
  return (
    <>
      <PageHeader
        eyebrow="News & notices"
        title="What the sources have actually recorded"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          Every item below is a record in this dataset, dated by the source that published it: a structural
          change in the NRB BFI directory, or a document the regulator released. There is no commentary here
          - if you want to know what changed in Nepal&apos;s microfinance sector, this is the record.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <ActivityFeed items={ITEMS} />

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">
          NRB document titles are recorded from the regulator&apos;s own listing. The documents themselves
          have not been read, so nothing on this page summarises their contents - it reports only that they
          exist and when they were published.
        </p>
      </Container>
    </>
  );
}