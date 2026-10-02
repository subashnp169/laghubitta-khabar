import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPerson } from "../../../../lib/api/repository";
import { allPublishedPeople } from "../../../../lib/repository/static-people";
import type { PersonDto } from "../../../../lib/repository/types";
import { institutions } from "@/data/institutions";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip, StatusChip } from "@/components/ui/Chip";
import { Provenance } from "@/components/ui/Provenance";
import { verificationStatus } from "@/util/evidence";
import { formatDate, humanize } from "@/util/format";

/**
 * Person profile.
 *
 * Two things this page previously got wrong.
 *
 * It showed `person.institution_slug.replace(/-/g, " ")` as the institution's
 * name, so a reader saw "asha laghubitta bittiya sanstha ltd" where the directory
 * records "Asha Laghubitta Bittiya Sanstha Ltd." The slug is a URL segment, not a
 * name; it is resolved against the directory here, and falls back to the slug only
 * if the two ever disagree.
 *
 * It defined its own four-colour badge palette for verification status, duplicating
 * `verificationStatus` — which is the single place that decides what each status
 * means. Two vocabularies for one status is how a page ends up calling something
 * "Auto-verified" while the rest of the site calls it something else. The shared
 * helper is used instead.
 *
 * The person is read through `getPerson`, not directly from the projection, on
 * purpose: it is what guarantees this page cannot disagree with
 * `GET /api/people/{slug}`.
 */

/**
 * Role titles for one person. A role the source lists several people in is
 * rendered in the plural, so a row never claims an exclusive office the source
 * did not describe. The names are always all shown; nothing is dropped to make
 * the title fit.
 */
function roleLabels(person: PersonDto): string {
  return person.positions
    .map((pos) =>
      pos.shared_by > 1 && pos.title.endsWith("Officer")
        ? pos.title.replace(/Officer$/, "Officers")
        : pos.title,
    )
    .join(", ");
}

const nameBySlug = new Map(institutions.map((i) => [i.slug, i.name]));

/** Never silently blank: if the projection and the directory disagree, show the slug. */
function institutionName(slug: string): string {
  return nameBySlug.get(slug) ?? slug;
}

export async function generateStaticParams() {
  return allPublishedPeople().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const person = allPublishedPeople().find((p) => p.slug === slug);
  if (!person) return {};
  const titles = person.positions.map((x) => x.title).join(", ");
  return {
    title: `${person.name} — ${titles}`,
    description: `${person.name}, ${roleLabels(person)} at ${institutionName(person.institution_slug)}. Every field traced to the source it came from.`,
  };
}

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const response = getPerson(slug);
  if (response.status !== 200 || !("data" in response.body)) notFound();
  const person = response.body.data as PersonDto;

  const status = verificationStatus(person.meta.verification_status);
  const sourceCount = person.meta.sources.length;
  const corroboration =
    sourceCount > 1
      ? `Listed by ${sourceCount} independent sources.`
      : "Listed by a single source. No second source has confirmed this yet, so the record stays unverified.";

  return (
    <>
      <PageHeader eyebrow="Person" title={person.name}>
        <p className="text-base text-mfi-600">{roleLabels(person)}</p>
        <p className="mt-2 text-sm text-mfi-500">
          <Link
            href={`/institutions/${person.institution_slug}`}
            className="text-mfi-600 underline underline-offset-4"
          >
            {institutionName(person.institution_slug)}
          </Link>
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <div className="lk-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            <Chip tone={sourceCount > 1 ? "positive" : "attention"}>
              {sourceCount > 1 ? `${sourceCount} sources` : "1 source"}
            </Chip>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-mfi-600">{corroboration}</p>
          <p className="mt-2 text-xs leading-relaxed text-mfi-500">{status.help}</p>
        </div>

        <section className="mt-8">
          <h2 className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
            Roles
          </h2>
          <ul className="lk-card lk-divide mt-3 overflow-hidden">
            {person.positions.map((pos) => (
              <li
                key={pos.title}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 sm:px-5"
              >
                <span className="text-sm font-medium text-mfi-900">{pos.title}</span>
                {pos.shared_by > 1 ? (
                  <Chip
                    tone="attention"
                    title="This source lists more than one person under this role. Every name it gave is published; which one the source intends is not known."
                  >
                    {pos.shared_by} names under this title
                  </Chip>
                ) : null}
                <span className="text-xs text-mfi-500">
                  {pos.since ? `since ${formatDate(pos.since) ?? "an unrecorded date"}` : "start date unknown"}
                </span>
              </li>
            ))}
          </ul>
          {person.positions.some((p) => p.shared_by > 1) ? (
            <p className="mt-2 text-xs leading-relaxed text-mfi-500">
              Where a source lists several people under one title, the title is printed as written and the
              count is shown. The record does not pick one.
            </p>
          ) : null}
        </section>

        <Provenance
          className="mt-8"
          status={person.meta.verification_status}
          observedAt={person.meta.last_verified_at}
          sources={person.meta.sources.map((sourceId) => ({
            id: sourceId,
            // Only the primary source has a resolvable URL on the record; the
            // others are identifiers. Showing a plausible link for any of them
            // would be inventing provenance.
            url: sourceId === person.meta.source ? person.meta.source_url : null,
            label: sourceId,
          }))}
        />

        <dl className="lk-card mt-4 px-4 py-3 text-xs sm:px-5">
          <div className="flex flex-wrap gap-x-2 py-1">
            <dt className="min-w-[150px] text-mfi-500">Primary source identifier</dt>
            <dd className="break-all text-mfi-800">{person.meta.source}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 py-1">
            <dt className="min-w-[150px] text-mfi-500">Verification status</dt>
            <dd className="text-mfi-800">
              {humanize(person.meta.verification_status) ?? person.meta.verification_status}
            </dd>
          </div>
        </dl>
      </Container>
    </>
  );
}
