import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Contribute",
  description:
    "How to propose a correction or an addition to Laghubitta Khabar's records. Contributions go through GitHub; nothing is accepted without a source.",
};

export default function ContributePage() {
  return (
    <>
      <PageHeader eyebrow="Contribute" title="Propose a correction or an addition">
        <p className="max-w-2xl text-base leading-relaxed text-mfi-600">
          Laghubitta Khabar is a read-only record: there is no account, no login and no in-site edit button.
          Corrections and additions arrive as GitHub pull requests or issues, and every one must carry a source.
        </p>
      </PageHeader>

      <Container className="py-8 sm:py-10 space-y-8">
        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">What we accept</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-mfi-600">
            <li>A correction to a field we hold, with the source that shows the right value.</li>
            <li>A missing record we should include (a branch, a document, a vacancy), with the source.</li>
            <li>A new institution-level fact, with the source and the date it was observed.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">What we do not accept</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-mfi-600">
            <li>Unsourced claims, opinions or analysis.</li>
            <li>Brand assets (logos, colours) we cannot verify from the institution&apos;s own site.</li>
            <li>Anything that requires an account or a write endpoint on this site — there are none by design.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">How to submit</h2>
          <p className="mt-3 text-sm leading-relaxed text-mfi-600">
            Open an issue or a pull request on the project repository. Include the institution, the field, the
            proposed value, and the source URL plus the date you observed it. A maintainer reviews it against
            the evidence rules before anything is merged.
          </p>
          <p className="mt-3">
            <a
              href="https://github.com/subashnp169/laghubitta-khabar/issues/new"
              className="inline-flex items-center rounded-md border border-mfi-200 bg-white px-3 py-2 text-sm font-medium text-mfi-700 underline-offset-2 transition-colors hover:border-mfi-300 hover:bg-mfi-50"
              rel="noopener noreferrer"
              target="_blank"
            >
              Open a GitHub issue
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-mfi-900">Moderation</h2>
          <p className="mt-3 text-sm leading-relaxed text-mfi-600">
            Every contribution is reviewed before it reaches the published data. Conflicting sources are kept as
            disagreements, not silently resolved. Nothing is ever auto-published.
          </p>
        </section>

        <p className="text-xs leading-relaxed text-mfi-500">
          This is a read-only site by design (see docs/FROZEN-SPEC.md). Auth, sessions and an in-site write
          API are deliberately out of scope for V1.
        </p>
      </Container>
    </>
  );
}
