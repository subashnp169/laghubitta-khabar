// ============================================================================
// P1-9 — canonical hub completeness acceptance tests.
//
// `docs/INSTITUTION-MASTER-MODEL.md:125` requires every cross-link
// (People→Institution, News→Institution, Documents→Institution, Jobs→Institution,
// Financials→Institution, NRB events→Institution, Research→Institution) to resolve
// to the canonical `/institutions/[slug]` hub by canonical identity — no page-local
// mapping and no dangling reference.
//
// These assert the invariant over the generated (not hand-written) public layer:
// every institution reference in every published module resolves to a canonical
// slug or id, and the published slug-alias register stays consistent with the
// master register and the redirect helper.
//
// Run: npm run smoke:canonical-links
// ============================================================================
import { readFileSync } from "node:fs";

import {
  institutions,
  slugAliases,
  getInstitutionBySlug,
  getInstitutionSlugRedirect,
} from "../src/lib/site-data";
import { institutionHrefForId, institutionHrefForSlug } from "../src/util/institution-profile";
import { documentAssertions } from "../src/data/documents";
import { financialAssertions } from "../src/data/financials";
import { peopleAssertions } from "../src/data/people";
import { branchAssertions } from "../src/data/branches";
import { jobs } from "../src/data/jobs";
import { nrbRegulatoryEvents, nrbInstitutionLinks } from "../src/data/nrb";

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

const canonicalSlugs = new Set(institutions.map((i) => i.slug));
const canonicalIds = new Set(institutions.map((i) => i.id));
const aliasByOld = new Map(slugAliases.map((a) => [a.old_slug, a.moved_to]));

// --- 1. Canonical base is unique -------------------------------------------
check("51 canonical institutions", institutions.length === 51);
check("slugs unique", canonicalSlugs.size === institutions.length);
check("ids unique", canonicalIds.size === institutions.length);
for (const inst of institutions) {
  check(`hub resolves: ${inst.id}`, getInstitutionBySlug(inst.slug)?.id === inst.id);
}

// --- 2. Every cross-link reference resolves to a canonical entity -----------
const REF_KEYS = new Set(["institution_slug", "institutionSlug", "institution_id", "institutionId"]);
const unresolved: string[] = [];
let refCount = 0;
function scan(label: string, obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && REF_KEYS.has(k)) {
      refCount += 1;
      const ok = canonicalSlugs.has(v) || canonicalIds.has(v) || aliasByOld.has(v);
      if (!ok) unresolved.push(`${label}.${k}=${v}`);
    } else if (v && typeof v === "object") {
      scan(label, v);
    }
  }
}
documentAssertions.forEach((r) => scan("documents", r));
financialAssertions.forEach((r) => scan("financials", r));
peopleAssertions.forEach((r) => scan("people", r));
branchAssertions.forEach((r) => scan("branches", r));
jobs.forEach((r) => scan("jobs", r));
nrbRegulatoryEvents.forEach((r) => scan("nrb-events", r));
nrbInstitutionLinks.forEach((r) => scan("nrb-links", r));

check("cross-link references found", refCount > 0);
check("every cross-link resolves to canonical identity", unresolved.length === 0);
check("no cross-link holds a superseded slug", [...new Set(unresolved)].every((u) => !aliasByOld.has(u.split("=")[1])));

// --- 3. Published alias register matches the master register ----------------
const master = JSON.parse(readFileSync("data/master/canonical-slug-aliases.json", "utf8")) as {
  count: number;
  rows: { old_slug: string; moved_to: string; institution_id: string }[];
};
check("published alias count matches master", slugAliases.length === master.count);
check("published alias count matches rows", slugAliases.length === master.rows.length);
const masterByOld = new Map(master.rows.map((r) => [r.old_slug, r.moved_to]));
check(
  "published aliases equal master aliases",
  slugAliases.every((a) => masterByOld.get(a.old_slug) === a.moved_to),
);
for (const a of slugAliases) {
  check(`alias target is canonical: ${a.old_slug}`, canonicalSlugs.has(a.moved_to));
  check(`alias old_slug is not a live slug: ${a.old_slug}`, !canonicalSlugs.has(a.old_slug));
  check(`redirect helper routes ${a.old_slug}`, getInstitutionSlugRedirect(a.old_slug) === a.moved_to);
}
check("canonical slug has no redirect", getInstitutionSlugRedirect(institutions[0].slug) === undefined);
check("unknown slug has no redirect", getInstitutionSlugRedirect("not-a-real-slug") === undefined);

// --- 4. The link helper only emits canonical hubs ---------------------------
check("helper builds canonical href from slug", institutionHrefForSlug(institutions[0].slug) === `/institutions/${institutions[0].slug}`);
check("helper builds canonical href from id", institutionHrefForId(institutions[0].id) === `/institutions/${institutions[0].slug}`);
check("helper omits unknown slug", institutionHrefForSlug("not-a-real-slug") === null);
check("helper omits unknown id", institutionHrefForId("mfi-999") === null);
check("helper omits empty slug", institutionHrefForSlug("") === null);
check("helper omits null id", institutionHrefForId(null) === null);

// A superseded slug resolves to its canonical hub, not a dropped link.
const sample = slugAliases[0];
check(
  "helper resolves superseded slug to canonical hub",
  institutionHrefForSlug(sample.old_slug) === `/institutions/${sample.moved_to}`,
);
check(
  "every superseded slug resolves to a canonical hub",
  slugAliases.every((a) => institutionHrefForSlug(a.old_slug) === `/institutions/${a.moved_to}`),
);

console.log(`\nsmoke:canonical-links: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
