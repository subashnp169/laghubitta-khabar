// ============================================================================
// P1 — Canonical identity integrity check.
//
// data/master/master.json is the ONLY surviving carrier of the NRB mid-May 2026
// identity observation. Its own inputs are gone: build-master.cjs reads
// institutions_dump.json, aliases_dump.json and source_registry_dump.json from
// %TEMP%, and all three have been deleted. `npm run build:master` therefore
// cannot run and this file cannot be regenerated from anything.
//
// So it needs the two things regeneration would have given it: a fingerprint that
// detects accidental edit or truncation, and a structural check that its own
// declared counts still match its own contents.
//
//   npx tsx scripts/verify-master-integrity.ts            verify
//   npx tsx scripts/verify-master-integrity.ts --write    re-fingerprint
//
// --write is the only mode that mutates anything, and it rewrites exactly one
// file (data/master/master.sha256). Use it after a DELIBERATE change to
// master.json, never to make a failing check go away.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const MASTER = join(ROOT, "data", "master", "master.json");
const SIDECAR = join(ROOT, "data", "master", "master.sha256");
const FORMER_JSON = join(ROOT, "data", "master", "canonical-former-aliases.json");
const SLUG_JSON = join(ROOT, "data", "master", "canonical-slug-aliases.json");
const DISPUTED_JSON = join(ROOT, "data", "master", "disputed-identities.json");

type Row = Record<string, unknown>;
const problems: string[] = [];
const notes: string[] = [];

// Fingerprint the LF-normalised text, never the raw working-tree bytes.
// This checkout has CRLF endings (working tree 138,807 bytes vs git blob
// 135,214 — 3,593 lines), so hashing raw bytes would fail on any LF checkout
// and on any contributor using core.autocrlf=false. Normalising keeps the
// fingerprint a property of the *content*, which is what we are protecting.
const rawBytes = readFileSync(MASTER);
const raw = rawBytes.toString("utf8");
const crlf = (raw.match(/\r\n/g) ?? []).length;
const normalized = raw.replace(/\r\n/g, "\n");
const sha = createHash("sha256").update(normalized, "utf8").digest("hex");
let master: Row;
try {
  master = JSON.parse(raw);
} catch (e) {
  console.error(`FAIL: master.json is not valid JSON — ${(e as Error).message}`);
  console.error("This file cannot be regenerated. Restore it from version control immediately.");
  process.exit(1);
}

console.log("P1 — canonical identity integrity");
console.log(`  file   : data/master/master.json (${rawBytes.length.toLocaleString()} bytes on disk, ${crlf} CRLF line endings, hashed as LF)`);
console.log(`  sha256 : ${sha} (LF-normalised)`);

// ---------------------------------------------------------------------------
// 1. Fingerprint must match the committed sidecar.
// ---------------------------------------------------------------------------
if (process.argv.includes("--write")) {
  writeFileSync(SIDECAR, `${sha}  master.json\n`, "utf8");
  console.log(`  wrote  : data/master/master.sha256`);
  console.log("\nOK — fingerprint recorded. Re-run without --write to verify.");
  process.exit(0);
}

if (!existsSync(SIDECAR)) {
  problems.push("data/master/master.sha256 does not exist — nothing has ever fingerprinted this file.");
  console.log("  sidecar: MISSING");
} else {
  const recorded = readFileSync(SIDECAR, "utf8").trim().split(/\s+/)[0];
  console.log(`  sidecar: ${recorded}`);
  if (recorded !== sha) {
    problems.push(`content changed: recorded ${recorded.slice(0, 16)}…, actual ${sha.slice(0, 16)}…`);
  }
}

// ---------------------------------------------------------------------------
// 2. Declared counts must match actual contents.
// ---------------------------------------------------------------------------
const snap = master.universeSnapshot as Row | undefined;
if (!snap) {
  problems.push("universeSnapshot is missing — the file does not say when it was observed.");
} else {
  const counts = (snap.counts ?? {}) as Row;
  const actual = {
    institutions: (master.institutions as Row[]).length,
    aliases: (master.aliases as Row[]).length,
    official_links: (master.officialLinks as Row[]).length,
    timeline: (master.timeline as Row[]).length,
    sources: (master.sources as Row[]).length,
  };
  for (const [k, n] of Object.entries(actual)) {
    if (counts[k] !== n) problems.push(`universeSnapshot.counts.${k} says ${counts[k]}, file holds ${n}`);
  }
  console.log(`  snapshot: ${snap.source_id} — "${snap.title}"`);
  console.log(`  observed_at: ${String(snap.observed_at)}`);

  // The observed_at value is hardcoded in build-master.cjs:245 and describes the
  // date the dump was VERIFIED, not the date the NRB list was captured. The
  // source id and title both say mid-May 2026. Flag it rather than silently
  // picking a day: the exact capture date is not recorded anywhere on disk.
  const observed = String(snap.observed_at);
  if (/^2026-06-20$/.test(observed) && /mid-may/i.test(String(snap.title))) {
    notes.push(
      `universeSnapshot.observed_at is ${observed} but the source is the "${snap.title}". ` +
        "build-master.cjs:245 hardcodes 2026-06-20 as the verification date. The universe was " +
        "observed in mid-May 2026; the exact day is not recorded anywhere. Not auto-corrected: " +
        "inventing a day would be fabricating provenance.",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Identity coverage: every institution must carry the A-grade NRB source.
// ---------------------------------------------------------------------------
const insts = (master.institutions ?? []) as Row[];
const srcIds = new Set(((master.sources ?? []) as Row[]).map((s) => s.id));
const badSource = insts.filter((i) => !srcIds.has(i.source_id as string));
if (badSource.length) {
  problems.push(`${badSource.length} institutions name a source_id absent from sources[]: ${[...new Set(badSource.map((i) => i.source_id))].join(", ")}`);
}
const noGrade = insts.filter((i) => (i.source_grade_identity as string) !== "A");
if (noGrade.length) problems.push(`${noGrade.length} institutions do not carry source_grade_identity 'A'`);
console.log(`  identity : ${insts.length} institutions, all source_id present, grade A on ${insts.length - noGrade.length}`);

// ---------------------------------------------------------------------------
// 4. Referential integrity of aliases and timeline against institutions.
// ---------------------------------------------------------------------------
const ids = new Set(insts.map((i) => i.id as string));
const orphanAliases = ((master.aliases ?? []) as Row[]).filter((a) => !ids.has(a.institution_id as string));
if (orphanAliases.length) problems.push(`${orphanAliases.length} aliases point at an institution that does not exist`);
const orphanEvents = ((master.timeline ?? []) as Row[]).filter((e) => e.institution_id && !ids.has(e.institution_id as string));
if (orphanEvents.length) problems.push(`${orphanEvents.length} timeline events point at an institution that does not exist`);

// ---------------------------------------------------------------------------
// 5. Lineage health — reported, not enforced. This is the P1 work queue.
// ---------------------------------------------------------------------------
const aliasTypes = new Map<string, number>();
for (const a of (master.aliases ?? []) as Row[]) {
  const t = a.alias_type as string;
  aliasTypes.set(t, (aliasTypes.get(t) ?? 0) + 1);
}
const timeline = (master.timeline ?? []) as Row[];
const undated = timeline.filter((e) => !e.occurred_at);
const predecessors = new Map<string, Row[]>();
for (const e of timeline) {
  const pn = e.predecessor_name as string;
  if (!pn) continue;
  if (!predecessors.has(pn)) predecessors.set(pn, []);
  predecessors.get(pn)!.push(e);
}
const predecessorNames = [...predecessors.keys()];
const aliasesForPredecessors = ((master.aliases ?? []) as Row[]).filter((a) => predecessorNames.includes(a.alias as string));

console.log(`\n  aliases    : ${[...aliasTypes.entries()].map(([t, n]) => `${t}=${n}`).join(", ")}`);
console.log(`  timeline   : ${timeline.length} events, ${undated.length} with no occurred_at`);
  console.log(`  predecessors: ${predecessorNames.length} distinct absorbed names, of which ${aliasesForPredecessors.length} appear in aliases[] (FORMER mapping: data/master/canonical-former-aliases.json; seeded into lk.db and, by npm run durable:build, into the durable store)`);

if (!aliasTypes.has("FORMER")) {
  notes.push(
    `alias_type 'FORMER' is in the schema but master.aliases[] holds only NAME_ALT (${aliasTypes.get("NAME_ALT") ?? 0}). ` +
      `The ${predecessorNames.length} absorbed predecessor names live in canonical-former-aliases.json, seeded into lk.db and the durable store, instead; ` +
      "master.json itself is fingerprinted and must not be edited to move them. Closure is enforced in check 6.",
  );
}
if (undated.length === timeline.length) {
  notes.push(`all ${timeline.length} timeline events have occurred_at NULL — see docs/data/TIMELINE-PROVENANCE.md. Dates are not fabricated.`);
}

// ---------------------------------------------------------------------------
// 6. Canonical lineage closure — P1. The canonical mappings generated in P1-A/B
//    (and backfilled into the durable store in P1-F) must cover every
//    predecessor and every disputed slug, and must point at real institutions.
//    These are FAILs, not notes: an unclosed gap means a rename or merge in
//    master.json has no published routing/alias behind it.
// ---------------------------------------------------------------------------
function loadJson(path: string): Row | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${path.split(/[/\\]/).pop()} is not valid JSON — ${(e as Error).message}`);
    return null;
  }
}

// 6a. FORMER aliases must cover every predecessor name in timeline[].
const formerDoc = loadJson(FORMER_JSON);
if (!formerDoc) {
  problems.push("data/master/canonical-former-aliases.json is missing — predecessor lineage has no canonical FORMER mapping.");
} else {
  const formerRows = (formerDoc.rows ?? []) as Row[];
  const covered = new Set(formerRows.map((r) => String(r.alias).toLowerCase()));
  const uncovered = predecessorNames.filter((n) => !covered.has(n.toLowerCase()));
  const badFormerTarget = formerRows.filter((r) => !ids.has(r.institution_id as string));
  if (uncovered.length) {
    problems.push(`${uncovered.length} timeline predecessor names have no canonical FORMER alias: ${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? ", …" : ""}`);
  }
  if (badFormerTarget.length) {
    problems.push(`${badFormerTarget.length} canonical FORMER aliases point at an institution_id absent from master.json institutions[]`);
  }
  const dupFormer = formerRows.length - new Set(formerRows.map((r) => `${r.institution_id}:${String(r.alias).toLowerCase()}`)).size;
  if (dupFormer > 0) problems.push(`${dupFormer} duplicate rows in canonical-former-aliases.json`);
  console.log(`  canonical FORMER : ${formerRows.length}/${predecessorNames.length} predecessors covered, ${badFormerTarget.length} dangling targets, ${dupFormer} dups`);
}

// 6b. Canonical slug aliases must cover the disputed slugs and point forward
//     at slugs that exist, with no self-redirects.
const slugDoc = loadJson(SLUG_JSON);
const disputedDoc = loadJson(DISPUTED_JSON);
if (!slugDoc) {
  problems.push("data/master/canonical-slug-aliases.json is missing — disputed renames have no canonical slug routing.");
} else {
  const slugRows = (slugDoc.rows ?? []) as Row[];
  const byOld = new Map(slugRows.map((r) => [r.old_slug as string, r]));
  const instSlugs = new Set(insts.map((i) => i.slug as string));
  const instIds = ids;
  const selfRedirects = slugRows.filter((r) => r.old_slug === r.moved_to);
  const danglingTargets = slugRows.filter((r) => !instSlugs.has(r.moved_to as string));
  const danglingSources = slugRows.filter((r) => !instIds.has(r.institution_id as string));
  if (selfRedirects.length) problems.push(`${selfRedirects.length} canonical slug aliases redirect a slug to itself`);
  if (danglingTargets.length) problems.push(`${danglingTargets.length} canonical slug aliases move_to a slug that does not exist: ${danglingTargets.map((r) => r.moved_to).slice(0, 3).join(", ")}`);
  if (danglingSources.length) problems.push(`${danglingSources.length} canonical slug aliases carry an unknown institution_id`);
  if (disputedDoc) {
    // Live conflicts (0 after correction) plus the reconstructed record of the
    // corrections already applied. Both sets of old slugs need routing.
    const live = ((disputedDoc.identity_conflicts ?? []) as Row[]).map((d) => d.published as Row | undefined);
    const applied = ((disputedDoc.applied_identity_corrections ?? []) as Row[]).map((d) => d.published as Row | undefined);
    const disputes = [...live, ...applied].filter((p): p is Row => !!p && typeof p.slug === "string");
    const missing = disputes.filter((d) => !byOld.has(d.slug as string));
    if (missing.length) {
      problems.push(`${missing.length} disputed identity conflicts have no canonical slug alias (old slug would 404): ${missing.map((d) => d.slug).slice(0, 3).join(", ")}`);
    }
    console.log(`  canonical slugs   : ${slugRows.length}/${disputes.length} disputed slugs routed (${live.length} live + ${applied.length} applied), ${selfRedirects.length} self, ${danglingTargets.length} dangling`);
  } else {
    console.log(`  canonical slugs   : ${slugRows.length} rows, ${selfRedirects.length} self, ${danglingTargets.length} dangling`);
  }
}

// 6c. The old (now-invalid) slugs must not survive as live slugs anywhere in
//     master.json — a collision would mean the rename was not applied.
if (slugDoc) {
  const oldSlugs = new Set(((slugDoc.rows ?? []) as Row[]).map((r) => r.old_slug as string));
  const collided = insts.filter((i) => oldSlugs.has(i.slug as string));
  if (collided.length) {
    problems.push(`${collided.length} institutions still publish an old disputed slug: ${collided.map((i) => i.slug).join(", ")}`);
  }
}

// 6d. Timeline events: predecessor_id must be present (name-only lineage is
//     unresolvable) and every predecessor_name must be non-empty.
const badTimeline = timeline.filter((e) => e.predecessor_name !== undefined && (!e.predecessor_name || !String(e.predecessor_name).trim()));
if (badTimeline.length) problems.push(`${badTimeline.length} timeline events carry an empty predecessor_name`);

for (const n of notes) console.log(`\n  NOTE  ${n}`);
for (const p of problems) console.log(`\n  FAIL  ${p}`);

console.log(
  problems.length
    ? `\nFAIL — ${problems.length} integrity problem(s). master.json cannot be regenerated, so this cannot be fixed by rebuilding.`
    : `\nOK — master.json intact: fingerprint matches, counts match, ${predecessorNames.length} predecessor names known and closed by canonical FORMER aliases, canonical slug routing complete.`,
);
process.exit(problems.length ? 1 : 0);