// ============================================================================
// P2-D — canonical documents + jobs layer acceptance tests.
//
// These assert the PROPERTIES P2-D guarantees over the generated — not
// hand-written — public general-document and vacancy layers. They read the
// same shared projection the runtime serves, so a regression in a builder or
// the projection fails here. Nothing here reads a document's contents; neither
// layer ever had contents to read.
//
// Run: npm run smoke:documents-jobs-p2d
//      (after `npm run seed && npm run durable:build`, which now rebuilds
//       src/data/documents.ts and src/data/jobs.ts)
// ============================================================================
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { allPublishedDocuments } from "../lib/repository/static-documents";
import {
  documentConflictRows,
  documentsFromAssertionRows,
  jobsFromAssertionRows,
  titleGateReason,
  vacancyConflictRows,
  type DocumentAssertionRecord,
  type EvidenceConflictRow,
  type VacancyAssertionRecord,
} from "../lib/repository/projection";
import { documentAssertions, openDocumentConflicts, documentsProvenance } from "../src/data/documents";
import { generalDocumentClass, documentTypeLabel } from "../src/util/documents";
import { jobs, jobsProvenance } from "../src/data/jobs";
import { institutions } from "../src/data/institutions";
import { nrbInstitutionLinks } from "../src/data/nrb";
import { handleApiRequest } from "../lib/api/handler";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
const Database = require("better-sqlite3") as new (
  p: string,
  o?: { readonly?: boolean },
) => {
  prepare(s: string): { get(...a: unknown[]): Row; all(...a: unknown[]): Row[] };
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

// Test-side copies of the builder's resolution rules. Deliberately independent
// of the builder's code: a shared bug would pass a shared helper.
const identityKey = (s: string): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
interface PilotSource { id: string; publisher?: string; domain?: string; }
const pilotSources: PilotSource[] = (
  JSON.parse(readFileSync(join(process.cwd(), "data/pilot/pilot-sources.json"), "utf8")) as { sources?: PilotSource[] }
).sources ?? [];
function publisherResolvesTo(sourceId: string): string | undefined {
  const src = pilotSources.find((s) => s.id === sourceId);
  if (!src?.publisher) return undefined;
  const key = identityKey(src.publisher);
  const exact = institutions.filter((i) => identityKey(i.name) === key);
  const viaAlias = institutions.filter((i) => (i.aliases ?? []).some((a) => identityKey(a) === key));
  const cands = exact.length ? exact : viaAlias;
  if (cands.length === 1) return cands[0].id;
  if (cands.length > 1) {
    const host = String(src.domain ?? "").replace(/^www\./, "").toLowerCase();
    const byHost = cands.filter((i) => {
      if (!i.officialWebsite) return false;
      try { return new URL(i.officialWebsite).hostname.replace(/^www\./, "").toLowerCase() === host; } catch { return false; }
    });
    if (byHost.length === 1) return byHost[0].id;
  }
  return undefined;
}
const GENERIC =
  /^(download|downloads?|read\s*more|readmore|view(\s*more)?|more|click(\s*here)?|here|details?|see\s*more|open|link|pdf|file|document|notice|english|nepali)$/i;
const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
// Independent restatement of the gate's semantics: a trailing period on a
// scraped link label ("Download.", "… Ltd.") is punctuation, not identity.
const dotNorm = (v: unknown): string => norm(String(v ?? "").replace(/\./g, " "));
const testGate = (title: string, institutionName: string): boolean => {
  const t = dotNorm(title);
  if (!t || GENERIC.test(t)) return true;
  const own = dotNorm(institutionName);
  return own !== "" && identityKey(t) === identityKey(own);
};

const docs = allPublishedDocuments();

// ---------------------------------------------------------------------------
// 1. Document population + identity
// ---------------------------------------------------------------------------
console.log("PD-1 document identity");
check("published document set is non-empty", docs.length > 0);
check("document count is the preflight-measured 330", docs.length === 330);
check("every document id is unique", new Set(docs.map((d) => d.id)).size === docs.length);
check("every document id is the canonical document-<inst>|<title> shape", docs.every((d) => /^document-mfi-\d+\|/.test(d.id)));
check("every document has a non-empty title", docs.every((d) => d.title.trim().length > 0));
check("every document is scoped to a registry slug", docs.every((d) => registrySlugs.has(d.institution_slug)));
check(
  "every document's institution columns agree with the registry",
  docs.every((d) => registryById.get(d.institution_id)?.slug === d.institution_slug && registryById.get(d.institution_id)?.name === d.institution),
);
const docInstOfEntity = (e: string): string => e.split("|")[0].replace(/^document-/, "");
check(
  "every module assertion's entity prefix equals its institution_id",
  (documentAssertions as { entity_id: string; institution_id: string }[]).every((r) => docInstOfEntity(r.entity_id) === r.institution_id),
);
check(
  "every module assertion's institution columns agree with the registry",
  (documentAssertions as { institution_id: string; institution_slug: string; institution_name: string }[]).every(
    (r) => registryById.get(r.institution_id)?.slug === r.institution_slug && registryById.get(r.institution_id)?.name === r.institution_name,
  ),
);
check(
  "every observation's source publisher resolves to its recorded institution",
  (documentAssertions as { source_id: string; institution_id: string }[]).every((r) => publisherResolvesTo(r.source_id) === r.institution_id),
);
check("documentsProvenance reports the published count", documentsProvenance.startsWith(`${docs.length} current document record(s)`));

// P1-5 document taxonomy: the class of a general document is a fact about the
// assertion (notice_title vs document_title), never a guessed content category.
const noticeDocs = docs.filter((d) => d.doc_type === "NOTICE");
check(
  "every general document classifies to a notice or a document link, by its evidence type",
  docs.every((d) => {
    const cls = generalDocumentClass(d);
    return d.doc_type === "NOTICE" ? cls === "notice" : cls === "document-link";
  }),
);
check(
  "the notice and document-link classes partition the whole published set",
  noticeDocs.length + docs.filter((d) => generalDocumentClass(d) === "document-link").length === docs.length,
);
check(
  "taxonomy labels name the capability, not a content category",
  documentTypeLabel("NOTICE") === "Notice" && documentTypeLabel("DOCUMENT") === "Document link",
);

// ---------------------------------------------------------------------------
// 2. Jobs population + identity
// ---------------------------------------------------------------------------
console.log("PD-2 jobs identity");
const postings = jobs.filter((j) => j.kind === "POSTING");
const notices = jobs.filter((j) => j.kind === "DOCUMENT");
check("vacancy set is non-empty", jobs.length > 0);
check("vacancy count is the preflight-measured 99", jobs.length === 99);
check("kind split is the preflight-measured 63 postings / 36 notices", postings.length === 63 && notices.length === 36);
check("every job id is unique", new Set(jobs.map((j) => j.id)).size === jobs.length);
check("every job id is the canonical vacancy-<inst>|... shape", jobs.every((j) => /^vacancy-mfi-\d+\|/.test(j.id)));
check("every job has a non-empty title", jobs.every((j) => j.title.trim().length > 0));
check("every job is scoped to a registry slug", jobs.every((j) => registrySlugs.has(j.institutionSlug)));
check(
  "every job's institution columns agree with the registry",
  jobs.every((j) => registryById.get(j.institutionId)?.slug === j.institutionSlug && registryById.get(j.institutionId)?.name === j.institution),
);
check(
  "every job's slug starts with its canonical institution slug",
  jobs.every((j) => j.slug.startsWith(`${j.institutionSlug}-`)),
);
check("jobsProvenance reports the published count", jobsProvenance.startsWith(`${jobs.length} current vacancy record(s)`));

// ---------------------------------------------------------------------------
// 3. Evidence parity — the published set is exactly what the store supports,
//    resolved independently. This is the check that fails if a builder drifts
//    back to the store's pilot-numbered `institutions` join (three institutions'
//    vacancies were served under the wrong company before P2-D).
// ---------------------------------------------------------------------------
console.log("PD-3 store parity (publisher -> registry, independently resolved)");
const storePath = join(process.cwd(), "data", "durable", "store.db");
check("durable store exists", existsSync(storePath));
if (existsSync(storePath)) {
  const db = new Database(storePath, { readonly: true });

  const docRows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value
         FROM data_assertions a
        WHERE a.field_name IN ('document_title', 'notice_title')
          AND a.verification_status <> 'REJECTED'
          AND a.valid_to IS NULL`,
    )
    .all() as Row[];
  const expectedDocs = new Map<string, string>();
  for (const r of docRows) {
    const inst = publisherResolvesTo(String(r.source_id));
    if (!inst) continue;
    const title = norm(r.value);
    const name = registryById.get(inst)?.name ?? "";
    if (!title || testGate(title, name)) continue;
    expectedDocs.set(`document-${inst}|${title}`, inst);
  }
  check(
    "published document set equals the independently resolved evidence set",
    docs.length === expectedDocs.size && docs.every((d) => expectedDocs.get(d.id) === d.institution_id),
  );

  const jobRows = db
    .prepare(
      `SELECT a.entity_id, a.source_id, a.field_name, a.value
         FROM data_assertions a
        WHERE (a.entity_type = 'VACANCY'
           OR (a.entity_type = 'institution' AND a.field_name = 'vacancy_title'))
          AND a.verification_status <> 'REJECTED'
          AND a.valid_to IS NULL`,
    )
    .all() as Row[];
  const expectedJobs = new Map<string, string>();
  for (const r of jobRows) {
    const inst = publisherResolvesTo(String(r.source_id));
    if (!inst) continue;
    const raw = String(r.entity_id);
    const field = String(r.field_name);
    let id: string;
    if (raw.startsWith("vacancy-")) {
      // Entity-keyed: re-key only the institution segment, tail byte-for-byte.
      id = `vacancy-${inst}|${raw.split("|").slice(1).join("|")}`;
    } else if (field === "vacancy_title") {
      // Title-only: identity is (institution, title). A gated title with no
      // document URL behind it publishes nothing, so it leaves the expected set.
      const title = norm(r.value);
      const name = registryById.get(inst)?.name ?? "";
      if (!title || testGate(title, name)) continue;
      id = `vacancy-${inst}|${title}`;
    } else {
      id = raw;
    }
    expectedJobs.set(id, inst);
  }
  check(
    "published vacancy set equals the independently resolved evidence set",
    jobs.length === expectedJobs.size && jobs.every((j) => expectedJobs.get(j.id) === j.institutionId),
  );

  // The three institutions whose store `institutions` row disagrees with the
  // registry numbering (mfi-038, mfi-042, mfi-045) actually carry vacancies,
  // so the attribution fix is exercised rather than vacuously true.
  const drifted = ["mfi-038", "mfi-042", "mfi-045"];
  const driftedJobs = jobs.filter((j) => drifted.includes(j.institutionId));
  check("at least one vacancy belongs to a drifted-numbering institution", driftedJobs.length > 0);
  check(
    "drifted-numbering vacancies are published under their registry identity",
    driftedJobs.every((j) => {
      const reg = registryById.get(j.institutionId);
      return reg !== undefined && j.institutionSlug === reg.slug && j.institution === reg.name;
    }),
  );
  db.close();
}

// ---------------------------------------------------------------------------
// 4. Title gate — a call to action or the institution's own name never publishes
// ---------------------------------------------------------------------------
console.log("PD-4 title gate");
check("no published document title is a bare call to action", docs.every((d) => !GENERIC.test(dotNorm(d.title))));
const isOwnName = (title: string, institution: string): boolean => {
  const t = identityKey(dotNorm(title));
  const o = identityKey(dotNorm(institution));
  return o !== "" && t === o;
};
check(
  "no published document title is just its institution's own name",
  docs.every((d) => !isOwnName(d.title, d.institution)),
);
check("no published vacancy title is a bare call to action", jobs.every((j) => !GENERIC.test(dotNorm(j.title))));
check("no published vacancy title is just its institution's own name", jobs.every((j) => !isOwnName(j.title, j.institution)));
check("titleGateReason flags a generic label", titleGateReason("Download", "Any MFB Ltd.") === "GENERIC");
check("titleGateReason flags a punctuated generic label", titleGateReason("Download.", "Any MFB Ltd.") === "GENERIC");
check("titleGateReason flags an empty title", titleGateReason("   ", "Any MFB Ltd.") === "GENERIC");
check("titleGateReason flags the institution's own name", titleGateReason("Example Laghubitta Bittiya Sanstha", "Example Laghubitta Bittiya Sanstha Ltd.") === "OWN_NAME");
check("titleGateReason flags the institution's own name with a trailing period", titleGateReason("Example Laghubitta Bittiya Sanstha Ltd.", "Example Laghubitta Bittiya Sanstha") === "OWN_NAME");
check("titleGateReason passes a real title", titleGateReason("Annual Report 2082", "Example Laghubitta Bittiya Sanstha Ltd.") === null);

const docGateRow: DocumentAssertionRecord = {
  entity_id: "document-mfi-001|Download",
  institution_id: "mfi-001",
  institution_slug: "example",
  institution_name: "Example Laghubitta Bittiya Sanstha Ltd.",
  field_name: "document_title",
  value: "Download",
  source_id: "s1",
  source_url: "https://example.com",
  observed_at: "2026-01-01",
  valid_to: null,
  verification_status: "UNVERIFIED",
  confidence: 0.6,
};
check("a generic document title is withheld by the projection", documentsFromAssertionRows([docGateRow]).length === 0);
check(
  "an own-name document title is withheld by the projection",
  documentsFromAssertionRows([{ ...docGateRow, entity_id: "document-mfi-001|Example", value: "Example Laghubitta Bittiya Sanstha Ltd." }]).length === 0,
);
check(
  "a real document title publishes",
  documentsFromAssertionRows([{ ...docGateRow, entity_id: "document-mfi-001|Annual Report 2082", value: "Annual Report 2082" }]).length === 1,
);

const jobGateRow: VacancyAssertionRecord = {
  entity_id: "vacancy-mfi-001|Download",
  institution_id: "mfi-001",
  institution_slug: "example",
  institution_name: "Example Laghubitta Bittiya Sanstha Ltd.",
  field_name: "vacancy_title",
  value: "Download",
  source_id: "s1",
  observed_at: "2026-01-01",
  valid_to: null,
  verification_status: "UNVERIFIED",
  confidence: 0.6,
};
check("a gated vacancy title with no notice URL is not published", jobsFromAssertionRows([jobGateRow]).length === 0);
check(
  "a gated vacancy title behind a notice URL falls back to the filename (DOCUMENT)",
  (() => {
    const urlRow: VacancyAssertionRecord = {
      ...jobGateRow,
      field_name: "source_document",
      value: "https://example.com/files/notice.pdf",
    };
    const out = jobsFromAssertionRows([jobGateRow, urlRow]);
    return out.length === 1 && out[0].kind === "DOCUMENT" && out[0].title === "notice.pdf";
  })(),
);
check(
  "a real vacancy title publishes as POSTING",
  (() => {
    const out = jobsFromAssertionRows([{ ...jobGateRow, entity_id: "vacancy-mfi-001|Accountant", value: "Accountant" }]);
    return out.length === 1 && out[0].kind === "POSTING";
  })(),
);

// ---------------------------------------------------------------------------
// 5. Nothing fabricated — fields with no evidence stay visibly empty
// ---------------------------------------------------------------------------
console.log("PD-5 no fabricated fields");
check(
  "every document carries null official_url/go_slug/period (no such evidence exists)",
  docs.every((d) => d.official_url === null && d.go_slug === null && d.period === null),
);
check("every document status is ACTIVE or CONFLICT", docs.every((d) => d.status === "ACTIVE" || d.status === "CONFLICT"));
check("every document meta status is a real verification status", docs.every((d) => ["UNVERIFIED", "AUTO_VERIFIED", "HUMAN_VERIFIED", "CONFLICT"].includes(d.meta.verification_status)));
check(
  "every vacancy deadline is null (no deadline exists in evidence)",
  jobs.every((j) => j.deadline === null),
);
check(
  "every vacancy location is the unobserved placeholder (no location exists in evidence)",
  jobs.every((j) => j.location === "(location not observed)"),
);
check(
  "every vacancy type is the unobserved placeholder (no employment type exists in evidence)",
  jobs.every((j) => j.type === "(type not observed)"),
);

// ---------------------------------------------------------------------------
// 6. Conflict preservation — an OPEN cross-source dispute degrades the record
// ---------------------------------------------------------------------------
console.log("PD-6 conflict preservation");
// A publishable title row: the conflict must degrade the record, not drop it.
const conflictDocRow: DocumentAssertionRecord = {
  ...docGateRow,
  entity_id: "document-mfi-001|Annual Report 2082",
  value: "Annual Report 2082",
};
const conflictedDoc = documentsFromAssertionRows([conflictDocRow], {
  openConflictKeys: new Set([`${conflictDocRow.entity_id}|document_title`]),
});
check("an OPEN conflict marks the document CONFLICT", conflictedDoc.length === 1 && conflictedDoc[0].status === "CONFLICT");
check(
  "the conflict also lands in meta.verification_status",
  conflictedDoc.length === 1 && conflictedDoc[0].meta.verification_status === "CONFLICT",
);

const titledJobRow: VacancyAssertionRecord = { ...jobGateRow, entity_id: "vacancy-mfi-001|Accountant", value: "Accountant" };
const conflictedJob = jobsFromAssertionRows([titledJobRow], {
  openConflictKeys: new Set([`${titledJobRow.entity_id}|vacancy_title`]),
});
check(
  "an OPEN conflict reports the disputed title field on the vacancy",
  conflictedJob.length === 1 && conflictedJob[0].conflicts.includes("title") && conflictedJob[0].meta.verification_status === "CONFLICT",
);

const docConflictInput: EvidenceConflictRow[] = [
  { entity_id: "mfi-001", field_name: "document_title", value_a: "Annual Report 2082", value_b: "Annual Report 2081", institution_id: "mfi-001" },
];
const docConflictOut = documentConflictRows(docConflictInput);
check(
  "an institution-keyed document conflict becomes one canonical row per disputed title",
  docConflictOut.length === 2 &&
    docConflictOut.some((c) => c.entity_id === "document-mfi-001|Annual Report 2082" && c.field_name === "document_title") &&
    docConflictOut.some((c) => c.entity_id === "document-mfi-001|Annual Report 2081" && c.field_name === "document_title"),
);
check(
  "a document conflict with no resolved institution is skipped, never guessed",
  documentConflictRows([{ entity_id: "mfi-001", field_name: "document_title", value_a: "X", value_b: "Y", institution_id: null }]).length === 0,
);
check(
  "a canonical document conflict passes through",
  documentConflictRows([{ entity_id: "document-mfi-001|Annual Report 2082", field_name: "document_title", institution_id: null }]).length === 1,
);
const jobConflictOut = vacancyConflictRows([
  { entity_id: "mfi-001", field_name: "vacancy_title", value_a: "Accountant", value_b: "Accounts Officer", institution_id: "mfi-001" },
  { entity_id: "vacancy-pilot-9|https://example.com/old", field_name: "LOCATION", value_a: "Kathmandu", value_b: "Pokhara", institution_id: "mfi-002" },
]);
check(
  "an institution-keyed vacancy conflict synthesizes per disputed title, and an entity-keyed one re-keys only its institution segment",
  jobConflictOut.some((c) => c.entity_id === "vacancy-mfi-001|Accountant" && c.field_name === "vacancy_title") &&
    jobConflictOut.some((c) => c.entity_id === "vacancy-mfi-001|Accounts Officer" && c.field_name === "vacancy_title") &&
    jobConflictOut.some((c) => c.entity_id === "vacancy-mfi-002|https://example.com/old" && c.field_name === "LOCATION"),
);
check("openDocumentConflicts is an array of entity/field keys", Array.isArray(openDocumentConflicts) && openDocumentConflicts.every((c) => typeof c.entity_id === "string" && typeof c.field_name === "string"));

// ---------------------------------------------------------------------------
// 7. Cross-representation — the two vacancy shapes never merge and never
//    double-count: identity is per record, never matched on title similarity.
// ---------------------------------------------------------------------------
console.log("PD-7 cross-representation (no double counting)");
const jobKeys = jobs.map((j) => `${j.institutionSlug}\u0000${norm(j.title)}`);
check("no two vacancy records share (institution, title)", new Set(jobKeys).size === jobs.length);
check("no two document records share (institution, title)", new Set(docs.map((d) => `${d.institution_slug}\u0000${d.title}`)).size === docs.length);
// The one parsed JOB_TITLE assertion (an entity-keyed row) and the title-only
// vacancy_title rows for the same institution are disjoint in today's
// evidence; both publish, as separate records, because identity never comes
// from matching one representation's title against the other's.
const store = existsSync(storePath) ? new Database(storePath, { readonly: true }) : null;
if (store) {
  const jobTitleRows = store
    .prepare(
      `SELECT entity_id, value, source_id FROM data_assertions
        WHERE entity_type = 'VACANCY' AND field_name = 'JOB_TITLE'
          AND verification_status <> 'REJECTED' AND valid_to IS NULL`,
    )
    .all() as Row[];
  for (const r of jobTitleRows) {
    const inst = publisherResolvesTo(String(r.source_id));
    const published = jobs.filter((j) => j.institutionId === inst && norm(j.title) === norm(r.value));
    check(`the parsed JOB_TITLE "${norm(String(r.value)).slice(0, 40)}..." publishes exactly once`, published.length === 1);
    const sameTitleOnBoth = jobs.filter((j) => j.institutionId === inst && norm(j.title) === norm(r.value));
    check("it is one record, not one per representation", new Set(sameTitleOnBoth.map((j) => j.id)).size === sameTitleOnBoth.length);
  }
  store.close();
}

// ---------------------------------------------------------------------------
// 8. Determinism — the projection is a pure function of evidence
// ---------------------------------------------------------------------------
console.log("PD-8 determinism");
check(
  "document projection is deterministic across calls",
  JSON.stringify(documentsFromAssertionRows(documentAssertions as unknown as DocumentAssertionRecord[])) ===
    JSON.stringify(documentsFromAssertionRows(documentAssertions as unknown as DocumentAssertionRecord[])),
);
check(
  "vacancy projection is deterministic across calls",
  JSON.stringify(jobsFromAssertionRows(documentAssertions as unknown as VacancyAssertionRecord[])) ===
    JSON.stringify(jobsFromAssertionRows(documentAssertions as unknown as VacancyAssertionRecord[])),
);
check(
  "module document assertions contain no REJECTED rows",
  (documentAssertions as { verification_status: string }[]).every((r) => r.verification_status !== "REJECTED"),
);
check(
  "module document assertions contain no retired rows",
  (documentAssertions as { valid_to?: string | null }[]).every((r) => r.valid_to === null || r.valid_to === undefined),
);

// ---------------------------------------------------------------------------
// 9. API parity — the served layer is the same projection; the NRB documents
//    route keeps its own shape and is NOT repurposed for this layer.
// ---------------------------------------------------------------------------
console.log("PD-9 API parity");
const request = (method: string, url: string) => {
  const out = handleApiRequest({ method, url });
  return { status: out.status, body: JSON.parse(out.body) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const slugsWithJobs = [...new Set(jobs.map((j) => j.institutionSlug))];
check("at least one institution serves vacancies", slugsWithJobs.length > 0);
let apiTotalsMatched = 0;
for (const slug of slugsWithJobs) {
  const expected = jobs.filter((j) => j.institutionSlug === slug);
  const res = request("GET", `/api/institutions/${slug}/jobs?limit=100`);
  const ids = new Set((res.body.data as Array<{ id: string }>).map((j) => j.id));
  const ok =
    res.status === 200 &&
    res.body.pagination.total === expected.length &&
    expected.every((j) => ids.has(j.id));
  if (ok) apiTotalsMatched += 1;
}
check(`every institution's jobs route serves exactly its own records (${slugsWithJobs.length}/${slugsWithJobs.length})`, apiTotalsMatched === slugsWithJobs.length);
const anySlug = slugsWithJobs[0];
const apiJobs = (request("GET", `/api/institutions/${anySlug}/jobs?limit=100`).body.data as Array<{ deadline: string }>);
check("the API never invents a deadline string", apiJobs.every((j) => j.deadline === ""));

// Only links whose nrbDocumentId resolves are served as records.
const withNrbLinks = nrbInstitutionLinks.find((l) => l.institutionSlug && l.nrbDocumentId);
if (withNrbLinks) {
  const nrb = request("GET", `/api/institutions/${withNrbLinks.institutionSlug}/documents?limit=100`);
  check("the institution documents route still serves NRB documents", nrb.status === 200 && nrb.body.pagination.total > 0);
}
let nrbRouteUntouched = 0;
for (const slug of registrySlugs) {
  const res = request("GET", `/api/institutions/${slug}/documents?limit=100`);
  const hasGeneralIds = (res.body.data as Array<{ id: string }>).some((d) => String(d.id).startsWith("document-mfi-"));
  if (res.status === 200 && !hasGeneralIds) nrbRouteUntouched += 1;
}
check("the NRB documents route never leaks P2-D document ids (not repurposed)", nrbRouteUntouched === registrySlugs.size);

// ---------------------------------------------------------------------------
// 10. Evidence preserved + assertion-only (nothing structured was fabricated)
// ---------------------------------------------------------------------------
console.log("PD-10 evidence preserved, nothing seeded");
if (existsSync(storePath)) {
  const db = new Database(storePath, { readonly: true });
  const docRowCount = (db.prepare(
    `SELECT COUNT(*) c FROM data_assertions WHERE field_name IN ('document_title','notice_title')`,
  ).get() as { c: number }).c;
  const titleOnlyCount = (db.prepare(
    `SELECT COUNT(*) c FROM data_assertions WHERE entity_type = 'institution' AND field_name = 'vacancy_title'`,
  ).get() as { c: number }).c;
  const vacancyCount = (db.prepare(
    `SELECT COUNT(*) c FROM data_assertions WHERE entity_type = 'VACANCY'`,
  ).get() as { c: number }).c;
  check(`store document rows untouched by the builders (${docRowCount} = 445)`, docRowCount === 445);
  check(`store vacancy_title rows untouched (${titleOnlyCount} = 75)`, titleOnlyCount === 75);
  check(`store VACANCY rows untouched (${vacancyCount} = 38)`, vacancyCount === 38);
  db.close();
}
const lkPath = join(process.cwd(), "lk.db");
check("lk.db exists (run `npm run seed`)", existsSync(lkPath));
if (existsSync(lkPath)) {
  const db = new Database(lkPath, { readonly: true });
  const docTables = db.prepare("SELECT (SELECT COUNT(*) FROM documents) d, (SELECT COUNT(*) FROM jobs) j").get() as { d: number; j: number };
  db.close();
  check("lk.db documents table is NOT seeded (0 rows — no structured document evidence exists)", docTables.d === 0);
  check("lk.db jobs table is NOT seeded (0 rows — no structured job evidence exists)", docTables.j === 0);
}

console.log(`\nP2-D documents+jobs results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("ALL P2-D DOCUMENTS+JOBS TESTS PASSED.");
