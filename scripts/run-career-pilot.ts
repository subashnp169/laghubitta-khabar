// ============================================================================
// M3.5 — FIRST LIVE CAREER DISCOVERY PASS.
//
// One controlled fetch per located CAREER_PAGE URL (29 of the 51 sources have a
// non-null one), then a deterministic classification of each. No assertions are
// written. No vacancy is published here. This pass answers one question per
// source: what IS this URL, really?
//
//   real career source → controlled fetch → deterministic shape classification
//
// Bounds come from data/pilot/career-pilot-budget.json, which is DELIBERATELY
// separate from data/pilot/pilot-budget.json. The frozen production budget
// (defaults.maxFetches:18) is not read or changed by this script.
//
//   npx tsx scripts/run-career-pilot.ts
//
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { ControlledFetcher, nodeResolveHost } from "../lib/ingestion";
import { analyzeCareerPage, isRootUrl } from "../lib/ingestion";
import { CAREER_HREF_HINTS, extractCareerLinks, classifyDocumentLink } from "../lib/ingestion";
import { institutions } from "../data/master";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (p: string) => {
  prepare(s: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Array<Record<string, unknown>>; get(...a: unknown[]): Record<string, unknown> };
  exec(s: string): void;
  close(): void;
};

const BUDGET_FILE = "data/pilot/career-pilot-budget.json";
const SOURCES_FILE = "data/pilot/pilot-sources.json";
const OUT = "data/pilot/career-source-registry.json";
const DB = "data/pilot/evidence/pilot-careers-2026-09-29.db";

const NON_HTML_DOC_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip)$/i;
/** Images. A vacancy notice published as a JPG is evidence, never a parseable page. */
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|bmp|tiff?)$/i;

export type CareerSourceStatus =
  | "VACANCY_SOURCE_VERIFIED"
  | "CAREER_PAGE_NO_CURRENT_VACANCY"
  /**
   * The page yields no vacancy in HTML but links a document whose name declares a
   * vacancy. The system cannot read it, so it cannot say whether the vacancy is
   * open. Claiming `CAREER_PAGE_NO_CURRENT_VACANCY` here would assert something the
   * evidence does not support.
   */
  | "VACANCY_DOCUMENT_UNREAD"
  | "CAREER_ROOT"
  | "DOCUMENT_SOURCE"
  | "RESULT_LIST"
  | "UNREADABLE"
  | "UNSUPPORTED"
  | "UNKNOWN";

interface Cap {
  capability: string;
  status: string;
  known_url: string | null;
  link_type: string;
  note?: string;
}
interface Src {
  id: string;
  institution_id?: string;
  url: string;
  domain: string;
  title: string;
  capabilities: Cap[];
}

interface PhaseBudget {
  note?: string;
  maxTargets?: number;
  maxFetches: number;
  maxBytes: number;
  maxFetchesPerSource?: number;
}

interface DetailEntry {
  source_id: string;
  institution_id: string | null;
  url: string;
  final_url: string | null;
  http_status: number | null;
  content_type: string | null;
  bytes: number;
  content_hash: string | null;
  page_shape: string | null;
  shape_reason: string | null;
  vacancy_candidates: number;
  vacancy_titles_sample: string[];
  document_links: string[];
  image_links: string[];
  unread_vacancy_documents: string[];
  status: CareerSourceStatus;
  observed_at: string;
  fetch_error: string | null;
}

interface Usage {
  targets: number;
  fetches: number;
  bytes: number;
  startedAt: number;
  elapsedMs: number;
  maxFetches: number;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

interface Entry {
  institution_id: string | null;
  institution_slug: string | null;
  institution_name: string | null;
  source_id: string;
  url: string;
  final_url: string | null;
  capability: "CAREER_PAGE";
  discovery_method: string;
  discovery_note: string | null;
  http_status: number | null;
  content_type: string | null;
  bytes: number;
  content_hash: string | null;
  page_shape: string | null;
  shape_reason: string | null;
  vacancy_candidates: number;
  vacancy_titles_sample: string[];
  detail_links: string[];
  document_links: string[];
  /** Images linked as vacancy notices. Cannot be read; recorded, never parsed. */
  image_links: string[];
  /** Linked documents whose own name declares a vacancy. */
  vacancy_document_links: string[];
  /** Linked documents that declare a completed recruitment round. */
  result_document_links: string[];
  /** Linked application forms. Evidence a round ran, not of an open post. */
  form_document_links: string[];
  rendering_required: boolean;
  status: CareerSourceStatus;
  observed_at: string;
  fetch_error: string | null;
}

function apexOf(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** A host named career./jobs./vacancy./recruit. is a career surface by construction. */
function isCareerHost(raw: string): boolean {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return /^(?:career|careers|jobs?|vacanc(?:y|ies)|recruit(?:ment|ing)?)\./.test(h);
  } catch {
    return false;
  }
}

function isCareerishPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return CAREER_HREF_HINTS.some((h) => p.includes(h));
  } catch {
    return false;
  }
}

function policyFor(url: string, net: Record<string, number>) {
  const host = new URL(url).hostname.toLowerCase();
  const apex = apexOf(host);
  return {
    allowedHosts: apex === host ? [host] : [host, apex],
    allowSubdomainsOf: [apex],
    maxBytes: net.maxBytes,
    maxRedirects: net.maxRedirects,
    maxRetries: net.maxRetries,
    timeoutMs: net.timeoutMs,
    minIntervalMs: net.minIntervalMs,
    resolveHost: nodeResolveHost,
  };
}

/**
 * Classify a linked document by what its own name declares.
 *
 * The implementation is `classifyDocumentLink` in the discovery library, so the
 * smoke can prove the rule and the pilot can use the same one.
 */

function classify(e: {
  fetchError: string | null;
  httpStatus: number | null;
  bytes: number;
  isDocument: boolean;
  shape: string;
  records: number;
  url: string;
  finalUrl: string;
  careerVocabHits: number;
  jobRoleHits: number;
  vacancyDocumentLinks: readonly string[];
}): CareerSourceStatus {
  // A page that could not be read is NEVER "no vacancies".
  if (e.fetchError) return "UNREADABLE";
  if (e.httpStatus === null || e.httpStatus < 200 || e.httpStatus >= 300 || e.bytes === 0) {
    return "UNREADABLE";
  }
  if (e.isDocument) return "DOCUMENT_SOURCE";
  if (e.shape === "RECRUITMENT_RESULT_PAGE") return "RESULT_LIST";
  if (e.shape === "CLIENT_RENDERED_SHELL") return "UNSUPPORTED";
  // A page that renders its vacancies only after its own script runs has told us
  // it has a vacancy section. It has not told us what is in it, so the state is
  // unknown rather than empty.
  if (e.shape === "CAREER_CONTENT_CLIENT_LOADED") return "UNSUPPORTED";
  if (e.records > 0) return "VACANCY_SOURCE_VERIFIED";
  // A linked vacancy notice this system cannot read means the page is not empty —
  // it means the evidence is incomplete. Those are different, and only the second
  // one may be published as "no current vacancy".
  if (e.vacancyDocumentLinks.length > 0) return "VACANCY_DOCUMENT_UNREAD";
  if (isRootUrl(e.url) && !isCareerHost(e.url) && isRootUrl(e.finalUrl)) return "CAREER_ROOT";
  if (isCareerHost(e.url) || isCareerishPath(e.url) || e.careerVocabHits > 0 || e.jobRoleHits > 0) {
    return "CAREER_PAGE_NO_CURRENT_VACANCY";
  }
  return "UNKNOWN";
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * A page shape for every entry, including the ones no analyser could read.
 *
 * A null `page_shape` is not reviewable: in the artifact it cannot be told apart from
 * a field that was simply forgotten, and a reviewer counting classifications would
 * silently drop those rows. So when the grammar produced nothing, the reason it
 * produced nothing becomes the shape — a PDF and a host that refused plain HTTP are
 * different findings and must not share a blank.
 */
function shapeOf(
  analysis: ReturnType<typeof analyzeCareerPage> | null,
  facts: {
    contentType: string | null;
    bytes: number;
    url: string;
    httpStatus: number | null;
    fetchError?: string | null;
  },
): { shape: string; reason: string } {
  // A non-2xx response is not a page this milestone can read, whatever the body says.
  // Reporting the shape of an error page as if it were content would let
  // `page_shape: NOT_A_CAREER_PAGE` sit next to `status: UNREADABLE` and read as
  // "this institution has no careers page" when the truth is "this request failed".
  const ok = facts.httpStatus !== null && facts.httpStatus >= 200 && facts.httpStatus < 300;
  if (analysis && ok) return { shape: analysis.shape, reason: analysis.reason };
  if (!ok) {
    return {
      shape: "UNREADABLE_BODY",
      reason:
        facts.httpStatus === null
          ? "no HTTP status was recorded, so the response cannot be treated as a page"
          : `http ${facts.httpStatus} is not a success, so the body is an error response rather than a page`,
    };
  }
  if (facts.fetchError) {
    return { shape: "UNREADABLE_BODY", reason: `the fetch did not complete: ${facts.fetchError}` };
  }
  if (facts.bytes === 0) {
    return { shape: "UNREADABLE_BODY", reason: "the response carried no body to read" };
  }
  const lowerCt = (facts.contentType ?? "").toLowerCase();
  if (lowerCt.includes("application/pdf") || NON_HTML_DOC_EXT.test(new URL(facts.url).pathname)) {
    return {
      shape: "DOCUMENT_NOT_HTML",
      reason: `a document (${facts.contentType ?? "by extension"}), not a page the HTML grammar reads; its text is not extracted`,
    };
  }
  return {
    shape: "UNREADABLE_BODY",
    reason: "the response was read but no page shape could be determined from it",
  };
}

/** Prefer HTML/text links; keep only same-host detail pages and same-host PDFs. */
function linksFrom(html: string, pageUrl: string, host: string): { details: string[]; documents: string[]; images: string[] } {
  const details: string[] = [];
  const documents: string[] = [];
  const images: string[] = [];
  const apex = apexOf(host);
  for (const link of extractCareerLinks(html, host)) {
    if (!link.url) continue;
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      continue;
    }
    const h = u.hostname.toLowerCase();
    if (h !== apex && !h.endsWith(`.${apex}`) && !apexOf(h).endsWith(apex)) continue;
    if (IMAGE_EXT.test(u.pathname)) {
      // The pilot found vacancy notices published only as images, named
      // `/images/gallery/vacancy-*.jpg`. Routing them as detail pages would claim
      // a parseable page exists where there is a picture of one.
      images.push(`${u.origin}${u.pathname}`);
      continue;
    }
    if (NON_HTML_DOC_EXT.test(u.pathname)) {
      if (/\.pdf$/i.test(u.pathname)) documents.push(`${u.origin}${u.pathname}`);
      continue;
    }
    if (isCareerishPath(link.url)) details.push(`${u.origin}${u.pathname}`);
    void pageUrl;
  }
  return { details: dedupe(details), documents: dedupe(documents), images: dedupe(images) };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const cfg = readJson<{
    shared: Record<string, number>;
    phases: { primary: PhaseBudget; detail: PhaseBudget };
  }>(BUDGET_FILE);
  const primaryBudget = cfg.phases.primary;
  const detailBudget = cfg.phases.detail;
  const net: Record<string, number> = { ...cfg.shared, maxBytes: primaryBudget.maxBytes };
  const pilot = readJson<{ sources: Src[] }>(SOURCES_FILE);
  const byInst = new Map(institutions.map((i) => [i.id, i]));

  mkdirSync("data/pilot/evidence", { recursive: true });
  const db = new Database(DB);
  // The frozen schema uses bare CREATE TABLE, so it can only be applied to a
  // brand-new database. Re-running the pilot against an existing evidence
  // database must not attempt it again.
  const hasSchema = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sources'").get() as
      | { name?: string }
      | undefined
  )?.name === "sources";
  if (!hasSchema) db.exec(readFileSync("schema/schema.sql", "utf8"));

  const targets: Array<{ s: Src; cap: Cap }> = [];
  for (const s of pilot.sources) {
    for (const cap of s.capabilities) {
      if (cap.capability === "CAREER_PAGE" && cap.known_url) targets.push({ s, cap });
    }
  }
  console.log(`career targets with a located URL: ${targets.length} (budget maxTargets ${primaryBudget.maxTargets})`);

  // Source rows first: source_snapshots has an FK to sources(id).
  const insSrc = db.prepare(
    `INSERT OR IGNORE INTO sources (id, source_type, source_scope, source_grade, url, domain, title, publisher, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
  );
  for (const { s } of targets) {
    insSrc.run(s.id, "MFB_WEBSITE", "INSTITUTION", "A", s.url, s.domain, s.title, s.institution_id ?? null, new Date().toISOString());
  }

  const entries: Entry[] = [];
  let fetches = 0;
  let bytes = 0;

  for (const [i, t] of targets.entries()) {
    if (fetches >= primaryBudget.maxFetches || Date.now() - startedAt > net.maxRuntimeMs) {
      console.log(`  budget reached at ${t.s.id}; remaining sources recorded UNKNOWN`);
      entries.push(blankEntry(t, byInst, "budget exhausted before this source was checked"));
      continue;
    }
    const fetcher = new ControlledFetcher(policyFor(t.cap.known_url as string, net));
    const observedAt = new Date().toISOString();
    let fetchError: string | null = null;
    let r: Awaited<ReturnType<typeof fetcher.fetchControlled>>["result"] | null = null;
    fetches++;
    try {
      r = (await fetcher.fetchControlled({
        url: t.cap.known_url as string,
        requestId: `m35-career-${i}`,
      })).result;
      bytes += r.bodyBytes;
    } catch (e) {
      fetchError = (e as { message?: string }).message ?? String(e);
    }

    const inst = t.s.institution_id ? byInst.get(t.s.institution_id) : undefined;
    const url = t.cap.known_url as string;
    const host = new URL(url).hostname.toLowerCase();
    const contentType = r?.contentType ?? null;
    const lowerCt = (contentType ?? "").toLowerCase();
    const isDocument = lowerCt.includes("application/pdf") || NON_HTML_DOC_EXT.test(new URL(url).pathname);

    let analysis: ReturnType<typeof analyzeCareerPage> | null = null;
    let detailLinks: string[] = [];
    let documentLinks: string[] = [];
    let imageLinks: string[] = [];
    let snapId: string | null = null;

    if (r && r.bodyBytes > 0) {
      const contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");
      snapId = createHash("sha256").update(`snapshot|${t.s.id}|${r.finalUrl}`).digest("hex").slice(0, 16);
      db.prepare(
        `INSERT OR IGNORE INTO source_snapshots (id, source_id, fetched_at, content_hash, http_status, mime_type, parser_version, extraction_status)
         VALUES (?,?,?,?,?,?, 'career-discovery-v1', 'SKIPPED')`,
      ).run(`snap-m35disc-${snapId}`, t.s.id, r.fetchedAt, contentHash, r.httpStatus, contentType);

      if (!isDocument) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(r.body);
        let json: unknown[] | undefined;
        if (lowerCt.includes("json")) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (Array.isArray(parsed)) json = parsed;
            else if (parsed && typeof parsed === "object") {
              const cand = Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
              if (Array.isArray(cand)) json = cand;
            }
          } catch {
            /* not JSON after all */
          }
        }
        analysis = analyzeCareerPage({
          body: r.body,
          contentType,
          url: r.finalUrl,
          httpStatus: r.httpStatus ?? 0,
          json,
        });
        const links = linksFrom(text, r.finalUrl, host);
        detailLinks = links.details;
        documentLinks = links.documents;
        imageLinks = links.images;
      } else if (/\.pdf$/i.test(new URL(url).pathname)) {
        documentLinks = [url];
      }
    }

    // An unread vacancy notice in ANY format leaves the page's vacancy state
    // unknown. A notice published only as a JPG is exactly that.
    const unreadVacancyEvidence = [
      ...documentLinks.filter((d) => classifyDocumentLink(d) === "VACANCY"),
      ...imageLinks.filter((d) => classifyDocumentLink(d) === "VACANCY"),
    ];
    const vacancyDocs = documentLinks.filter((d) => classifyDocumentLink(d) === "VACANCY");
    const resultDocs = documentLinks.filter((d) => classifyDocumentLink(d) === "RESULT");
    const formDocs = documentLinks.filter((d) => classifyDocumentLink(d) === "FORM");

    const status = classify({
      fetchError,
      httpStatus: r?.httpStatus ?? null,
      bytes: r?.bodyBytes ?? 0,
      isDocument,
      shape: analysis?.shape ?? "UNREADABLE_BODY",
      records: analysis?.records.length ?? 0,
      url,
      finalUrl: r?.finalUrl ?? url,
      careerVocabHits: analysis?.counts.careerVocabHits ?? 0,
      jobRoleHits: analysis?.counts.jobRoleHits ?? 0,
      vacancyDocumentLinks: unreadVacancyEvidence,
    });

    const shape = shapeOf(analysis, { contentType, bytes: r?.bodyBytes ?? 0, url, httpStatus: r?.httpStatus ?? null, fetchError });
    const entry: Entry = {
      institution_id: t.s.institution_id ?? null,
      institution_slug: inst?.slug ?? null,
      institution_name: inst?.name_en ?? null,
      source_id: t.s.id,
      url,
      final_url: r?.finalUrl ?? null,
      capability: "CAREER_PAGE",
      discovery_method: t.cap.link_type,
      discovery_note: t.cap.note ?? null,
      http_status: r?.httpStatus ?? null,
      content_type: contentType,
      bytes: r?.bodyBytes ?? 0,
      content_hash: r ? (r.contentHash ?? null) : null,
      page_shape: shape.shape,
      shape_reason: shape.reason,
      vacancy_candidates: analysis?.records.length ?? 0,
      vacancy_titles_sample: (analysis?.records ?? []).slice(0, 5).map((x) => x.title),
      detail_links: detailLinks,
      document_links: documentLinks,
      vacancy_document_links: vacancyDocs,
      result_document_links: resultDocs,
      form_document_links: formDocs,
      image_links: imageLinks,
      rendering_required: status === "UNSUPPORTED",
      status,
      observed_at: observedAt,
      fetch_error: fetchError,
    };
    entries.push(entry);
    console.log(
      `  ${t.s.id.padEnd(26)} ${String(entry.http_status ?? "-").padStart(3)} ${(contentType ?? "-").split(";")[0].padEnd(24)} ${String(entry.page_shape ?? "-").padEnd(24)} vac=${String(entry.vacancy_candidates).padStart(2)}  ${status}${fetchError ? `  [${fetchError}]` : ""}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Detail phase — the career sub-pages the primary pass found.
  //
  // The primary pass alone cannot answer the question the pilot exists to answer.
  // Most of these institutions publish openings on a /careers sub-page, not on the
  // located root, and one root even links `/careers/vacancy-2083-asoj`. Recording a
  // root with no vacancy as "no current vacancy" would then be a statement about a
  // page, not about the institution. So the sub-pages are fetched and analysed on
  // their own evidence.
  // ---------------------------------------------------------------------------
  const detailSeen = new Set(entries.map((e) => e.url));
  const detailTargets: Array<{ url: string; sourceId: string; institutionId: string | null }> = [];
  for (const e of entries) {
    let taken = 0;
    for (const u of e.detail_links) {
      if (taken >= (detailBudget.maxFetchesPerSource ?? 3)) break;
      if (detailSeen.has(u)) continue;
      detailSeen.add(u);
      detailTargets.push({ url: u, sourceId: e.source_id, institutionId: e.institution_id });
      taken++;
    }
  }
  console.log(
    `\ndetail phase: ${detailTargets.length} same-host career sub-page(s) ` +
      `(cap ${detailBudget.maxFetchesPerSource}/source, ${detailBudget.maxFetches} total)`,
  );

  const detailEntries: DetailEntry[] = [];
  let detailFetches = 0;
  let detailBytes = 0;
  for (const [i, t] of detailTargets.entries()) {
    if (
      detailFetches >= detailBudget.maxFetches ||
      detailBytes >= detailBudget.maxBytes ||
      Date.now() - startedAt > net.maxRuntimeMs
    ) {
      console.log(`  detail budget reached before ${t.url}`);
      break;
    }
    const observedAt = new Date().toISOString();
    let fetchError: string | null = null;
    let r: Awaited<ReturnType<ControlledFetcher["fetchControlled"]>>["result"] | null = null;
    detailFetches++;
    try {
      r = (await new ControlledFetcher(policyFor(t.url, { ...net, maxBytes: detailBudget.maxBytes }))
        .fetchControlled({ url: t.url, requestId: `m35-career-detail-${i}` })).result;
      detailBytes += r.bodyBytes;
    } catch (e) {
      fetchError = (e as { message?: string }).message ?? String(e);
    }

    const contentType = r?.contentType ?? null;
    const lowerCt = (contentType ?? "").toLowerCase();
    const isDoc = lowerCt.includes("application/pdf") || NON_HTML_DOC_EXT.test(new URL(t.url).pathname);
    let analysis: ReturnType<typeof analyzeCareerPage> | null = null;
    let documentLinks: string[] = [];
    let imageLinks: string[] = [];
    if (r && r.bodyBytes > 0) {
      const contentHash = r.contentHash || createHash("sha256").update(r.body).digest("hex");
      const snapId = createHash("sha256").update(`snapshot|${t.url}|${r.finalUrl}`).digest("hex").slice(0, 16);
      db.prepare(
        `INSERT OR IGNORE INTO source_snapshots (id, source_id, fetched_at, content_hash, http_status, mime_type, parser_version, extraction_status)
         VALUES (?,?,?,?,?,?, 'career-discovery-v1', 'SKIPPED')`,
      ).run(`snap-m35det-${snapId}`, t.sourceId, r.fetchedAt, contentHash, r.httpStatus, contentType);

      if (!isDoc) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(r.body);
        analysis = analyzeCareerPage({
          body: r.body,
          contentType,
          url: r.finalUrl,
          httpStatus: r.httpStatus ?? 0,
        });
        const links = linksFrom(text, r.finalUrl, new URL(r.finalUrl).hostname.toLowerCase());
        documentLinks = links.documents;
        imageLinks = links.images;
      } else if (/\.pdf$/i.test(new URL(t.url).pathname)) {
        documentLinks = [t.url];
      }
    }

    const unread = [...documentLinks, ...imageLinks].filter((u) => classifyDocumentLink(u) === "VACANCY");
    const status = classify({
      fetchError,
      httpStatus: r?.httpStatus ?? null,
      bytes: r?.bodyBytes ?? 0,
      isDocument: isDoc,
      shape: analysis?.shape ?? "UNREADABLE_BODY",
      records: analysis?.records.length ?? 0,
      url: t.url,
      finalUrl: r?.finalUrl ?? t.url,
      careerVocabHits: analysis?.counts.careerVocabHits ?? 0,
      jobRoleHits: analysis?.counts.jobRoleHits ?? 0,
      vacancyDocumentLinks: unread,
    });
    const shape = shapeOf(analysis, { contentType, bytes: r?.bodyBytes ?? 0, url: t.url, httpStatus: r?.httpStatus ?? null, fetchError });
    detailEntries.push({
      source_id: t.sourceId,
      institution_id: t.institutionId,
      url: t.url,
      final_url: r?.finalUrl ?? null,
      http_status: r?.httpStatus ?? null,
      content_type: contentType,
      bytes: r?.bodyBytes ?? 0,
      content_hash: r ? (r.contentHash ?? null) : null,
      page_shape: shape.shape,
      shape_reason: shape.reason,
      vacancy_candidates: analysis?.records.length ?? 0,
      vacancy_titles_sample: (analysis?.records ?? []).slice(0, 5).map((x) => x.title),
      document_links: documentLinks,
      image_links: imageLinks,
      unread_vacancy_documents: unread,
      status,
      observed_at: observedAt,
      fetch_error: fetchError,
    });
    console.log(
      `  ${t.url.slice(0, 78).padEnd(78)} ${String(r?.httpStatus ?? "-").padStart(3)} ${String(analysis?.records.length ?? 0).padStart(2)} rec  ${status}`,
    );
  }

  /**
   * The headline question is per institution, not per page, so it is answered per
   * institution: an institution is a vacancy source if ANY page of its own
   * produced a vacancy record.
   */
  const byInstitution = new Map<
    string,
    { name: string | null; pages: number; records: number; unread: number; unreadUrls: Set<string> }
  >();
  /**
   * The unread vacancy evidence a page carries, whether or not its own status says so.
   *
   * A page can hold unread vacancy notices and still be classified by what its
   * text proved - a career root that happens to link three notices is a career
   * root, not a page whose only finding is an unread document. Counting evidence
   * only where the status happened to be VACANCY_DOCUMENT_UNREAD therefore loses
   * real evidence, and counting one per page reports a page count in a field
   * whose name says documents. Both are wrong, so the count is taken from the
   * links themselves and deduplicated by URL.
   *
   * A scanned notice image counts. It is exactly as unreadable as a PDF, and a
   * page whose only vacancy evidence is a JPG is not an institution with no
   * vacancies. Detail entries already store documents and images together;
   * primary entries keep them apart, so both are consulted here.
   */
  const vacancyDocumentUrls = (page: Entry | DetailEntry): string[] => {
    const detail = (page as DetailEntry).unread_vacancy_documents;
    if (detail) return detail;
    const primary = page as Entry;
    return [
      ...(primary.vacancy_document_links ?? []),
      ...(primary.image_links ?? []).filter((u) => classifyDocumentLink(u) === "VACANCY"),
    ];
  };

  const bump = (id: string | null, name: string | null, page: Entry | DetailEntry) => {
    if (!id) return;
    const cur = byInstitution.get(id) ?? { name, pages: 0, records: 0, unread: 0, unreadUrls: new Set<string>() };
    cur.pages++;
    cur.records += page.vacancy_candidates;
    for (const u of vacancyDocumentUrls(page)) cur.unreadUrls.add(u);
    byInstitution.set(id, cur);
  };
  for (const e of entries) bump(e.institution_id, e.institution_name, e);
  for (const d of detailEntries) bump(d.institution_id, byInst.get(d.institution_id ?? "")?.name_en ?? null, d);
  const rollup = [...byInstitution.entries()]
    .map(([id, v]) => ({
      institution_id: id,
      institution_name: v.name,
      pages_read: v.pages,
      vacancy_records: v.records,
      unread_vacancy_documents: v.unreadUrls.size,
      conclusion:
        v.records > 0 ? "VACANCY_FOUND" : v.unreadUrls.size > 0 ? "VACANCY_EVIDENCE_UNREAD" : "NO_VACANCY_EVIDENCE",
    }))
    .sort((a, b) => (a.institution_id < b.institution_id ? -1 : 1));

  const tally = (s: CareerSourceStatus): number => entries.filter((e) => e.status === s).length;
  const usage: Usage = {
    targets: targets.length,
    fetches: fetches + detailFetches,
    bytes: bytes + detailBytes,
    startedAt,
    elapsedMs: Date.now() - startedAt,
    maxFetches: primaryBudget.maxFetches + detailBudget.maxFetches,
    maxBytes: primaryBudget.maxBytes + detailBudget.maxBytes,
    timeoutMs: net.timeoutMs,
    maxRedirects: net.maxRedirects,
  };
  const summary = {
    located_career_urls: targets.length,
    vacancy_sources: tally("VACANCY_SOURCE_VERIFIED"),
    vacancy_document_unread: tally("VACANCY_DOCUMENT_UNREAD"),
    career_page_no_current_vacancy: tally("CAREER_PAGE_NO_CURRENT_VACANCY"),
    career_roots: tally("CAREER_ROOT"),
    document_sources: tally("DOCUMENT_SOURCE"),
    result_lists: tally("RESULT_LIST"),
    unreadable: tally("UNREADABLE"),
    unsupported: tally("UNSUPPORTED"),
    unknown: tally("UNKNOWN"),
    rendering_required: entries.filter((e) => e.rendering_required).length,
    produce_detail_page_candidates: entries.filter((e) => e.detail_links.length > 0).length,
    produce_document_candidates: entries.filter((e) => e.document_links.length > 0).length,
    total_vacancy_candidates: entries.reduce((n, e) => n + e.vacancy_candidates, 0),
    detail_pages_read: detailEntries.length,
    detail_vacancy_candidates: detailEntries.reduce((n, d) => n + d.vacancy_candidates, 0),
    institutions_with_vacancy_evidence: rollup.filter((r) => r.conclusion === "VACANCY_FOUND").length,
    // Counted from the documents themselves, not from the conclusion: an
    // institution whose own page also carried a readable vacancy still has
    // unread notices behind it, and hiding that behind its conclusion would
    // understate how much is known only as a file nobody has read.
    institutions_with_unread_vacancy_documents: rollup.filter((r) => r.unread_vacancy_documents > 0).length,
    unread_vacancy_documents_total: rollup.reduce((n, r) => n + r.unread_vacancy_documents, 0),
    institutions_with_no_vacancy_evidence: rollup.filter((r) => r.conclusion === "NO_VACANCY_EVIDENCE").length,
  };

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        $schema: "career-source-registry/v1",
        generated_at: new Date().toISOString(),
        purpose:
          "Classify each located CAREER_PAGE URL as a real vacancy source or not. Observation only: pilot-sources.json is NOT modified and no source's committed truth is overwritten by this file.",
        budget_file: BUDGET_FILE,
        usage,
        summary,
        institution_rollup: rollup,
        entries,
        detail_entries: detailEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  db.close();

  console.log("\nsummary:");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(`\nusage: fetches ${usage.fetches}/${usage.maxFetches}  bytes ${usage.bytes}  elapsed ${usage.elapsedMs}ms`);
  console.log(`registry: ${OUT}`);
  console.log(`evidence db: ${DB}`);
}

function blankEntry(
  t: { s: Src; cap: Cap },
  byInst: Map<string, { slug: string; name_en: string }>,
  note: string,
): Entry {
  const inst = t.s.institution_id ? byInst.get(t.s.institution_id) : undefined;
  return {
    institution_id: t.s.institution_id ?? null,
    institution_slug: inst?.slug ?? null,
    institution_name: inst?.name_en ?? null,
    source_id: t.s.id,
    url: t.cap.known_url as string,
    final_url: null,
    capability: "CAREER_PAGE",
    discovery_method: t.cap.link_type,
    discovery_note: t.cap.note ?? null,
    http_status: null,
    content_type: null,
    bytes: 0,
    content_hash: null,
    page_shape: null,
    shape_reason: null,
    vacancy_candidates: 0,
    vacancy_titles_sample: [],
    detail_links: [],
      document_links: [],
      image_links: [],
      vacancy_document_links: [],
      result_document_links: [],
      form_document_links: [],
    rendering_required: false,
    status: "UNKNOWN",
    observed_at: new Date().toISOString(),
    fetch_error: note,
  };
}

void main();
