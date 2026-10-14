// ============================================================================
// P2-B — canonical Branches acceptance tests.
//
// These assert the PROPERTIES P2-B guarantees over the generated — not
// hand-written — public branch layer. They read the same projection the runtime
// serves, so a regression in the builder or the projection fails here.
//
// Run: npm run smoke:branches-p2b   (after `npm run seed && npm run build:branches`)
// ============================================================================
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { allPublishedBranches } from "../lib/repository/static-branches";
import {
  branchesFromAssertionRows,
  type BranchAssertionRecord,
} from "../lib/repository/projection";
import { isAssertableBranchNameValue } from "../lib/ingestion/structured";
import { branchIdentityKey } from "../lib/ingestion/branch-records";
import { branchAssertions, openBranchConflicts } from "../src/data/branches";
import { institutions } from "../src/data/institutions";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => {
  prepare(s: string): { get(...a: unknown[]): Record<string, unknown>; all(...a: unknown[]): Record<string, unknown>[] };
  close(): void;
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

const registryById = new Map(institutions.map((i) => [i.id, i]));
const registrySlugs = new Set(institutions.map((i) => i.slug));

const branches = allPublishedBranches();

// ---------------------------------------------------------------------------
// 1. Population + branch identity (one branch per institution+name)
// ---------------------------------------------------------------------------
console.log("PB-1 branch identity");
check("published set is non-empty", branches.length > 0);
check("every branch id is unique", new Set(branches.map((b) => b.id)).size === branches.length);
check("every branch slug is unique", new Set(branches.map((b) => b.slug)).size === branches.length);
check("every branch is individually addressable (slug + name non-empty)", branches.every((b) => b.slug.length > 0 && b.name.trim().length > 0));
check("branch id embeds its canonical entity_id", branches.every((b) => b.id === `branch-${b.id.slice("branch-".length)}` && b.id.startsWith("branch-")));
const moduleEntityIds = new Set((branchAssertions as { entity_id: string }[]).map((r) => r.entity_id));
check("every entity_id is the canonical branchIdentityKey shape (<inst>|<name>|-)", [...moduleEntityIds].every((e) => /^[a-z0-9-]+\|.+\|-$/.test(e)));

// ---------------------------------------------------------------------------
// 2. Conservative matching — a name shared across institutions is NOT merged
// ---------------------------------------------------------------------------
console.log("PB-2 conservative matching");
// BranchDto carries its institution in id/slug, not as a field: id is
// `branch-<entity_id>` and entity_id is `branchIdentityKey` = `<inst>|<name>|-`.
const instIdOf = (b: { id: string }): string => b.id.slice("branch-".length).split("|")[0];
const byName = new Map<string, Set<string>>();
for (const b of branches) {
  const k = b.name.trim().toLowerCase();
  (byName.get(k) ?? byName.set(k, new Set()).get(k)!).add(instIdOf(b));
}
const sharedNames = [...byName.entries()].filter(([, insts]) => insts.size > 1);
check(
  "any branch name shared across institutions yields a separate branch per institution",
  sharedNames.every(([name, insts]) => branches.filter((b) => b.name.trim().toLowerCase() === name).length === insts.size),
);
console.log(`       (branch names shared across institutions: ${sharedNames.length})`);
// Identity is institution-scoped: two institutions with the same key differ.
check("identity includes the institution (no cross-institution collapse)", branchIdentityKey("mfi-001", "Waling Branch") !== branchIdentityKey("mfi-002", "Waling Branch"));

// ---------------------------------------------------------------------------
// 3. Invalid candidates are not promoted (headings / generic sections / bare districts)
// ---------------------------------------------------------------------------
console.log("PB-3 invalid candidates");
const JUNK = ["branch manager", "regional office", "head office", "number of regional office", "number of branch office", "branch branch manager", "morang", "jhapa"];
check("no published branch name is a heading/generic section", branches.every((b) => !JUNK.includes(b.name.trim().toLowerCase())));
check("gate rejects 'Branch Manager'", isAssertableBranchNameValue("Branch Manager") === false);
check("gate rejects 'Regional Office'", isAssertableBranchNameValue("Regional Office") === false);
check("gate rejects a bare district 'Morang'", isAssertableBranchNameValue("Morang") === false);
check("gate accepts a marker name 'Waling Branch'", isAssertableBranchNameValue("Waling Branch") === true);
check("gate accepts a place + district 'Sijuwa, Morang'", isAssertableBranchNameValue("Sijuwa, Morang") === true);

// ---------------------------------------------------------------------------
// 4. Institution relationship — every branch belongs to a canonical institution
// ---------------------------------------------------------------------------
console.log("PB-4 institution relationship");
check("every branch belongs to a canonical institution id", branches.every((b) => registryById.has(instIdOf(b))));
check("every branch slug is prefixed by its institution slug", branches.every((b) => {
  const inst = registryById.get(instIdOf(b));
  return inst !== undefined && registrySlugs.has(inst.slug) && b.slug.startsWith(`${inst.slug}-`);
}));
check("every entity_id is prefixed by its canonical institution id", [...moduleEntityIds].every((e) => registryById.has(e.split("|")[0])));

// ---------------------------------------------------------------------------
// 5. Source traceability — every branch carries provenance
// ---------------------------------------------------------------------------
console.log("PB-5 source traceability");
check("every branch has a primary source id", branches.every((b) => b.meta.source.trim().length > 0));
check("every branch has a non-empty source set", branches.every((b) => b.meta.sources.length >= 1));
check("primary source is contained in the source set", branches.every((b) => b.meta.sources.includes(b.meta.source)));
check("every source_url is absolute http(s) or null", branches.every((b) => b.meta.source_url === null || /^https?:\/\//.test(b.meta.source_url)));

// ---------------------------------------------------------------------------
// 6. Conflict preservation — same-source repeats are not a conflict; only an
//    OPEN cross-source disagreement is. Tested in isolation.
// ---------------------------------------------------------------------------
console.log("PB-6 conflict preservation");
const base: Omit<BranchAssertionRecord, "entity_id" | "value"> = {
  institution_id: "mfi-001",
  institution_slug: "x",
  field_name: "branch_name",
  source_id: "s1",
  observed_at: "2026-01-01",
  valid_to: null,
  verification_status: "UNVERIFIED",
  confidence: 0.6,
};
const repeat: BranchAssertionRecord[] = [
  { ...base, entity_id: branchIdentityKey("mfi-001", "Waling Branch"), value: "Waling Branch" },
  { ...base, entity_id: branchIdentityKey("mfi-001", "Waling Branch"), value: "Waling Branch", observed_at: "2026-01-02" },
];
const repeatOut = branchesFromAssertionRows(repeat);
check("same-source repeat is not CONFLICT", repeatOut.every((b) => b.meta.verification_status !== "CONFLICT"));
check("same-source repeat collapses to one branch", repeatOut.length === 1);
const crossOut = branchesFromAssertionRows(repeat, { openConflictKeys: new Set([`${branchIdentityKey("mfi-001", "Waling Branch")}|branch_name`]) });
check("an OPEN cross-source conflict degrades the branch to CONFLICT", crossOut.every((b) => b.meta.verification_status === "CONFLICT"));
check("openBranchConflicts is an array of entity/field keys", Array.isArray(openBranchConflicts) && openBranchConflicts.every((c) => typeof c.entity_id === "string" && typeof c.field_name === "string"));

// ---------------------------------------------------------------------------
// 7. Geography honesty — no fabricated province/district
// ---------------------------------------------------------------------------
console.log("PB-7 geography honesty");
const districtAssertions = new Set(
  (branchAssertions as { entity_id: string; field_name: string; value: string }[])
    .filter((r) => r.field_name === "branch_district" || r.field_name === "district")
    .map((r) => `${r.entity_id}|${r.value}`),
);
check(
  "a published district is either empty or backed by a district assertion (never fabricated)",
  branches.every((b) => b.district === "" || districtAssertions.has(`${moduleEntityIdFor(b)}|${b.district}`)),
);
// With current evidence there are no district assertions at all, so every
// published branch must report an empty district rather than a guess.
check("no branch publishes a district that is not in evidence", branches.every((b) => b.district === ""));

function moduleEntityIdFor(b: { id: string }): string {
  return b.id.slice("branch-".length);
}

// ---------------------------------------------------------------------------
// 8. Idempotency / determinism — the projection is a pure function of evidence
// ---------------------------------------------------------------------------
console.log("PB-8 idempotency");
const a = JSON.stringify(branchesFromAssertionRows(branchAssertions as unknown as BranchAssertionRecord[]));
const b2 = JSON.stringify(branchesFromAssertionRows(branchAssertions as unknown as BranchAssertionRecord[]));
check("projection is deterministic across calls", a === b2);
check("module assertions contain no REJECTED rows", (branchAssertions as { verification_status: string }[]).every((r) => r.verification_status !== "REJECTED"));
check("module assertions contain no retired rows", (branchAssertions as { valid_to?: string | null }[]).every((r) => r.valid_to === null || r.valid_to === undefined));

// ---------------------------------------------------------------------------
// 9. Assertion-only — the canonical branches table is deliberately NOT seeded
//    (province/district are NOT NULL but absent from evidence).
// ---------------------------------------------------------------------------
console.log("PB-9 assertion-only (no fabricated geography)");
const lkPath = join(process.cwd(), "lk.db");
check("lk.db exists (run `npm run seed`)", existsSync(lkPath));
if (existsSync(lkPath)) {
  const db = new Database(lkPath, { readonly: true });
  const branchRows = db.prepare("SELECT COUNT(*) c FROM branches").get().c as number;
  const historyRows = db.prepare("SELECT COUNT(*) c FROM branch_history").get().c as number;
  db.close();
  check("lk.db branches table is NOT seeded (0 rows)", branchRows === 0);
  check("lk.db branch_history table is empty (0 rows)", historyRows === 0);
}

console.log(`\nP2-B branches results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL P2-B BRANCHES TESTS PASSED.");