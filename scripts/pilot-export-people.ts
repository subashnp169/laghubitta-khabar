// ============================================================================
// People evidence snapshot generator (M3.3) — reads a pilot run DB (read-only)
// and emits a deterministic `src/data/people.ts` module: the raw people
// evidence rows (data_assertions with field_name LIKE 'people_%') plus the OPEN
// people conflicts, so the static site + B2B API can project PersonDtos
// (lib/repository/projection.ts) without touching D1.
//
//   npm run pilot:export:people -- <absolute-or-relative-db-path>
//   env LK_PILOT_DB=path npm run pilot:export:people
//
// Falls back to data/pilot/pilot-run-report.json for dbPath. READ-ONLY: no
// DDL, no writes to the source DB. Emits an empty (honest) module when the DB
// has no people evidence yet — the API then reports 0 people, never a guess.
//
// Institution identity is resolved from the SOURCE (its official MFB website
// identity, carried in data/pilot/pilot-sources.json with NRB provenance), not
// from the pilot DB's placeholder `institutions` rows and not from the bare
// mfi-0NN id, which is not a safe key between the two datasets. Assertions
// whose source identity cannot be resolved against the public registry are
// left in the evidence layer and NOT published.
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { institutions } from "../src/data/institutions";

/** Minimal public-registry shape this exporter needs. */
type PublicInstitution = (typeof institutions)[number];

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type Row = Record<string, unknown>;
type DB = {
  prepare(sql: string): { get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
  close(): void;
};

interface PersonAssertionLiteral {
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  field_name: string;
  value: string;
  source_id: string;
  observed_at: string;
  verification_status: string;
  confidence: number | null;
}

interface OpenConflictLiteral {
  institution_id: string;
  field_name: string;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * The name half of a person slug, derived exactly as personSlug() does in
 * lib/repository/projection.ts. Kept as a literal copy (rather than an import)
 * so this exporter stays a pure read-only snapshot generator; the two MUST stay
 * in step, because a disagreement here would publish a person under a slug the
 * public router cannot resolve.
 */
function nameSlugSegment(name: string): string {
  return name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Published-safety denylist for values that are plainly not a person's name.
 *
 * The committed plausibility gate (nameLike in lib/ingestion/people.ts) is
 * frozen and intentionally shallow: it accepts anything that is not a date, a
 * number, a phone, an email, a URL or an over-long string. It therefore admits
 * navigation labels and feature names, which are exactly what a "Director" slot
 * picks up when a board page lists links or services in the same column as
 * names. Publishing those would attribute an organisational label to a human.
 *
 * This list fails closed and is kept explicit rather than heuristic so every
 * exclusion is auditable and no real person can be dropped by a broad pattern.
 * Matched values are reported and retained in evidence, never published.
 */
const NOT_A_PERSON = new Set([
  "currency conversion",
  "internal web",
  "local bodies outreach",
  "working districts",
]);

function looksLikeNonPersonLabel(name: string): boolean {
  return NOT_A_PERSON.has(
    name
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  );
}

function main(): void {
  // People evidence lives in the People pilot DB (written by
  // scripts/run-pilot-people.ts), so that report is the preferred source of
  // truth. Falling back to the Phase O report would silently regenerate an
  // empty module and lose the verified People evidence.
  const readDbPath = (file: string, key: string): string | undefined => {
    const p = join(process.cwd(), "data", "pilot", file);
    if (!existsSync(p)) return undefined;
    const v = (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)[key] as string | undefined;
    return v && !v.startsWith("<") ? v : undefined;
  };
  const peoplePilot = readDbPath("pilot-people-report.json", "db_path");
  const phaseO = readDbPath("pilot-run-report.json", "dbPath");
  const dbPath = process.argv[2] ?? process.env.LK_PILOT_DB ?? peoplePilot ?? phaseO;
  console.log(`source db: ${dbPath ?? "(none)"}`);
  if (!dbPath) {
    console.error("USAGE: npm run pilot:export:people -- <db-path>   (or set LK_PILOT_DB)");
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true }) as DB;

  // ---------------------------------------------------------------------------
  // Canonical institution identity.
  //
  // The People pilot DB seeds its own `institutions` rows as placeholders
  // ("mfi-045 (pilot stub)", slug = the bare mfi id — see
  // scripts/run-pilot-people.ts). Those slugs do not exist in the public
  // registry, so joining to them would publish leadership under 404 URLs and
  // leak pilot stub names. Worse, the pilot `mfi-0NN` ids are NOT a safe join
  // key: the pilot and the public registry both number from 1 but do not agree
  // on every row (pilot mfi-045 = Swastik; public mfi-045 = Nyadi).
  //
  // The only identity that is actually evidence is the SOURCE itself: every
  // pilot source is an official MFB website carrying the institution's real
  // publisher name and the NRB registry provenance that established it
  // (data/pilot/pilot-sources.json, proven_by=nrb-bfi-mid-may-2026). So the
  // join is made on that source identity against the public registry, and a
  // source whose identity cannot be resolved is DROPPED rather than published
  // against a placeholder. Nothing is invented: unresolved stays unresolved.
  // ---------------------------------------------------------------------------
  const pilotSourcesPath = join(process.cwd(), "data", "pilot", "pilot-sources.json");
  const pilotSources: { id: string; institution_id: string; publisher?: string; domain?: string }[] = existsSync(
    pilotSourcesPath,
  )
    ? ((JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as { sources?: unknown }).sources ??
        (JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as unknown[])) as never
    : [];

  // Normalised comparison form: drop the legal-form noise ("... Bittiya Sanstha
  // Ltd.") so "X Laghubitta Bittiya Sanstha Limited" and "... Sanstha Ltd."
  // compare equal without any fuzzy matching.
  const identityKey = (s: string): string =>
    String(s ?? "")
      .toLowerCase()
      .replace(/\blimited\b/g, "ltd")
      .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const resolveInstitution = (sourceId: string): PublicInstitution | undefined => {
    const src = pilotSources.find((s) => s.id === sourceId);
    if (!src?.publisher) return undefined;
    const key = identityKey(src.publisher);
    const exact = institutions.filter((i) => identityKey(i.name) === key);
    const viaAlias = institutions.filter((i) => (i.aliases ?? []).some((a) => identityKey(a) === key));
    const cands = exact.length ? exact : viaAlias;
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      // Disambiguate on the source's own domain, still evidence.
      const host = String(src.domain ?? "").replace(/^www\./, "").toLowerCase();
      const byHost = cands.filter((i) => {
        if (!i.officialWebsite) return false;
        try {
          return new URL(i.officialWebsite).hostname.replace(/^www\./, "").toLowerCase() === host;
        } catch {
          return false;
        }
      });
      if (byHost.length === 1) return byHost[0];
    }
    return undefined; // unresolvable -> drop, never guess
  };

  const rows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value, a.observed_at, a.verification_status, a.confidence
         FROM data_assertions a
        WHERE a.entity_type = 'institution' AND a.field_name LIKE 'people_%'
        ORDER BY a.value, a.field_name, a.observed_at`,
    )
    .all() as Row[];

  const people: PersonAssertionLiteral[] = [];
  const droppedSources = new Map<string, number>();
  const droppedUnaddressable = new Map<string, number>();
  const droppedNonPerson = new Map<string, number>();
  for (const r of rows) {
    const sourceId = String(r.source_id);
    const inst = resolveInstitution(sourceId);
    if (!inst) {
      droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
      continue;
    }
    // A public person must be individually addressable. personSlug() reduces the
    // name to [a-z0-9], so a value written entirely in a non-Latin script (e.g.
    // the mathematical-bold Unicode block some Nepali sites use) yields an EMPTY
    // name segment — every such person at one institution would collapse onto
    // the identical id and slug, so all but one become unreachable and mutually
    // indistinguishable. Publishing them would be publishing duplicate-looking
    // public identities, so they stay in evidence and are not published. This is
    // a slug-normalisation limitation, not a judgement about the name.
    if (!nameSlugSegment(String(r.value))) {
      droppedUnaddressable.set(`${inst.slug} :: ${String(r.value)}`, (droppedUnaddressable.get(`${inst.slug} :: ${String(r.value)}`) ?? 0) + 1);
      continue;
    }
    if (looksLikeNonPersonLabel(String(r.value))) {
      droppedNonPerson.set(`${inst.slug} :: ${String(r.value)} (${String(r.field_name)})`, (droppedNonPerson.get(`${inst.slug} :: ${String(r.value)} (${String(r.field_name)})`) ?? 0) + 1);
      continue;
    }
    people.push({
      institution_id: inst.id,
      institution_slug: inst.slug,
      institution_name: inst.name,
      field_name: String(r.field_name),
      value: String(r.value),
      source_id: sourceId,
      observed_at: String(r.observed_at),
      verification_status: String(r.verification_status),
      confidence: num(r.confidence),
    });
  }
  people.sort(
    (a, b) =>
      a.institution_slug.localeCompare(b.institution_slug) ||
      a.value.localeCompare(b.value) ||
      a.field_name.localeCompare(b.field_name) ||
      a.observed_at.localeCompare(b.observed_at),
  );

  const conflictRows = db
    .prepare(
      `SELECT a.source_id, a.field_name FROM data_conflicts c
         JOIN data_assertions a
           ON a.entity_id = c.entity_id AND a.field_name = c.field_name AND a.source_id = c.source_a_id
        WHERE c.resolution_status = 'OPEN' AND c.entity_type = 'institution' AND c.field_name LIKE 'people_%'
        GROUP BY a.source_id, a.field_name
        ORDER BY a.source_id, a.field_name`,
    )
    .all() as Row[];
  const openPeopleConflicts: OpenConflictLiteral[] = conflictRows
    .map((r) => {
      const inst = resolveInstitution(String(r.source_id));
      return inst ? { institution_id: inst.id, field_name: String(r.field_name) } : undefined;
    })
    .filter((x): x is OpenConflictLiteral => x !== undefined);
  for (const [sourceId, n] of droppedSources) {
    console.log(`  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertions kept in evidence, not published`);
  }
  for (const [who, n] of droppedUnaddressable) {
    console.log(`  DROPPED (not individually addressable — name has no [a-z0-9] characters): ${who} — ${n} assertion(s) kept in evidence, not published`);
  }
  for (const [who, n] of droppedNonPerson) {
    console.log(`  DROPPED (not a person — navigation/feature label): ${who} — ${n} assertion(s) kept in evidence, not published`);
  }

  const body = `// Deterministic snapshot generated by scripts/pilot-export-people.ts (read-only)
// from ingestion evidence (data_assertions + data_conflicts). Raw people
// evidence rows only — the PersonDto projection lives in
// lib/repository/projection.ts so every adapter means the same thing.
import type { PersonAssertionRecord } from "../../lib/repository/projection";

export const peopleAssertions: (PersonAssertionRecord & { confidence: number | null })[] = ${JSON.stringify(people, null, 2)};

export const openPeopleConflicts: { institution_id: string; field_name: string }[] = ${JSON.stringify(openPeopleConflicts, null, 2)};
`;

  const target = join(process.cwd(), "src", "data", "people.ts");
  writeFileSync(target, body);
  console.log(
    `WROTE ${target}\npeople assertions: ${people.length}, distinct people: ${new Set(people.map((p) => `${p.institution_id}|${p.value}`)).size}, open conflicts: ${openPeopleConflicts.length} [raw=${dbPath}]`,
  );
  db.close();
}

main();
