// ============================================================================
// Phase 3 (M3.1) — B2B API acceptance. Tests the pure handler/router over the
// real generated modules (deterministic offline — no sockets, no network):
//   01 collection envelope + pagination defaults/clamps
//   02 filters: ?q= by name/alias, ?province=, ?status=
//   03 single resource + 404 error envelope + UNVERIFIED meta
//   04 sub-resources: documents (NRB-linked), events, jobs (evidence-keyed slug)
//   05 empty Phase B/C collections (honest total: 0)
//   06 search grouped + validation (missing q → 422), method guard (405)
//   07 vacancies are evidence-derived: the module is generated, every row names
//      its source, and no institution can be credited with a vacancy not keyed to it
// ============================================================================

// Fixture-only test harness reading JSON with unchecked shape access.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleApiRequest } from "../lib/api/handler";
import { parsePagination } from "../lib/api/contract";
import { institutions } from "../src/data/institutions";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

function request(method: string, url: string): { status: number; body: Record<string, any> } {
  const out = handleApiRequest({ method, url });
  return { status: out.status, body: JSON.parse(out.body) as Record<string, any> };
}

// 01 pagination primitives
console.log("smoke:api — pagination");
ok(parsePagination(new URLSearchParams("")).page === 1 && parsePagination(new URLSearchParams("")).limit === 20, "defaults page=1 limit=20");
ok(parsePagination(new URLSearchParams("limit=5&page=3")).page === 3 && parsePagination(new URLSearchParams("limit=5&page=3")).offset === 10, "page/offset math");
ok(parsePagination(new URLSearchParams("limit=999")).limit === 100, "limit clamped to max 100");
ok(parsePagination(new URLSearchParams("page=abc&limit=limit")).page === 1 && parsePagination(new URLSearchParams("page=abc&limit=limit")).limit === 20, "junk params fall back");

// 02 institutions list
console.log("smoke:api — /api/institutions");
const list = request("GET", "/api/institutions");
ok(list.status === 200 && Array.isArray(list.body.data), "list returns collection");
ok(list.body.pagination.total === institutions.length, "list total matches master data");
ok(list.body.data.length === Math.min(20, institutions.length), "default limit 20");
const first = list.body.data[0] as Record<string, any>;
ok(typeof first.paid_up_capital_crore === "number" && Array.isArray(first.aliases), "summary shape");
const limited = request("GET", "/api/institutions?limit=5&page=2");
ok(limited.body.data.length === 5 && limited.body.pagination.page === 2, "limit/page honored");
const byQ = request("GET", "/api/institutions?q=sana%20kisan");
ok(byQ.body.data.length === 1 && byQ.body.data[0].slug.includes("sana-kisan"), "search by name");
const byAlias = request("GET", "/api/institutions?q=infinity");
ok(byAlias.body.data.some((s: any) => s.slug.includes("infinity")), "search matches alias");
const byProvince = request("GET", "/api/institutions?province=kavrepalanchowk");
ok(byProvince.body.data.length > 0 && byProvince.body.data.every((s: any) => /kavrepalanchowk/i.test(`${s.head_office} ${s.working_area}`)), "province filter");
const byStatus = request("GET", "/api/institutions?status=verified");
ok(byStatus.body.data.length > 0 && byStatus.body.data.every((s: any) => s.website_status === "verified"), "website status filter");

// 03 single resource
console.log("smoke:api — /api/institutions/:slug");
const slug = institutions[0].slug;
const detail = request("GET", `/api/institutions/${slug}`);
ok(detail.status === 200 && detail.body.data.slug === slug, "detail resolves");
ok(detail.body.meta.verification_status === "UNVERIFIED", "meta honest UNVERIFIED");
ok(typeof detail.body.data.cadence.minutes === "number" && typeof detail.body.data.sourced_evidence === "object" && detail.body.data.sourced_evidence !== null, "detail full shape");
const missing = request("GET", `/api/institutions/no-such-slug`);
ok(missing.status === 404 && missing.body.error.code === "NOT_FOUND", "404 error envelope");

// 04 sub-resources
console.log("smoke:api — sub-resources");
const docs = request("GET", `/api/institutions/${slug}/documents`);
ok(docs.status === 200 && Array.isArray(docs.body.data), "documents collection");
const evts = request("GET", `/api/institutions/${slug}/events`);
ok(evts.status === 200 && evts.body.data.every((e: any) => e.institutionSlug === slug), "events only for institution");
const jobbed = request("GET", `/api/institutions/${slug}/jobs`);
ok(jobbed.status === 200 && Array.isArray(jobbed.body.data), "jobs collection");

// 05 honest empties
console.log("smoke:api — honest empties");
for (const leaf of ["branches", "financials"]) {
  const r = request("GET", `/api/institutions/${slug}/${leaf}`);
  ok(r.status === 200 && r.body.data.length === 0 && r.body.pagination.total === 0, `${leaf} empty until phase populated`);
}
const rates = request("GET", "/api/interest-rates");
ok(rates.status === 200 && rates.body.pagination.total === 0, "interest-rates empty until Phase C");

// 05b Phase M3.3 leadership is served from the same evidence read model
console.log("smoke:api — M3.3 leadership + person routes");
const leadership = request("GET", `/api/institutions/${slug}/leadership`);
ok(leadership.status === 200 && Array.isArray(leadership.body.data), "leadership is a real collection (not an empty-phase stub)");
ok(
  leadership.body.pagination.total === leadership.body.data.length &&
    leadership.body.data.every((p: any) => p.institutionSlug === slug && p.id.startsWith("person-") && typeof p.slug === "string" && Array.isArray(p.positions)),
  "leadership items are PersonDto with institution scoping + deterministic id/slug",
);
ok(
  leadership.body.data.every((p: any) => ["UNVERIFIED", "HUMAN_VERIFIED", "AUTO_VERIFIED", "CONFLICT"].includes(p.meta.verification_status) && typeof p.meta.source_id === "string"),
  "every person carries an honest verification status + source",
);
const paginated = request("GET", `/api/institutions/${slug}/leadership?limit=1`);
ok(
  paginated.status === 200 && paginated.body.data.length <= 1 && paginated.body.pagination.limit === 1,
  "leadership honours pagination",
);
const knownSlug = leadership.body.data[0]?.slug;
if (knownSlug) {
  const person = request("GET", `/api/people/${knownSlug}`);
  ok(person.status === 200 && person.body.data.slug === knownSlug, "person detail resolves by slug");
  ok(person.body.meta?.resource === `people:${knownSlug}`, "person detail carries resource meta");
} else {
  const person = request("GET", "/api/people/nobody-here");
  ok(person.status === 404 && person.body.error.code === "NOT_FOUND", "unknown person → 404");
}
const missingPerson = request("GET", "/api/people/definitely-not-a-person");
ok(missingPerson.status === 404 && missingPerson.body.error.code === "NOT_FOUND", "unknown person → 404");

// 06 search + guard
console.log("smoke:api — search + guard");
const found = request("GET", "/api/search?q=nirdhan");
ok(found.status === 200 && found.body.data.groups?.institutions.length >= 1, "search groups institutions");
ok(found.body.data.query === "nirdhan", "search echoes query");
ok(Array.isArray(found.body.data.groups?.people), "search exposes a people group");
const peopleQ = request("GET", "/api/search?q=zzzz-no-such-person");
ok(peopleQ.status === 200 && peopleQ.body.data.groups.people.length === 0, "people search miss → empty group, never an error");
const noQ = request("GET", "/api/search");
ok(noQ.status === 422 && noQ.body.error.code === "VALIDATION", "search without q → 422");
const post = request("POST", "/api/institutions");
ok(post.status === 405 && post.body.error.code === "METHOD_NOT_ALLOWED", "only GET supported");
const bad = request("GET", "/api/not-a-route");
ok(bad.status === 404 && bad.body.error.code === "NOT_FOUND", "unknown route → 404");

// 07 vacancies are evidence, never content
console.log("smoke:api — vacancies come from evidence only");
const jobsSource = readFileSync(join(__dirname, "..", "src", "data", "jobs.ts"), "utf8");
ok(
  jobsSource.includes("GENERATED FILE"),
  "src/data/jobs.ts declares itself generated, so a hand-written row is visible in review",
);
ok(
  !/title:\s*"(?:Branch Manager|Credit Officer|Risk Manager|Internal Auditor|IT Officer|Relationship Manager|Compliance Officer|Microfinance Trainer|Data Analyst)"/.test(jobsSource),
  "no hand-written vacancy titles survive in the jobs module",
);
// Whatever the module holds, every row must carry the provenance fields the
// generator writes. A row without them came from somewhere other than evidence. The
// counts are taken from the array body only, so the `Job` interface above it — which
// also mentions these field names — cannot satisfy the check on its own.
const jobsBody = (jobsSource.match(/export const jobs: Job\[\] = \[([\s\S]*?)\];/) ?? ["", ""])[1];
const rowCount = jobsBody.split(/\n {2}\{/).filter((s) => s.trim().length > 0).length;
ok(rowCount === (jobsBody.match(/^ {4}id: /gm) ?? []).length, "every job row in the module is counted the same way");
ok((jobsBody.match(/sourceName: /g) ?? []).length === rowCount, "every job row names the source it was observed from");
ok((jobsBody.match(/lastSeenAt: /g) ?? []).length === rowCount, "every job row records when it was last seen");
ok((jobsBody.match(/status: /g) ?? []).length === rowCount, "every job row carries a lifecycle status");
ok(
  !/institution: "(?!.*not observed)/.test(jobsBody) || rowCount === 0,
  "an institution name is either observed from the source or explicitly marked unobserved",
);
let jobsEmpty = true;
for (const inst of institutions) {
  const r = request("GET", `/api/institutions/${inst.slug}/jobs`);
  if (r.status !== 200) {
    ok(false, `institution jobs route for ${inst.slug} returns 200`);
    jobsEmpty = false;
    break;
  }
  // An institution with no evidence behind it must report no vacancies. The old
  // implementation matched jobs to institutions by name prefix, which is how ten
  // invented postings were attributed to named MFIs.
  const rows = r.body.data as { slug?: string }[];
  if (rows.some((row) => !row.slug || !row.slug.startsWith(`${inst.slug}-`))) {
    ok(false, `every job returned for ${inst.slug} is keyed to that institution's slug`);
    jobsEmpty = false;
    break;
  }
}
ok(jobsEmpty, `no institution returns a vacancy that is not keyed to its own slug (${institutions.length} checked)`);
const unknownJobs = request("GET", "/api/institutions/definitely-not-an-mfi/jobs");
ok(
  unknownJobs.status === 404 && unknownJobs.body.error.code === "NOT_FOUND",
  "unknown institution jobs route → 404",
);

console.log(`\nsmoke:api: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);