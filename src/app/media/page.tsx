import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { videos, posts, digitalServices, mediaProvenance } from "@/lib/site-data";
import { institutionHrefForSlug } from "@/util/institution-profile";
import { isR2Configured, R2_STATUS_NOTE } from "../../../lib/storage/r2";

export const metadata: Metadata = {
  title: "Media & activity",
  description:
    "Videos, posts and digital services recorded for Nepal's microfinance institutions. Empty today because no media has been ingested; nothing is fabricated.",
};

export default function MediaPage() {
  return (
    <>
      <PageHeader eyebrow="Media" title="Media & activity">
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Videos, posts and digital services recorded for Nepal&apos;s microfinance institutions. Every row
          here comes from an ingested source; where nothing has been ingested the section says so rather than
          showing a placeholder.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10 space-y-10">
        <Section
          title="Videos"
          count={videos.length}
          empty="No videos recorded. The durable store holds 0 video rows, so nothing is shown here."
        >
          {videos.map((v) => (
            <li key={v.id} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{v.title}</p>
              <p className="mt-0.5 text-xs text-mfi-500">
                {v.videoType}
                {v.institutionSlug ? (
                  <>
                    {" · "}
                    <Link
                      href={institutionHrefForSlug(v.institutionSlug) ?? "#"}
                      className="font-medium text-mfi-700 underline underline-offset-2"
                    >
                      {v.institutionSlug}
                    </Link>
                  </>
                ) : null}
                {v.publishedAt ? ` · ${v.publishedAt}` : null}
              </p>
              {v.embedUrl ? (
                <a href={v.embedUrl} className="mt-1 inline-block text-xs font-medium text-mfi-700 underline underline-offset-2">
                  Open video
                </a>
              ) : null}
            </li>
          ))}
        </Section>

        <Section
          title="Posts"
          count={posts.length}
          empty="No posts published. The durable store holds 0 post rows, so nothing is shown here."
        >
          {posts.map((p) => (
            <li key={p.id} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{p.title}</p>
              <p className="mt-0.5 text-xs text-mfi-500">
                {p.postKind}
                {p.institutionSlug ? ` · ${p.institutionSlug}` : ""}
                {` · ${p.publishedAt}`}
              </p>
              {p.excerpt ? <p className="mt-1 text-xs leading-relaxed text-mfi-600">{p.excerpt}</p> : null}
              {p.url ? (
                <a href={p.url} className="mt-1 inline-block text-xs font-medium text-mfi-700 underline underline-offset-2">
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </Section>

        <Section
          title="Digital services"
          count={digitalServices.length}
          empty="No digital services recorded. The durable store holds 0 digital-service rows, so nothing is shown here."
        >
          {digitalServices.map((d) => (
            <li key={d.id} className="px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-mfi-900">{d.name}</p>
              <p className="mt-0.5 text-xs text-mfi-500">
                {d.serviceType}
                {d.institutionSlug ? ` · ${d.institutionSlug}` : ""}
                {` · ${d.status}`}
              </p>
              {d.url ? (
                <a href={d.url} className="mt-1 inline-block text-xs font-medium text-mfi-700 underline underline-offset-2">
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </Section>

        {!isR2Configured() ? (
          <p className="text-xs leading-relaxed text-mfi-500">{R2_STATUS_NOTE}</p>
        ) : null}
        <p className="text-xs leading-relaxed text-mfi-500">{mediaProvenance}</p>
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
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="border-b border-mfi-200 pb-2 text-base font-semibold tracking-tight text-mfi-900">
        {title} <span className="text-sm font-normal text-mfi-500">({count})</span>
      </h2>
      {count === 0 ? (
        <div className="mt-3">
          <EmptyState title={empty} />
        </div>
      ) : (
        <ul className="lk-card lk-divide mt-3 overflow-hidden">{children}</ul>
      )}
    </section>
  );
}
