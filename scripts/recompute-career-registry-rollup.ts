/**
 * Recompute the derived per-institution rollup of the career source registry
 * from the observations already in the file.
 *
 * Why this exists: `run-career-pilot.ts` counted one unread vacancy document per
 * page whose status was VACANCY_DOCUMENT_UNREAD, and reported that number in a
 * field called `unread_vacancy_documents`. Both halves of that were wrong. It
 * counted pages rather than documents, and it ignored pages that carry unread
 * vacancy notices but were classified by their text instead - a career root that
 * links three notices is a career root, not a page whose only finding is a
 * document. A scanned notice image counts too: it is as unreadable as a PDF. The
 * count now comes from the evidence links themselves, deduplicated by URL.
 *
 * This script applies that corrected rule to the committed registry WITHOUT
 * re-crawling anything. Every field describing what was observed - URLs, HTTP
 * status, content hashes, page shapes, record counts, timestamps - is copied
 * through untouched. Only the derived `institution_rollup` and the summary
 * counters that depend on it are recomputed, from those same observations.
 *
 * Re-running the pilot instead would fetch all 60 pages again and produce a
 * different artifact, because live pages change between requests; the observation
 * record in the audit refers to one specific crawl and must keep referring to it.
 *
 *   npm run recompute:career-registry
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { classifyDocumentLink } from "../lib/ingestion";

const REGISTRY = join(process.cwd(), "data", "pilot", "career-source-registry.json");

interface Page {
  institution_id: string | null;
  institution_name?: string | null;
  vacancy_candidates: number;
  status: string;
  /** Primary entries keep documents and images apart. */
  vacancy_document_links?: string[];
  image_links?: string[];
  /** Detail entries already hold documents and images together. */
  unread_vacancy_documents?: string[];
}

interface Registry {
  summary: Record<string, number>;
  institution_rollup: {
    institution_id: string;
    institution_name: string | null;
    pages_read: number;
    vacancy_records: number;
    unread_vacancy_documents: number;
    conclusion: string;
  }[];
  entries: Page[];
  detail_entries: Page[];
  [k: string]: unknown;
}

const docUrls = (p: Page): string[] => {
  if (p.unread_vacancy_documents) return p.unread_vacancy_documents;
  return [
    ...(p.vacancy_document_links ?? []),
    ...(p.image_links ?? []).filter((u) => classifyDocumentLink(u) === "VACANCY"),
  ];
};

const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as Registry;
const entries = registry.entries ?? [];
const detailEntries = registry.detail_entries ?? [];

interface Acc {
  name: string | null;
  pages: number;
  records: number;
  urls: Set<string>;
}
const byInstitution = new Map<string, Acc>();
for (const page of [...entries, ...detailEntries]) {
  const id = page.institution_id;
  if (!id) continue;
  const cur = byInstitution.get(id) ?? { name: page.institution_name ?? null, pages: 0, records: 0, urls: new Set<string>() };
  cur.pages++;
  cur.records += page.vacancy_candidates;
  for (const u of docUrls(page)) cur.urls.add(u);
  byInstitution.set(id, cur);
}

const rollup = [...byInstitution.entries()]
  .map(([institution_id, v]) => ({
    institution_id,
    institution_name: v.name,
    pages_read: v.pages,
    vacancy_records: v.records,
    unread_vacancy_documents: v.urls.size,
    conclusion:
      v.records > 0 ? "VACANCY_FOUND" : v.urls.size > 0 ? "VACANCY_EVIDENCE_UNREAD" : "NO_VACANCY_EVIDENCE",
  }))
  .sort((a, b) => (a.institution_id < b.institution_id ? -1 : 1));

const before = {
  total_documents: registry.institution_rollup.reduce((n, r) => n + r.unread_vacancy_documents, 0),
  institutions_with_documents: registry.institution_rollup.filter((r) => r.unread_vacancy_documents > 0).length,
  no_vacancy_evidence: registry.summary.institutions_with_no_vacancy_evidence,
};
const after = {
  total_documents: rollup.reduce((n, r) => n + r.unread_vacancy_documents, 0),
  institutions_with_documents: rollup.filter((r) => r.unread_vacancy_documents > 0).length,
  no_vacancy_evidence: rollup.filter((r) => r.conclusion === "NO_VACANCY_EVIDENCE").length,
};

// Only these keys are derived from the rollup. Everything else in `summary` is a
// tally of the primary entries and is left exactly as the crawl produced it.
registry.institution_rollup = rollup;
registry.summary = {
  ...registry.summary,
  institutions_with_vacancy_evidence: rollup.filter((r) => r.conclusion === "VACANCY_FOUND").length,
  institutions_with_unread_vacancy_documents: after.institutions_with_documents,
  unread_vacancy_documents_total: after.total_documents,
  institutions_with_no_vacancy_evidence: after.no_vacancy_evidence,
};

writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);

console.log("career registry rollup recomputed from existing observations (no network)");
console.log(`  unread vacancy documents : ${before.total_documents} -> ${after.total_documents}`);
console.log(`  institutions with them  : ${before.institutions_with_documents} -> ${after.institutions_with_documents}`);
console.log(`  NO_VACANCY_EVIDENCE     : ${before.no_vacancy_evidence} -> ${after.no_vacancy_evidence}`);
const concl: Record<string, number> = {};
for (const r of rollup) concl[r.conclusion] = (concl[r.conclusion] ?? 0) + 1;
console.log(`  conclusions             : ${JSON.stringify(concl)}`);
