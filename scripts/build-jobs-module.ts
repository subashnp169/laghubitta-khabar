/**
 * Rebuild `src/data/jobs.ts` from the pilot evidence database.
 *
 * The module this writes is read by the public /jobs page and by the B2B API, so it
 * is generated and never hand-edited. A vacancy reaches it only if there is a
 * current, non-rejected VACANCY `data_assertions` row in the pilot database, which
 * in turn exists only if a page was actually fetched from an institution's own site
 * AND published. No code path in this project can invent one.
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
 * That matters because the file this replaces was a hand-written list of ten
 * plausible-looking postings — with invented titles, institutions, locations and
 * deadlines — which the public /jobs page and `GET /api/institutions/:slug/jobs`
 * both served as though they had been read from somewhere. They had not.
 *
 * Run: npm run build:jobs
 */
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  jobsFromAssertionRows,
  type VacancyAssertionRecord,
  type VacancyDto,
} from "../lib/repository/projection";

const require = createRequire(import.meta.url);
interface Db {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string) => Db;

const DB_PATH = join(__dirname, "..", "data", "pilot", "evidence", "pilot-careers-ext-2026-10-01.db");
const OUT_PATH = join(__dirname, "..", "src", "data", "jobs.ts");

/** `now` for lifecycle decisions, injected so a rebuild is reproducible. */
const AS_OF = process.env.M35_AS_OF ?? "2026-10-01";

/**
 * A vacancy assertion knows which source observed it; the source knows which
 * institution it belongs to; the institution knows its slug and name. All three
 * joins are LEFT, so a vacancy whose institution row is missing is still listed —
 * with the gap marked — rather than silently dropped.
 */
function readVacancyRows(db: Db): VacancyAssertionRecord[] {
  return db
    .prepare(
      `SELECT a.entity_id, a.value, a.source_id, a.observed_at, a.valid_to,
              a.verification_status, a.confidence, a.field_name,
              COALESCE(isrc.institution_id, '') AS institution_id,
              COALESCE(inst.slug, '')        AS institution_slug,
              COALESCE(inst.name_en, '')     AS institution_name,
              isrc.url                       AS source_name
         FROM data_assertions a
         LEFT JOIN ingestion_sources isrc ON isrc.id = a.source_id
         LEFT JOIN institutions inst     ON inst.id = isrc.institution_id
        WHERE a.entity_type = 'VACANCY'`,
    )
    .all() as VacancyAssertionRecord[];
}

function readOpenConflictKeys(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT entity_id, field_name FROM data_conflicts
        WHERE resolution_status = 'OPEN' AND entity_type = 'VACANCY'`,
    )
    .all() as { entity_id: string; field_name: string }[];
  return new Set(rows.map((r) => `${r.entity_id}|${r.field_name}`));
}

/** The public `Job` shape, projected from the read model. */
interface PublicJob {
  id: string;
  title: string;
  institution: string;
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
// Every entry is a projection of a current, non-rejected VACANCY assertion row in
// data/pilot/evidence/pilot-careers-ext-2026-10-01.db, and such a row exists only if
// evidence was fetched from an institution's own site and then published. No code
// path in this project can invent one. Do not add a row by hand: nothing downstream
// would be able to tell it from a real one.
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

function main(): void {
  if (!existsSync(DB_PATH)) {
    // No database means no evidence, which means no vacancies. An empty module is
    // the correct output rather than an error, so a clean checkout still builds.
    writeFileSync(OUT_PATH, header([], "no pilot evidence database was present"), "utf8");
    console.log("build:jobs — no evidence database present, wrote an empty module");
    return;
  }

  const db = new Database(DB_PATH);
  try {
    const rows = readVacancyRows(db);
    const dtos = jobsFromAssertionRows(rows, {
      openConflictKeys: readOpenConflictKeys(db),
      now: AS_OF,
    });
    const jobs = dtos.map((d) => toPublicJob(d, d.institution_name));
    const postings = dtos.filter((d) => d.kind === "POSTING").length;
    const documents = dtos.filter((d) => d.kind === "DOCUMENT").length;
    const note =
      dtos.length === 0
        ? `no vacancy published yet as of ${AS_OF}: the M3.5 discovery pass parsed real pages and is recorded in data/pilot/career-source-registry.json, but it asserts no vacancy`
        : `${dtos.length} current vacancy record(s) as of ${AS_OF} (${postings} parsed posting(s)${documents > 0 ? `, ${documents} unread vacancy notice(s) linked on institution career pages` : ""}); all UNVERIFIED`;
    writeFileSync(OUT_PATH, header(jobs, note), "utf8");
    console.log(`build:jobs — ${note}`);
  } finally {
    db.close();
  }
}

main();
