/**
 * Rebuild `src/data/jobs.ts` from the durable evidence store (P2-D).
 *
 * The module this writes is read by the public /jobs page and by the B2B API, so it
 * is generated and never hand-edited. A vacancy reaches it only if there is a
 * current, non-rejected vacancy assertion in the store, which in turn exists only
 * if a page was actually fetched from an institution's own site AND published. No
 * code path in this project can invent one.
 *
 * What changed from the pre-P2-D builder, and why
 *
 *   Two evidence shapes exist and both publish:
 *
 *     - entity-keyed rows (`entity_type='VACANCY'`): a parsed posting or an
 *       unread notice link recorded against `vacancy-<pilot>|<tail>`;
 *     - title-only observations (`field_name='vacancy_title'` recorded against
 *       the institution entity itself): the career page's listing title, with
 *       no URL, location, type or deadline behind it. These publish as POSTING
 *       records whose identity is (institution, title), synthesized through the
 *       projection's canonicalVacancyEntityId so the same function the D1
 *       adapter uses builds the same id here.
 *
 *   The old builder resolved the owning institution with a store join
 *   `ingestion_sources -> institutions`. The store's `institutions` copy
 *   carries pilot-numbered stubs that disagree with the public registry for
 *   three institutions, so their vacancies were served under the wrong
 *   company's name. Canonical identity is now resolved from the SOURCE's
 *   publisher against the public registry (`src/data/institutions.ts`), the
 *   same rule P2-A/P2-B/P2-C use, and written onto every row as
 *   `institution_id` / `institution_slug`. A source whose publisher cannot be
 *   resolved is dropped from the public layer and kept in evidence.
 *
 *   entity_id is re-keyed to the canonical `vacancy-<institution>|<tail>` (or
 *   synthesized for title-only rows) so pilot-numbered ids never leak into the
 *   published layer, and open conflicts are mapped through the same identity.
 *
 * "Fetched" and "published" are separate, and this build keys on the second. The
 * M3.5 discovery pass fetches and parses every page in the pilot and writes down
 * what it found, but it is observation-only by design and asserts nothing; the
 * evidence application pass (scripts/run-career-apply.ts) then re-fetches the
 * pages the registry recorded and writes the VACANCY assertions this build reads
 * into a dated evidence database. A page that was parsed but whose fetch landed
 * no assertion contributes no row here — so an empty list is reported with that
 * reason rather than as an absence of findings.
 *
 * Run: npm run build:jobs
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { institutions } from "../src/data/institutions";
import {
  canonicalVacancyEntityId,
  jobsFromAssertionRows,
  normalizeObservedTitle,
  vacancyConflictRows,
  type EvidenceConflictRow,
  type VacancyAssertionRecord,
  type VacancyDto,
} from "../lib/repository/projection";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): { all(...args: unknown[]): Row[] };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean }) => Db;

/**
 * The merged durable store (P0.5) is the default evidence source, so a rebuild
 * sees every observation from all 13 evidence databases instead of one dated
 * file. Set `M35_JOBS_DB` to pin a single database for a reproducible rebuild.
 */
const DB_OVERRIDE = process.env.M35_JOBS_DB;
const DB_PATH =
  DB_OVERRIDE ??
  join(__dirname, "..", "data", "durable", "store.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "jobs.ts");

/**
 * The durable store is derived from data/pilot/evidence/*.db. If any evidence
 * database is newer than the store, a rebuild would publish rows older than the
 * evidence. Refuse and name the fix rather than emit stale vacancies. Skipped
 * when a single database is pinned explicitly with the env override.
 */
function assertStoreFresh(dbPath: string): void {
  const dir = join(__dirname, "..", "data", "pilot", "evidence");
  if (!existsSync(dir)) return;
  let newest = 0;
  let newestFile = "";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".db")) continue;
    const m = statSync(join(dir, f)).mtimeMs;
    if (m > newest) {
      newest = m;
      newestFile = f;
    }
  }
  if (newest > statSync(dbPath).mtimeMs) {
    console.error(
      `build:jobs — durable store is stale: ${newestFile} is newer than ${dbPath}.\n` +
        `Run \`npm run durable:build\` first, or set M35_JOBS_DB to a pinned evidence database.`,
    );
    process.exit(1);
  }
}

/** `now` for lifecycle decisions, injected so a rebuild is reproducible. */
const AS_OF = process.env.M35_AS_OF ?? "2026-10-01";

/** Institution-only identity key for publisher/alias matching (same as P2-A/B/C). */
function identityKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface PilotSource {
  id: string;
  institution_id: string;
  url?: string | null;
  publisher?: string;
  domain?: string;
}

// Canonical institution identity is resolved from the SOURCE, never from a
// pilot `mfi-0NN` entity id and never from the store's `institutions` stubs
// (whose numbering disagrees with the public registry for three institutions).
// An unresolvable source is dropped from the public layer and kept in evidence.
const pilotSourcesPath = join(__dirname, "..", "data", "pilot", "pilot-sources.json");
const pilotSources: PilotSource[] = existsSync(pilotSourcesPath)
  ? ((JSON.parse(readFileSync(pilotSourcesPath, "utf8")) as { sources?: PilotSource[] }).sources ?? [])
  : [];

function resolveInstitution(sourceId: string): (typeof institutions)[number] | undefined {
  const src = pilotSources.find((s) => s.id === sourceId);
  if (!src?.publisher) return undefined;
  const key = identityKey(src.publisher);
  const exact = institutions.filter((i) => identityKey(i.name) === key);
  const viaAlias = institutions.filter((i) => (i.aliases ?? []).some((a) => identityKey(a) === key));
  const cands = exact.length ? exact : viaAlias;
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
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
  return undefined;
}

/**
 * Raw vacancy evidence, both representations, ordered deterministically. The
 * store's `institutions` join is deliberately absent: identity comes from the
 * source publisher below, not from a table whose numbering drifted.
 */
function readVacancyRows(db: Db): Row[] {
  return db
    .prepare(
      `SELECT a.entity_id, a.value, a.source_id, a.observed_at, a.valid_to,
              a.verification_status, a.confidence, a.field_name,
              isrc.url AS source_url
         FROM data_assertions a
         LEFT JOIN ingestion_sources isrc ON isrc.id = a.source_id
        WHERE (a.entity_type = 'VACANCY'
           OR (a.entity_type = 'institution' AND a.field_name = 'vacancy_title'))
        ORDER BY a.entity_id, a.field_name, a.observed_at, a.value`,
    )
    .all() as Row[];
}

/** The public `Job` shape, projected from the read model. */
interface PublicJob {
  id: string;
  title: string;
  institution: string;
  institutionId: string;
  institutionSlug: string;
  location: string;
  type: string;
  deadline: string | null;
  description: string;
  slug: string;
  status: string;
  sourceName: string | null;
  lastSeenAt: string;
  kind: "POSTING" | "DOCUMENT";
  sourceDocument: string | null;
}

function toPublicJob(d: VacancyDto, institutionName: string): PublicJob {
  return {
    id: d.id,
    title: d.title,
    // An institution name that was never observed stays marked as unobserved rather
    // than being filled in from a guess; the row is still listed, with the gap
    // visible instead of papered over.
    institution: institutionName || "(institution name not observed)",
    // Canonical registry identity as a COLUMN. Consumers (API, pages) key on
    // this and never parse an id or match on a name to find the owner.
    institutionId: d.institution_id,
    institutionSlug: d.institution_slug,
    location: d.location ?? "(location not observed)",
    type: d.type ?? "(type not observed)",
    deadline: d.deadline,
    description: describe(d),
    slug: `${d.institution_slug}-${d.id}`,
    status: d.status,
    sourceName: d.source_name,
    lastSeenAt: d.last_seen_at,
    // A DOCUMENT record is a vacancy-shaped notice whose contents were never
    // read; a POSTING is a parsed record. The page must not present them as the
    // same thing, so both labels travel with the row.
    kind: d.kind,
    sourceDocument: d.source_document,
  };
}

/**
 * A description assembled only from fields that carry a published assertion. Every
 * clause is either read from the source or absent — there is no prose written here,
 * because prose written here would be indistinguishable on the page from something
 * an institution actually said.
 */
function describe(d: VacancyDto): string {
  const parts: string[] = [];
  if (d.requirements) parts.push(d.requirements);
  if (d.education) parts.push(`Education: ${d.education}`);
  if (d.experience) parts.push(`Experience: ${d.experience}`);
  if (d.department) parts.push(`Department: ${d.department}`);
  if (d.application_url) parts.push(`Apply: ${d.application_url}`);
  else if (d.application_method) parts.push(`Apply: ${d.application_method}`);
  else if (d.contact_email) parts.push(`Contact: ${d.contact_email}`);
  if (d.source_document) parts.push(`Notice: ${d.source_document}`);
  if (d.deadline_evidence) parts.push(`Deadline mentioned in the notice: ${d.deadline_evidence}`);
  if (d.conflicts.length > 0) parts.push(`Sources disagree about: ${d.conflicts.join(", ")}`);
  return parts.join(" · ");
}

function render(j: PublicJob): string {
  return [
    "  {",
    `    id: ${JSON.stringify(j.id)},`,
    `    title: ${JSON.stringify(j.title)},`,
    `    institution: ${JSON.stringify(j.institution)},`,
    `    institutionId: ${JSON.stringify(j.institutionId)},`,
    `    institutionSlug: ${JSON.stringify(j.institutionSlug)},`,
    `    location: ${JSON.stringify(j.location)},`,
    `    type: ${JSON.stringify(j.type)},`,
    `    deadline: ${JSON.stringify(j.deadline)},`,
    `    description: ${JSON.stringify(j.description)},`,
    `    slug: ${JSON.stringify(j.slug)},`,
    `    status: ${JSON.stringify(j.status)},`,
    `    sourceName: ${JSON.stringify(j.sourceName)},`,
    `    lastSeenAt: ${JSON.stringify(j.lastSeenAt)},`,
    `    kind: ${JSON.stringify(j.kind)},`,
    `    sourceDocument: ${JSON.stringify(j.sourceDocument)},`,
    "  },",
  ].join("\n");
}

function header(jobs: PublicJob[], note: string): string {
  const body = jobs.length === 0 ? "" : `\n${jobs.map(render).join("\n")}\n`;
  return `// GENERATED FILE - do not edit. Run \`npm run build:jobs\` to rebuild.
//
// ${note}
//
// Every entry is a projection of a current, non-rejected vacancy assertion in
// the configured evidence store (data/durable/store.db by default, merged from the
// 13 dated pilot databases; the M35_JOBS_DB environment variable pins a single
// database), and such an assertion exists only if evidence was fetched from an
// institution's own site and then published. No code path in this project can
// invent one. Do not add a row by hand: nothing downstream would be able to tell
// it from a real one.
//
// Two evidence shapes publish here (P2-D): parsed postings and unread notice
// links recorded against a vacancy entity, and title-only observations
// recorded against the institution entity from career-page listings. Identity
// and institution ownership are resolved by the builder from the source's
// publisher against the public registry; consumers read institutionId /
// institutionSlug columns and never parse an id to find the owner.
//
// An empty list here has more than one possible reason, and the note above says
// which one applies. It is not the same as "nothing was found": the M3.5 pipeline
// does parse real pages and records every candidate it sees, including the titles
// and counts, in data/pilot/career-source-registry.json, and the evidence
// application pass asserts unread vacancy documents it actually observed. So read
// "no assertions" as "nothing published yet".

export interface Job {
  id: string;
  title: string;
  institution: string;
  /** Canonical registry institution id (P2-D). Never parse it out of \`id\`. */
  institutionId: string;
  /** Canonical registry institution slug; the key API and pages resolve on. */
  institutionSlug: string;
  location: string;
  type: string;
  deadline: string | null;
  description: string;
  slug: string;
  status: string;
  sourceName: string | null;
  lastSeenAt: string;
  /** POSTING = a record parsed out of a page; DOCUMENT = an unread notice link. */
  kind: "POSTING" | "DOCUMENT";
  /** The observed URL of the vacancy notice, when the record is a document. */
  sourceDocument: string | null;
}

/** What this build was based on, shown by the page so the empty case is legible. */
export const jobsProvenance: string = ${JSON.stringify(note)};

export const jobs: Job[] = [${body}];
`;
}

function uniqueBySourceClaim(rows: VacancyAssertionRecord[]): VacancyAssertionRecord[] {
  const byKey = new Map<string, VacancyAssertionRecord>();
  for (const r of rows) {
    const key = `${r.entity_id}|${r.field_name}|${r.value}|${r.source_id}`;
    const prev = byKey.get(key);
    if (!prev || r.observed_at > prev.observed_at) byKey.set(key, r);
  }
  return [...byKey.values()];
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    // No database means no evidence, which means no vacancies. An empty module is
    // the correct output rather than an error, so a clean checkout still builds.
    writeFileSync(OUT_PATH, header([], "no durable evidence store was present (run npm run durable:build)"), "utf8");
    console.log("build:jobs — no durable evidence store present, wrote an empty module");
    return;
  }

  if (!DB_OVERRIDE) assertStoreFresh(DB_PATH);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rawRows = readVacancyRows(db);

    // Canonicalize identity: resolve the owning institution from the source
    // publisher, re-key the entity id through the projection's helper, and hold
    // anything unresolvable in evidence rather than publishing a pilot number.
    const droppedSources = new Map<string, number>();
    let droppedEmptyTitles = 0;
    const rows: VacancyAssertionRecord[] = [];
    for (const r of rawRows) {
      if (String(r.verification_status) === "REJECTED") continue;
      if (r.valid_to !== null && r.valid_to !== undefined) continue;
      const sourceId = String(r.source_id);
      const inst = resolveInstitution(sourceId);
      if (!inst) {
        droppedSources.set(sourceId, (droppedSources.get(sourceId) ?? 0) + 1);
        continue;
      }
      const field = String(r.field_name);
      const value = String(r.value);
      const entityId = canonicalVacancyEntityId(String(r.entity_id), field, value, inst.id);
      // A title-only row with no title is not a vacancy; keep it in evidence.
      if (field === "vacancy_title" && !normalizeObservedTitle(value)) {
        droppedEmptyTitles += 1;
        continue;
      }
      const sourceUrl = r.source_url === null || r.source_url === undefined ? null : String(r.source_url);
      rows.push({
        entity_id: entityId,
        institution_id: inst.id,
        institution_slug: inst.slug,
        institution_name: inst.name,
        field_name: field,
        value,
        source_id: sourceId,
        source_name: sourceUrl,
        source_url: sourceUrl,
        observed_at: String(r.observed_at),
        valid_to: null,
        verification_status: String(r.verification_status),
        confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
      });
    }

    // Only a genuine CROSS-SOURCE disagreement is a conflict, mapped through the
    // canonical vacancy identity so it lines up with the published rows. The
    // conflict's institution comes from its own source's publisher.
    const conflictRows = db
      .prepare(
        `SELECT entity_id, field_name, value_a, value_b, source_a_id, source_b_id
           FROM data_conflicts
          WHERE resolution_status = 'OPEN'
            AND (entity_type = 'VACANCY' OR field_name = 'vacancy_title')
            AND source_a_id IS NOT NULL
            AND source_b_id IS NOT NULL
            AND source_a_id <> source_b_id
          ORDER BY entity_id, field_name, value_a, value_b`,
      )
      .all() as Row[];
    const resolvedConflicts: EvidenceConflictRow[] = conflictRows.map((c) => ({
      entity_id: String(c.entity_id),
      field_name: String(c.field_name),
      value_a: c.value_a === null || c.value_a === undefined ? null : String(c.value_a),
      value_b: c.value_b === null || c.value_b === undefined ? null : String(c.value_b),
      institution_id:
        resolveInstitution(String(c.source_a_id ?? ""))?.id ??
        resolveInstitution(String(c.source_b_id ?? ""))?.id ??
        null,
    }));
    const open = vacancyConflictRows(resolvedConflicts);
    open.sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.field_name.localeCompare(b.field_name));

    const deduped = uniqueBySourceClaim(rows);
    deduped.sort(
      (a, b) =>
        a.entity_id.localeCompare(b.entity_id) ||
        a.field_name.localeCompare(b.field_name) ||
        a.value.localeCompare(b.value) ||
        a.observed_at.localeCompare(b.observed_at),
    );

    const dtos = jobsFromAssertionRows(deduped, {
      openConflictKeys: new Set(open.map((c) => `${c.entity_id}|${c.field_name}`)),
      now: AS_OF,
    });
    const jobs = dtos.map((d) => toPublicJob(d, d.institution_name));
    const postings = dtos.filter((d) => d.kind === "POSTING").length;
    const documents = dtos.filter((d) => d.kind === "DOCUMENT").length;
    const institutionsCovered = new Set(dtos.map((d) => d.institution_id)).size;
    const note =
      dtos.length === 0
        ? `no vacancy published yet as of ${AS_OF}: the M3.5 discovery pass parsed real pages and is recorded in data/pilot/career-source-registry.json, but it asserts no vacancy`
        : `${dtos.length} current vacancy record(s) as of ${AS_OF} ` +
          `(${postings} posting(s) with a title read from an institution's own page, ` +
          `${documents} unread vacancy notice(s), ${institutionsCovered} institution(s)); all UNVERIFIED`;
    writeFileSync(OUT_PATH, header(jobs, note), "utf8");

    for (const [sourceId, n] of droppedSources) {
      console.log(
        `  DROPPED (unresolvable institution identity): ${sourceId} — ${n} assertion(s) kept in evidence, not published`,
      );
    }
    if (droppedEmptyTitles > 0) {
      console.log(`  DROPPED (vacancy_title row with an empty title): ${droppedEmptyTitles} assertion(s) kept in evidence`);
    }
    console.log(
      `build:jobs — ${note}; vacancy assertions: ${deduped.length}, ` +
        `open (cross-source) conflicts: ${open.length} [store=${DB_PATH}]`,
    );
  } finally {
    db.close();
  }
}

main();
