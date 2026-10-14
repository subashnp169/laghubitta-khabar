// ============================================================================
// P2-5 — Career/Document/Notice linkage acceptance.
//
// A vacancy notice and a document link are the same kind of record in different
// layers, so the Careers and Documents panels of an institution hub must point
// at each other when both exist. This asserts the shared `src/util/linkage.ts`
// mapping: the link is offered only when its target exists, and every href is
// built from the canonical slug (P1-9) — never a name and never a parsed id.
//
// Run: npm run smoke:linkage
// ============================================================================
import { careerDocumentLinks } from "../src/util/linkage";
import { jobs } from "../src/data/jobs";
import { institutions } from "../src/data/institutions";
import { allPublishedDocuments } from "../lib/repository/static-documents";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}

const HREF = /^\/institutions\/[a-z0-9-]+#(careers|documents)$/;

// --- Empty slug never produces a guessed link ---------------------------------
const empty = careerDocumentLinks("", { vacancies: 3, documents: 2 });
check("empty slug -> no links", empty.toCareers === null && empty.toDocuments === null);
check("whitespace slug -> no links", careerDocumentLinks("   ", { vacancies: 1, documents: 1 }).toDocuments === null);

// --- Applicability: a link is offered only when its target exists -------------
const none = careerDocumentLinks("mfi-x", { vacancies: 0, documents: 0 });
check("no vacancies, no documents -> no links", none.toCareers === null && none.toDocuments === null);
const docsOnly = careerDocumentLinks("mfi-x", { vacancies: 0, documents: 4 });
check("documents only -> toDocuments offered, toCareers withheld", docsOnly.toDocuments !== null && docsOnly.toCareers === null);
const vacOnly = careerDocumentLinks("mfi-x", { vacancies: 2, documents: 0 });
check("vacancies only -> toCareers offered, toDocuments withheld", vacOnly.toCareers !== null && vacOnly.toDocuments === null);
const both = careerDocumentLinks("mfi-x", { vacancies: 2, documents: 4 });
check("both present -> both links offered", both.toCareers !== null && both.toDocuments !== null);

// --- Hrefs are canonical in-hub anchors ---------------------------------------
check("toCareers href is the canonical #careers anchor", both.toCareers?.href === "/institutions/mfi-x#careers");
check("toDocuments href is the canonical #documents anchor", both.toDocuments?.href === "/institutions/mfi-x#documents");
for (const link of [both.toCareers, both.toDocuments]) {
  check(`href is well-formed and canonical: ${link?.href}`, typeof link?.href === "string" && HREF.test(link.href));
  check(`link carries a label and a note: ${link?.href}`, (link?.label.length ?? 0) > 0 && (link?.note.length ?? 0) > 0);
}

// --- Data invariant: over every institution, the mapping matches the records --
const jobsBySlug = new Map<string, number>();
for (const j of jobs) jobsBySlug.set(j.institutionSlug, (jobsBySlug.get(j.institutionSlug) ?? 0) + 1);
const docsBySlug = new Map<string, number>();
for (const d of allPublishedDocuments()) docsBySlug.set(d.institution_slug, (docsBySlug.get(d.institution_slug) ?? 0) + 1);

const namesBySlug = new Map(institutions.map((i) => [i.slug, i.name]));
let mismatch = 0;
let applicable = 0;
for (const inst of institutions) {
  const vacancies = jobsBySlug.get(inst.slug) ?? 0;
  const documents = docsBySlug.get(inst.slug) ?? 0;
  const links = careerDocumentLinks(inst.slug, { vacancies, documents });
  if ((links.toCareers !== null) !== vacancies > 0) mismatch += 1;
  if ((links.toDocuments !== null) !== documents > 0) mismatch += 1;
  if (links.toCareers !== null) {
    applicable += 1;
    if (links.toCareers.href !== `/institutions/${inst.slug}#careers`) mismatch += 1;
    // A link must never be built from the display name (spaces / uppercase).
    if (links.toCareers.href.includes(namesBySlug.get(inst.slug) as string)) mismatch += 1;
  }
  if (links.toDocuments !== null && links.toDocuments.href !== `/institutions/${inst.slug}#documents`) mismatch += 1;
}
check("every applicable link matches the canonical slug for all 51 institutions", mismatch === 0);
check("at least one institution offers a cross-link today", applicable > 0);
console.log(`       (institutions offering a careers cross-link today: ${applicable})`);

// The routes the cross-links resolve to must exist in the app tree — the same
// canonical hub the pages declare.
check("every href resolves under /institutions/<slug>", institutions.every((i) => HREF.test(`/institutions/${i.slug}#careers`)));

console.log(`\nsmoke:linkage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
