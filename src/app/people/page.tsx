import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip, StatusChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { allPublishedPeople } from "../../../lib/repository/static-people";
import { institutions } from "@/data/institutions";
import { verificationStatus, sourceCount } from "@/util/evidence";
import { formatDate, humanize, initials } from "@/util/format";
import type { PersonDto } from "../../../lib/repository/types";
import { Stat } from "@/components/ui/Stat";

/**
 * Leadership directory.
 *
 * The projection this reads is current-roles-only by design, which has a visible
 * consequence worth being precise about: a person who left an institution is not
 * here at all, and an institution that publishes no leadership page contributes
 * no rows. Both cases are stated on the page instead of being smoothed over,
 * because the alternative — a reader counting 107 people and assuming that is
 * the sector's leadership — would be a wrong inference presented as a fact.
 *
 * Where an institution lists several names under one role, every name is listed.
 * The projection carries a `shared_by` for exactly this case and the UI
 * says so, rather than silently dropping the extras.
 */

export const metadata: Metadata = {
  title: "People",
  description:
    "Currently listed leadership at Nepal's licensed microfinance institutions, each entry traced to the institution page it was read from.",
};

const people = allPublishedPeople();

/** Institutions that publish leadership, so coverage can be stated honestly. */
const withLeadership = new Set(people.map((p) => p.institution_slug));
const withoutLeadership = institutions.filter((i) => !withLeadership.has(i.slug));

export default function PeoplePage() {
  // Group by institution so a reader looking for one organisation's board sees
  // it in one place instead of scattered through a flat alphabetical list.
  const byInstitution = new Map<string, PersonDto[]>();
  for (const person of people) {
    const list = byInstitution.get(person.institution_slug);
    if (list) list.push(person);
    else byInstitution.set(person.institution_slug, [person]);
  }

  const groups = [...byInstitution.entries()]
    .map(([slug, members]) => ({
      slug,
      members,
      institution: institutions.find((i) => i.slug === slug),
    }))
    .sort((a, b) => (a.institution?.name ?? a.slug).localeCompare(b.institution?.name ?? b.slug));

  const roles = people
    .flatMap((p) => p.positions)
    .map((p) => p.title);

  return (
    <>
      <PageHeader
        eyebrow="Leadership"
        title="People currently recorded"
        description={`${people.length} people across ${byInstitution.size} of ${institutions.length} licensed institutions. These are current roles only — someone who has left is not listed, and an institution that publishes no leadership page is not listed either.`}
      />

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Stat term="People" value={String(people.length)} />
          <Stat term="Institutions covered" value={`${byInstitution.size} / ${institutions.length}`} />
          <Stat term="Distinct roles" value={String(new Set(roles).size)} />
          <Stat term="Unlisted institutions" value={String(withoutLeadership.length)} />
        </dl>

        {withoutLeadership.length > 0 ? (
          <p className="mt-4 rounded-md border border-flag-200 bg-flag-50 px-4 py-3 text-sm leading-relaxed text-flag-700">
            <span className="font-semibold">{withoutLeadership.length} licensed institutions publish no
              leadership page we could read.</span>{" "}
            They are missing from this list because the information was not found, not because they have no
            leadership.{" "}
            <Link href="/institutions" className="underline underline-offset-2">
              Browse all institutions
            </Link>
            .
          </p>
        ) : null}

        {groups.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No leadership published yet"
              detail="No institution in this snapshot has a leadership page we could read. Check back once source monitoring has covered more career and about pages."
            />
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {groups.map((group) => (
              <section key={group.slug} aria-labelledby={`inst-${group.slug}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mfi-200 pb-2">
                  <h2 id={`inst-${group.slug}`} className="text-base font-semibold tracking-tight text-mfi-900">
                    <Link
                      href={`/institutions/${group.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {group.institution?.name ?? group.slug}
                    </Link>
                  </h2>
                  <p className="text-xs text-mfi-500">
                    {group.members.length === 1 ? "1 person" : `${group.members.length} people`}
                    {group.institution?.headOffice ? ` · ${humanize(group.institution.headOffice)}` : ""}
                  </p>
                </div>

                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.members.map((person) => {
                    const position = person.positions.find((p) => p.is_current) ?? person.positions[0];
                    const status = verificationStatus(person.meta.verification_status);
                    const sources = sourceCount(person.meta.sources?.length ?? null);
                    return (
                      <li key={person.id} className="lk-card p-4">
                        <div className="flex items-start gap-3">
                          <span aria-hidden="true" className="lk-monogram shrink-0">
                            {initials(person.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/people/${person.slug}`}
                              className="text-sm font-semibold leading-snug text-mfi-900 underline-offset-4 hover:underline"
                            >
                              {person.name}
                            </Link>
                            <p className="mt-0.5 text-xs leading-relaxed text-mfi-600">
                              {position ? humanize(position.title) ?? "Role not stated" : "Role not stated"}
                              {position?.since
                                ? ` · since ${formatDate(position.since) ?? "an unrecorded date"}`
                                : ""}
                            </p>

                            {person.positions.length > 1 ? (
                              <ul className="mt-1.5 space-y-0.5">
                                {person.positions
                                  .filter((p) => p !== position)
                                  .map((p) => (
                                    <li key={`${p.title}-${p.since ?? ""}`} className="text-xs text-mfi-500">
                                      Also {humanize(p.title)?.toLowerCase() ?? "role not stated"}
                                    </li>
                                  ))}
                              </ul>
                            ) : null}

                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <StatusChip status={status} />
                              <Chip tone={sources.tone} dot={false}>
                                {sources.label}
                              </Chip>
                            </div>

                            {position && typeof position.shared_by === "number" && position.shared_by > 1 ? (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-flag-700">
                                {position.shared_by} people are listed in this role. The source lists them
                                together; we have not assumed why.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}

