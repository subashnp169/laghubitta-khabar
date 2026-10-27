import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { officialWebsites, socialAccounts, digitalProvenance } from "@/lib/site-data";
import { institutionHrefForSlug } from "@/util/institution-profile";

export const metadata: Metadata = {
  title: "Digital presence",
  description:
    "Official websites and social accounts recorded for Nepal's microfinance institutions. Websites are shown only with their verified or candidate status; social accounts are empty today.",
};

export default function DigitalPage() {
  const verified = officialWebsites.filter((w) => w.status === "verified");
  const candidate = officialWebsites.filter((w) => w.status !== "verified");

  return (
    <>
      <PageHeader eyebrow="Digital" title="Digital presence">
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Official websites and social accounts recorded for Nepal&apos;s microfinance institutions. A website is
          shown with its verified or candidate status; a candidate URL is a lead, not a confirmed address. No
          logos, colours or brand assets are guessed — they are never shown.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10 space-y-10">
        <Section title="Verified official websites" count={verified.length}>
          {verified.map((w) => (
            <li key={w.institutionId} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{w.institutionName}</p>
              <a href={w.url} className="mt-0.5 inline-block text-xs font-medium text-mfi-700 underline underline-offset-2">
                {w.url}
              </a>
            </li>
          ))}
        </Section>

        <Section title="Candidate (unconfirmed) websites" count={candidate.length}>
          {candidate.map((w) => (
            <li key={w.institutionId} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{w.institutionName}</p>
              <p className="mt-0.5 text-xs text-mfi-500">{w.url} — unconfirmed</p>
            </li>
          ))}
        </Section>

        <Section title="Social accounts" count={socialAccounts.length} empty="No social accounts recorded. The durable store holds 0 social_accounts rows, so none are shown.">
          {socialAccounts.map((s) => (
            <li key={s.id} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{s.platform}</p>
              {s.url ? (
                <a href={s.url} className="mt-0.5 inline-block text-xs font-medium text-mfi-700 underline underline-offset-2">
                  {s.url}
                </a>
              ) : null}
            </li>
          ))}
        </Section>

        <p className="text-xs leading-relaxed text-mfi-500">{digitalProvenance}</p>
      </Container>
    </>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
        {title} <span className="text-sm font-normal text-mfi-500">({count})</span>
      </h2>
      {count === 0 ? (
        <div className="mt-3">
          <EmptyState title={empty ?? `No ${title.toLowerCase()} recorded.`} />
        </div>
      ) : (
        <ul className="lk-card lk-divide mt-3 overflow-hidden">{children}</ul>
      )}
    </section>
  );
}
