import Link from "next/link";
import type { Institution } from "@/types";
import { Chip } from "@/components/ui/Chip";
import { formatCrore, humanize, initials } from "@/util/format";
import { institutionStatus, isVerifiedWebsite, websiteStatus } from "@/util/evidence";

/**
 * Directory card.
 *
 * Shows only fields the NRB directory actually publishes for every institution.
 * A website is never linked from this card: it states the confirmation state and
 * leaves the link to the profile, so a candidate site can never be mistaken for
 * an official one. Brand assets are never shown — the governing model forbids
 * guessing logos or colours, and none are verified.
 */
export default function InstitutionCard({ institution }: { institution: Institution }) {
  const headOffice = humanize(institution.headOffice);
  const capital = formatCrore(institution.paidUpCapitalCrore);
  const website = institution.officialWebsite;

  return (
    <li>
      <Link
        href={`/institutions/${institution.slug}`}
        className="lk-card flex h-full flex-col p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mfi-700"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="lk-monogram shrink-0">
            {initials(institution.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold leading-snug text-mfi-900">{institution.name}</h2>
            <p className="mt-1 text-xs text-mfi-600">
              {headOffice ?? <span className="text-mfi-400">Head office not stated</span>}
            </p>
          </div>
        </div>

        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-mfi-500">Working area</dt>
            <dd className="truncate text-right font-medium text-mfi-800">
              {humanize(institution.workingArea) ?? "Not stated"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-mfi-500">Paid-up capital</dt>
            <dd className="shrink-0 text-right font-mono tabular-nums font-medium text-mfi-800">
              {capital ?? "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-mfi-100 pt-3">
          <Chip
            tone={institutionStatus(institution.licenseStatus).tone}
            title={institutionStatus(institution.licenseStatus).help}
          >
            {institutionStatus(institution.licenseStatus).label}
          </Chip>
          {institution.coverageType ? (
            <Chip tone="neutral">{humanize(institution.coverageType)}</Chip>
          ) : null}
          {website ? (
            <Chip
              tone={websiteStatus(institution.websiteStatus).tone}
              title={isVerifiedWebsite(institution.websiteStatus) ? websiteStatus(institution.websiteStatus).help : "A candidate website recorded by the directory, not yet confirmed as the institution's official site."}
            >
              {websiteStatus(institution.websiteStatus).label}
            </Chip>
          ) : (
            <Chip tone="neutral">no confirmed website</Chip>
          )}
        </div>
      </Link>
    </li>
  );
}
