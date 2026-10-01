import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPerson } from "../../../../lib/api/repository";
import { allPublishedPeople } from "../../../../lib/repository/static-people";
import type { PersonDto } from "../../../../lib/repository/types";

const STATUS_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  CONFLICT: {
    label: "Conflict",
    cls: "bg-amber-50 text-amber-700",
    title: "Two independent sources disagree about this role. The person is listed; the attribution is not confirmed.",
  },
  UNVERIFIED: {
    label: "Unverified",
    cls: "bg-slate-100 text-slate-600",
    title: "Extracted from a source snapshot that has not been independently confirmed yet.",
  },
  AUTO_VERIFIED: {
    label: "Auto-verified",
    cls: "bg-blue-50 text-blue-700",
    title: "Matched automatically across sources.",
  },
  HUMAN_VERIFIED: {
    label: "Verified",
    cls: "bg-green-50 text-nrb-700",
    title: "Confirmed by a human reviewer.",
  },
};

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { label: status, cls: "bg-slate-100 text-slate-600", title: "" };
}

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
  return {
    title: `${person.name} — ${person.positions.map((x) => x.title).join(", ")} — Laghubitta Khabar`,
    description: `${person.name} at ${person.institution_slug.replace(/-/g, " ")}, extracted from source evidence.`,
  };
}

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const response = getPerson(slug);
  if (response.status !== 200 || !("data" in response.body)) notFound();
  const person = response.body.data as PersonDto;
  const badge = statusBadge(person.meta.verification_status);
  const corroboration =
    person.meta.sources.length > 1
      ? `Corroborated by ${person.meta.sources.length} independent sources.`
      : `Listed by a single source. No second source has confirmed this yet, so it stays ${badge.label.toLowerCase()}.`;

  return (
    <div className="max-w-[760px] mx-auto px-4 py-8">
      <div className="mb-4">
        <Link
          href={`/institutions/${person.institution_slug}`}
          className="text-xs text-mfi-600 hover:underline"
        >
          &larr; {person.institution_slug.replace(/-/g, " ")}
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h1 className="text-xl font-bold text-slate-800">{person.name}</h1>
          <span
            title={badge.title}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
        <p className="text-sm text-slate-500">{roleLabels(person)}</p>
        <Link
          href={`/institutions/${person.institution_slug}`}
          className="text-xs text-mfi-600 hover:underline"
        >
          View the full profile &rarr;
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="font-bold text-sm text-slate-700 mb-3">Roles</h2>
        <ul className="divide-y divide-slate-100">
          {person.positions.map((pos) => (
            <li key={pos.title} className="py-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm text-slate-800">{pos.title}</span>
              {pos.shared_by > 1 && (
                <span
                  title="This source lists more than one person under this role. We publish every name it gave; we do not know which the source intends."
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                >
                  {pos.shared_by} listed
                </span>
              )}
              <span className="text-[10px] text-slate-400">
                {pos.since ? `since ${pos.since.slice(0, 10)}` : "date unknown"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="font-bold text-sm text-slate-700 mb-3">Provenance</h2>
        <dl className="space-y-1.5 text-xs">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500 min-w-[110px]">Source</dt>
            <dd className="text-slate-800">{person.meta.source}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500 min-w-[110px]">Source URL</dt>
            <dd>
              {person.meta.source_url ? (
                <a
                  href={person.meta.source_url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-mfi-600 hover:underline break-all"
                >
                  {person.meta.source_url}
                </a>
              ) : (
                <span className="text-slate-400">not recorded for this source</span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500 min-w-[110px]">Last seen</dt>
            <dd className="text-slate-800">
              {person.meta.last_verified_at
                ? person.meta.last_verified_at.slice(0, 10)
                : "unknown"}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500 min-w-[110px]">Status</dt>
            <dd className="text-slate-800">{person.meta.verification_status}</dd>
          </div>
        </dl>
        <p className="text-[10px] text-slate-400 mt-3">{corroboration}</p>
      </div>
    </div>
  );
}
