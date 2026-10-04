import Link from "next/link";
import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui/Section";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { jobs, jobsProvenance } from "@/data/jobs";
import { institutions } from "@/data/institutions";
import { displayHost, formatDate, humanize, realUrl } from "@/util/format";
import type { Job } from "@/data/jobs";
import { Stat } from "@/components/ui/Stat";

/**
 * Vacancies.
 *
 * Two record kinds live here and the distinction is load-bearing:
 *
 *  - `POSTING` — the institution's page was fetched and a posting was parsed out
 *    of the text. There is one of these in the current dataset.
 *  - `DOCUMENT` — the institution's career page links a notice (usually a PDF)
 *    that we recorded but did not read. There are 36 of these.
 *
 * The previous version of this page claimed no institution's site had ever
 * yielded a readable posting, which the data contradicts. It also rendered
 * postings and unread notices through the same visual treatment, so a reader
 * could not tell which of the 37 rows was actually parsed.
 */

export const metadata: Metadata = {
  title: "Vacancies",
  description:
    "Vacancy postings and notices located on microfinance institutions' own websites. Parsed postings and unread document links are shown separately.",
};

const POSTINGS = jobs.filter((j) => j.kind === "POSTING");
const NOTICES = jobs.filter((j) => j.kind === "DOCUMENT");

const slugByName = new Map(institutions.map((i) => [i.name, i.slug]));

export default function JobsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Vacancies"
        title="Vacancies institutions have posted"
      >
        <p className="max-w-3xl text-base leading-relaxed text-mfi-600">
          {jobs.length} records from institution career pages. Only{" "}
          <span className="font-medium text-mfi-900">{POSTINGS.length}</span> of these is a posting we could
          read and parse; the other {NOTICES.length} are notice links we recorded without opening them.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mfi-200 bg-mfi-200 sm:grid-cols-4">
          <Stat term="Records" value={String(jobs.length)} />
          <Stat term="Parsed postings" value={String(POSTINGS.length)} tone="info" />
          <Stat term="Unread notices" value={String(NOTICES.length)} tone="attention" />
          <Stat term="Institutions" value={String(new Set(jobs.map((j) => j.institution)).size)} />
        </dl>

        <section aria-labelledby="postings-heading" className="mt-10">
          <h2 id="postings-heading" className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
            Parsed postings
          </h2>
          <p className="mt-1 text-xs text-mfi-500">
            Read from the institution&apos;s own page. Title, location and type come from the posting text.
          </p>

          {POSTINGS.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No posting could be parsed"
                detail="Institutions often publish vacancies through an external job portal, or build the list in the browser after load. Neither can be read as evidence without scraping a third party or running JavaScript, so neither is used."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {POSTINGS.map((job) => (
                <li key={job.id} className="lk-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold leading-snug text-mfi-900">{job.title}</h3>
                      <p className="mt-1 text-sm text-mfi-600">
                        <InstitutionLink name={job.institution} />
                      </p>
                    </div>
                    <Chip tone="info">parsed from page</Chip>
                  </div>

                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <Detail term="Location" value={humanize(job.location)} />
                    <Detail term="Type" value={humanize(job.type)} />
                    <Detail term="Deadline" value={formatDate(job.deadline)} />
                    <Detail term="Last seen" value={formatDate(job.lastSeenAt)} />
                  </dl>

                  {job.description ? (
                    <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-mfi-600">
                      {humanize(job.description)}
                    </p>
                  ) : null}

                  <JobSourceLink job={job} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="notices-heading" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-mfi-200 pb-2">
            <h2 id="notices-heading" className="text-base font-semibold tracking-tight text-mfi-900">
              Unread notices
            </h2>
            <span className="font-mono text-xs text-mfi-500">{NOTICES.length}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-mfi-500">
            Notice links found on career pages. The documents themselves have not been opened, so no role,
            location or deadline below comes from reading them — the titles are filenames recorded from the
            page.
          </p>

          {NOTICES.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No unread notices"
                detail="No institution career page linked a notice we could record."
              />
            </div>
          ) : (
            <ul className="lk-card lk-divide mt-4 overflow-hidden">
              {NOTICES.map((job) => (
                <li key={job.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 flex-1 break-words text-sm text-mfi-900">{job.title}</span>
                    <span className="shrink-0 text-xs text-mfi-500">
                      {formatDate(job.lastSeenAt) ?? "date not recorded"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mfi-600">
                    <InstitutionLink name={job.institution} />
                    {realUrl(job.sourceDocument) ? (
                      <a
                        href={job.sourceDocument as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-mfi-700 underline-offset-4 hover:underline"
                      >
                        {displayHost(job.sourceDocument)} ↗
                      </a>
                    ) : (
                      <Chip tone="neutral">no link</Chip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-xs leading-relaxed text-mfi-500">{jobsProvenance}.</p>
      </Container>
    </>
  );
}


function Detail({ term, value }: { term: string; value: string | null }) {
  return (
    <div>
      <dt className="text-mfi-500">{term}</dt>
      <dd className={value ? "mt-0.5 font-medium text-mfi-800" : "mt-0.5 text-flag-700"}>
        {value ?? "Not stated"}
      </dd>
    </div>
  );
}

function InstitutionLink({ name }: { name: string }) {
  const slug = slugByName.get(name);
  if (!slug) return <>{name}</>;
  return (
    <Link href={`/institutions/${slug}`} className="underline-offset-4 hover:underline">
      {name}
    </Link>
  );
}

/** Links the source page a posting or notice was recorded from. */
function JobSourceLink({ job }: { job: Job }) {
  const url = realUrl(job.sourceDocument);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex text-xs font-medium text-mfi-700 underline-offset-4 hover:underline"
    >
      {displayHost(job.sourceDocument) ?? "Source"} ↗
    </a>
  );
}
