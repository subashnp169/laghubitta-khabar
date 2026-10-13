// ============================================================================
// P0-2 — hard guard: no unresolved institution identity is published.
//
// This is the build-time gate behind P0-1. `docs/INSTITUTION-MASTER-MODEL.md:125`
// requires every cross-link to resolve to a canonical institution by canonical
// identity, and the data-truth rules forbid publishing internal pilot
// identifiers. `next build` itself never checks this, so an unresolved reference
// (or a leaked `hist-evt-…` / `evt-…` key) could ship silently.
//
// Run: npm run check:identity   (also wired as `prebuild`, so `npm run build`
// cannot publish a broken reference).
//
// Exits 1 with a list of findings on any violation; exits 0 with a summary
// otherwise. It is READ-ONLY and needs no database — the published modules are
// the source of truth for what the site can serve.
// ============================================================================
import { readFileSync } from "node:fs";

import {
  institutions,
  slugAliases,
  getInstitutionBySlug,
  getInstitutionSlugRedirect,
} from "../src/lib/site-data";
import { documentAssertions } from "../src/data/documents";
import { financialAssertions } from "../src/data/financials";
import { peopleAssertions } from "../src/data/people";
import { branchAssertions } from "../src/data/branches";
import { jobs } from "../src/data/jobs";
import { nrbRegulatoryEvents, nrbInstitutionLinks } from "../src/data/nrb";

const findings: string[] = [];
function fail(message: string): void {
  findings.push(message);
}

// --- 1. Canonical base is unique and every hub resolves ---------------------
const canonicalSlugs = new Set(institutions.map((i) => i.slug));
const canonicalIds = new Set(institutions.map((i) => i.id));
if (canonicalSlugs.size !== institutions.length) fail(`institution slugs are not unique (${institutions.length} rows, ${canonicalSlugs.size} slugs)`);
if (canonicalIds.size !== institutions.length) fail(`institution ids are not unique (${institutions.length} rows, ${canonicalIds.size} ids)`);
for (const inst of institutions) {
  if (getInstitutionBySlug(inst.slug)?.id !== inst.id) fail(`hub does not resolve: ${inst.id} (${inst.slug})`);
}

// --- 2. Alias register is coherent ------------------------------------------
const aliasByOld = new Map(slugAliases.map((a) => [a.old_slug, a.moved_to]));
for (const a of slugAliases) {
  if (!canonicalSlugs.has(a.moved_to)) fail(`alias target is not canonical: ${a.old_slug} -> ${a.moved_to}`);
  if (canonicalSlugs.has(a.old_slug)) fail(`alias old_slug collides with a live slug: ${a.old_slug}`);
  if (getInstitutionSlugRedirect(a.old_slug) !== a.moved_to) fail(`redirect helper does not route ${a.old_slug} -> ${a.moved_to}`);
}

// --- 3. Every published institution reference resolves ----------------------
const REF_KEYS = new Set(["institution_slug", "institutionSlug", "institution_id", "institutionId"]);
let refCount = 0;
function scanRefs(label: string, obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && REF_KEYS.has(k)) {
      refCount += 1;
      if (!canonicalSlugs.has(v) && !canonicalIds.has(v) && !aliasByOld.has(v)) {
        fail(`unresolved institution reference: ${label}.${k}=${v}`);
      }
      if (k.includes("slug") || k === "institutionSlug" || k === "institution_slug") {
        if (/^mfi-\d+$/.test(v)) fail(`id used where a slug belongs: ${label}.${k}=${v}`);
      }
    } else if (v && typeof v === "object") {
      scanRefs(label, v);
    }
  }
}
documentAssertions.forEach((r) => scanRefs("documents", r));
financialAssertions.forEach((r) => scanRefs("financials", r));
peopleAssertions.forEach((r) => scanRefs("people", r));
branchAssertions.forEach((r) => scanRefs("branches", r));
jobs.forEach((r) => scanRefs("jobs", r));
nrbRegulatoryEvents.forEach((r) => scanRefs("nrb-events", r));
nrbInstitutionLinks.forEach((r) => scanRefs("nrb-links", r));
if (refCount === 0) fail("no institution references found — the scan is not covering the published modules");

// --- 4. No internal pilot identifiers leak into published text --------------
// A reader-facing string must never carry an internal ledger key (`hist-evt-…`,
// `evt-…`) or an `Evidence: <non-url>` clause. This is what the generator's
// `sanitizeDescription` guarantees; the guard enforces it on the emitted module.
const INTERNAL_ID = /\b(?:hist-evt|evt)-[\w-]+/;
const BARE_EVIDENCE = /Evidence:\s*(?!https?:)\S+/;
let textCount = 0;
function scanText(label: string, obj: unknown): void {
  if (typeof obj === "string") {
    textCount += 1;
    if (INTERNAL_ID.test(obj)) fail(`internal identifier leaked into text: ${label} -> ${obj.slice(0, 80)}`);
    if (BARE_EVIDENCE.test(obj)) fail(`bare (non-URL) evidence reference leaked: ${label} -> ${obj.slice(0, 80)}`);
    return;
  }
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) scanText(`${label}.${k}`, v);
}
scanText("nrb-events", nrbRegulatoryEvents);
scanText("nrb-links", nrbInstitutionLinks);
scanText("documents", documentAssertions);
scanText("jobs", jobs);

// --- Report -----------------------------------------------------------------
const master = JSON.parse(readFileSync("data/master/canonical-slug-aliases.json", "utf8")) as { count: number };
if (slugAliases.length !== master.count) fail(`published alias count ${slugAliases.length} != master ${master.count}`);

if (findings.length > 0) {
  console.error(`identity guard: FAIL (${findings.length} finding${findings.length === 1 ? "" : "s"})`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `identity guard: OK — ${institutions.length} canonical institutions, ${slugAliases.length} slug aliases, ` +
    `${refCount} institution references resolved, ${textCount} published strings clean`,
);
