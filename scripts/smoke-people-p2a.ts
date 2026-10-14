// ============================================================================
// P2-A — canonical People + Positions acceptance tests.
//
// These assert the PROPERTIES P2-A guarantees over the generated — not
// hand-written — public people layer, plus the canonical `people`/`positions`
// seed in lk.db. They read the same projection the runtime serves, so a
// regression in the builder or the projection fails here.
//
// Run: npm run smoke:people-p2a   (after `npm run seed && npm run build:people`)
// ============================================================================
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { allPublishedPeople } from "../lib/repository/static-people";
import {
  peopleFromAssertionRows,
  type PersonAssertionRecord,
} from "../lib/repository/projection";
import { nameLike } from "../lib/ingestion/people";
import { peopleAssertions, openPeopleConflicts } from "../src/data/people";
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

const people = allPublishedPeople();

// ---------------------------------------------------------------------------
// 1. Population + person identity (no uncontrolled duplicates)
// ---------------------------------------------------------------------------
console.log("P2A-1 person identity");
check("published set is non-empty", people.length > 0);
check("every person id is unique", new Set(people.map((p) => p.id)).size === people.length);
check("every person slug is unique", new Set(people.map((p) => p.slug)).size === people.length);
check("every person is individually addressable (slug non-empty)", people.every((p) => p.slug.length > 0 && p.name.trim().length > 0));
check("person id embeds its institution id", people.every((p) => p.id.includes(p.institution_id)));

// ---------------------------------------------------------------------------
// 2. Conservative matching — an identical name at two institutions is NOT merged
// ---------------------------------------------------------------------------
console.log("P2A-2 conservative matching");
const byName = new Map<string, Set<string>>();
for (const p of people) {
  const k = p.name.trim().toLowerCase();
  (byName.get(k) ?? byName.set(k, new Set()).get(k)!).add(p.institution_id);
}
const sharedNames = [...byName.entries()].filter(([, insts]) => insts.size > 1);
check(
  "any name shared across institutions yields a separate person per institution",
  sharedNames.every(([name, insts]) => people.filter((p) => p.name.trim().toLowerCase() === name).length === insts.size),
);
check("no person id spans more than one institution", new Set(people.map((p) => p.id)).size === people.length);
console.log(`       (names shared across institutions: ${sharedNames.length})`);

// ---------------------------------------------------------------------------
// 3. Invalid candidates are not promoted (headers / generic titles / non-persons)
// ---------------------------------------------------------------------------
console.log("P2A-3 invalid candidates");
const GENERIC = ["department", "dept", "manager", "officer", "director general", "board of directors", "press release", "ministry", "nepal rastra bank"];
const looksGeneric = (n: string): boolean => {
  const t = n.toLowerCase();
  return GENERIC.some((g) => t === g || t.includes(g));
};
check("no published name is a generic/heading label", people.every((p) => !looksGeneric(p.name)));
check("'Divisional Manager' is not published", !people.some((p) => p.name.trim().toLowerCase() === "divisional manager"));
check("nameLike gate rejects 'Divisional Manager'", nameLike("Divisional Manager") === false);
check("nameLike gate rejects 'Head of IT Department'", nameLike("Head of IT Department") === false);
check("nameLike gate accepts a real name", nameLike("Mr. Chandra Mani Chaulagai") === true);

// ---------------------------------------------------------------------------
// 4. Institution relationship — every position belongs to a canonical institution
// ---------------------------------------------------------------------------
console.log("P2A-4 institution relationship");
check("every institution_id is canonical", people.every((p) => registryById.has(p.institution_id)));
check("every institution_slug matches the registry", people.every((p) => registrySlugs.has(p.institution_slug) && p.institution_slug === registryById.get(p.institution_id)!.slug));
check("every person has at least one position", people.every((p) => p.positions.length >= 1));
check("every position title is a known role title", people.every((p) => p.positions.every((pos) => ["Chairperson", "Chief Executive Officer", "Director", "Board Member"].includes(pos.title))));

// ---------------------------------------------------------------------------
// 5. Source traceability — every person carries provenance
// ---------------------------------------------------------------------------
console.log("P2A-5 source traceability");
check("every person has a primary source id", people.every((p) => p.meta.source.trim().length > 0));
check("every person has a non-empty source set", people.every((p) => p.meta.sources.length >= 1));
check("primary source is contained in the source set", people.every((p) => p.meta.sources.includes(p.meta.source)));

// ---------------------------------------------------------------------------
// 6. Conflict preservation — a single source listing several holders is NOT a
//    conflict; only an OPEN cross-source disagreement is. Tested in isolation so
//    it does not depend on what the current store happens to contain.
// ---------------------------------------------------------------------------
console.log("P2A-6 conflict preservation");
const multi: PersonAssertionRecord[] = [
  { institution_id: "mfi-001", institution_slug: "x", institution_name: "X", field_name: "people_ceo", value: "Aaa Bbb", source_id: "s1", observed_at: "2026-01-01", verification_status: "UNVERIFIED", confidence: 0.6 },
  { institution_id: "mfi-001", institution_slug: "x", institution_name: "X", field_name: "people_ceo", value: "Ccc Ddd", source_id: "s1", observed_at: "2026-01-02", verification_status: "UNVERIFIED", confidence: 0.6 },
];
const multiOut = peopleFromAssertionRows(multi);
check("same-source multi-holder is not CONFLICT", multiOut.every((p) => p.meta.verification_status !== "CONFLICT"));
check("same-source multi-holder is reported as shared_by=2", multiOut.every((p) => p.positions[0]?.shared_by === 2));
const crossOut = peopleFromAssertionRows(multi, { openConflictKeys: new Set(["mfi-001|people_ceo"]) });
check("an OPEN cross-source conflict degrades the record to CONFLICT", crossOut.every((p) => p.meta.verification_status === "CONFLICT"));
check("openPeopleConflicts is an array of institution/field keys", Array.isArray(openPeopleConflicts) && openPeopleConflicts.every((c) => typeof c.institution_id === "string" && typeof c.field_name === "string"));

// ---------------------------------------------------------------------------
// 7. Tenure — no fabricated appointment/end dates
// ---------------------------------------------------------------------------
console.log("P2A-7 tenure");
const lkPath = join(process.cwd(), "lk.db");
check("lk.db exists (run `npm run seed`)", existsSync(lkPath));
if (existsSync(lkPath)) {
  const db = new Database(lkPath, { readonly: true });
  const pos = db.prepare("SELECT COUNT(*) c FROM positions").get().c as number;
  const appointed = db.prepare("SELECT COUNT(*) c FROM positions WHERE appointed_at IS NOT NULL").get().c as number;
  const ended = db.prepare("SELECT COUNT(*) c FROM positions WHERE ended_at IS NOT NULL").get().c as number;
  const current = db.prepare("SELECT COUNT(*) c FROM positions WHERE is_current = 1").get().c as number;
  const peopleCount = db.prepare("SELECT COUNT(*) c FROM people").get().c as number;
  db.close();
  check("lk.db has canonical positions", pos > 0);
  check("lk.db has canonical people", peopleCount > 0);
  check("no appointment date is fabricated (all NULL)", appointed === 0);
  check("no end date is fabricated (all NULL)", ended === 0);
  check("every seeded position is current", current === pos);
}

// ---------------------------------------------------------------------------
// 8. Idempotency / determinism — the projection is a pure function of evidence
// ---------------------------------------------------------------------------
console.log("P2A-8 idempotency");
const a = JSON.stringify(peopleFromAssertionRows(peopleAssertions as unknown as PersonAssertionRecord[]));
const b = JSON.stringify(peopleFromAssertionRows(peopleAssertions as unknown as PersonAssertionRecord[]));
check("projection is deterministic across calls", a === b);
check("module assertions contain no REJECTED rows", (peopleAssertions as { verification_status: string }[]).every((r) => r.verification_status !== "REJECTED"));
check("module assertions contain no retired rows", (peopleAssertions as { valid_to?: string | null }[]).every((r) => r.valid_to === null || r.valid_to === undefined));

console.log(`\nP2-A people/positions results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL P2-A PEOPLE/POSITIONS TESTS PASSED.");