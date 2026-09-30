// ============================================================================
// M3.5 — Dynamic career source investigation.
//
// Answers one question: can the official same-origin endpoints behind these career
// pages provide deterministic machine-readable vacancy data?
//
// Method, in order, and deliberately in this order:
//
//   1. Read the page's own script as TEXT. Nothing is executed. No browser.
//
//   2. Every URL literal found in a request call is recorded with the call that
//      produced it, so each candidate can be checked by reading its source.
//
//   3. A candidate must be same-site and HTTPS to be probed at all, and it is
//      probed with the same ControlledFetcher policy a page gets. Credentials,
//      third-party hosts, plain HTTP and cross-domain redirects are refused by
//      that policy, not by a rule added here.
//
//   4. The response is classified by content type and body, never by a guess, and
//      no field is extracted from a response that is not structured data.
//
// Output: data/pilot/career-dynamic-sources.json. Nothing here writes to `jobs`.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ControlledFetcher, nodeResolveHost } from "../lib/ingestion";
import {
  extractEndpointCandidates,
  externalScriptUrls,
  isSameSite,
  type EndpointCandidate,
} from "../lib/ingestion/career-endpoints";
import { mapEnvelopeToVacancies } from "../lib/ingestion/career-json";

/**
 * The verdict vocabulary, fixed by the investigation brief. A source is given
 * exactly one of these, and `BROWSER_REQUIRED` is only ever used when the page
 * proves it — which, as it turns out, none of them do.
 */
export type SourceClassification =
  | "MACHINE_READABLE"
  | "HTML_FRAGMENT"
  | "JSON_EMBEDDED"
  | "BROWSER_REQUIRED"
  | "SESSION_REQUIRED"
  | "UNSUPPORTED"
  | "NO_ENDPOINT_FOUND";

function classifySource(probes: ProbeResult[], vacancyRecords: number): SourceClassification {
  if (probes.length === 0) return "NO_ENDPOINT_FOUND";
  if (probes.some((p) => p.responseClass === "REQUIRES_AUTH")) return "SESSION_REQUIRED";
  const structured = probes.filter((p) => p.responseClass === "JSON" || p.responseClass === "JSON_IN_HTML");
  if (structured.length > 0) return vacancyRecords > 0 ? "MACHINE_READABLE" : "JSON_EMBEDDED";
  if (probes.some((p) => p.responseClass === "HTML_FRAGMENT")) return "HTML_FRAGMENT";
  if (probes.some((p) => p.responseClass === "REQUIRES_POST")) return "UNSUPPORTED";
  return "UNSUPPORTED";
}

// --- bounds -----------------------------------------------------------------

/**
 * Research-only limits for this investigation, declared here and recorded in its
 * output. The pilot's own primary/detail budget covered the discovery pass; this is
 * a separate, larger scan because a negative result is only worth as much as the
 * population it covered, and 59 pages plus their own scripts need more than the
 * discovery pass allowed.
 */
const MAX_PAGE_FETCHES = 70;
const MAX_SCRIPT_FETCHES = 45;
const MAX_PROBES = 24;
const MAX_BYTES_TOTAL = 16_777_216;
const MAX_BYTES_PER_RESPONSE = 2_097_152;
const TIMEOUT_MS = 20_000;
const MIN_INTERVAL_MS = 300;

/**
 * Scan every page the pilot read, not only the ones the shape classifier flagged.
 *
 * The first pass scanned the flagged pages and found one endpoint in six
 * institutions. That is a thin basis for a claim that no institution has a data
 * endpoint, because the flag itself was the thing under suspicion — it had just been
 * corrected for counting form actions and jQuery. A negative result is only
 * meaningful if the search covered the population, so this scans all of them.
 */
const SCOPE: "flagged" | "all" = (process.env.M35_SCOPE as "flagged" | "all" | undefined) ?? "all";

/**
 * Script files that cannot contain a site-specific endpoint. Reading jQuery,
 * Bootstrap and a carousel library costs a fetch and returns only their own
 * internals; the first run of this investigation spent a third of its budget on
 * them.
 */
const VENDOR_SCRIPT_RE =
  /(?:jquery|jquery-migrate|bootstrap|popper|slick|owl|carousel|magnific|lightbox|modernizr|css3-animate-it|scrollit|scrollUp|navik|cloudflare-static|email-decode|popperjs|waypoints|wow|fontawesome|owl\.carousel|mixitup|typed)/i;

// --- response classification ------------------------------------------------

export type ResponseClass =
  | "JSON"
  | "JSON_IN_HTML"
  | "HTML_FRAGMENT"
  | "HTML_PAGE"
  | "XML"
  | "PLAIN_TEXT"
  | "UNAVAILABLE"
  | "REQUIRES_POST"
  | "REQUIRES_AUTH"
  | "REDIRECTED_OFF_SITE"
  | "FETCH_REFUSED"
  | "EMPTY";

export interface ProbeResult {
  url: string;
  method: string;
  httpStatus: number | null;
  contentType: string;
  bytes: number;
  responseClass: ResponseClass;
  /** Only for JSON: the top-level shape, never the content. */
  jsonShape?: string;
  /** Only for JSON: how many items the array holds, never the items. */
  jsonItemCount?: number;
  /** Vacancy records the generic envelope mapper extracted. Zero is a real answer. */
  vacancyRecordsFound?: number;
  /** The generic mapper's own verdict on the payload, and anything it warned about. */
  mapping?: { envelopeShape: string; arrayKey: string | null; fragmentCount: number; warnings: string[] };
  /** A short, quoted excerpt kept for a human to judge the shape. */
  excerpt?: string;
  error?: string;
}

function classifyResponse(args: {
  httpStatus: number | null;
  contentType: string;
  body: string;
  bytes: number;
  finalUrl: string;
  requestUrl: string;
  error?: string;
}): ProbeResult {
  const base = {
    url: args.requestUrl,
    method: "GET",
    httpStatus: args.httpStatus,
    contentType: args.contentType,
    bytes: args.bytes,
  };
  if (args.error) return { ...base, responseClass: "FETCH_REFUSED", error: args.error };
  if (args.httpStatus === 401 || args.httpStatus === 403) {
    return { ...base, responseClass: "REQUIRES_AUTH" };
  }
  if (args.httpStatus === 405) return { ...base, responseClass: "REQUIRES_POST" };
  if (args.httpStatus !== null && (args.httpStatus < 200 || args.httpStatus >= 300)) {
    return { ...base, responseClass: "UNAVAILABLE" };
  }
  if (!isSameSite(args.finalUrl, args.requestUrl)) {
    return { ...base, responseClass: "REDIRECTED_OFF_SITE" };
  }
  if (args.bytes === 0) return { ...base, responseClass: "EMPTY" };

  const ct = args.contentType.toLowerCase();
  const body = args.body.trim();
  const excerpt = body.slice(0, 400);

  if (ct.includes("json") || /^\s*[[{]/.test(body)) {
    try {
      const parsed: unknown = JSON.parse(body);
      // The same generic mapper the pipeline would use, run against the live
      // payload. Its record count is the answer to the investigation, and it is
      // allowed to be zero.
      const mapping = mapEnvelopeToVacancies(parsed, args.requestUrl, (u) => isSameSite(u, args.requestUrl));
      const withMapping = {
        vacancyRecordsFound: mapping.records.length,
        mapping: {
          envelopeShape: mapping.description.shape,
          arrayKey: mapping.description.arrayKey,
          fragmentCount: mapping.fragmentCount,
          warnings: mapping.warnings,
        },
      };
      if (Array.isArray(parsed)) {
        return { ...base, responseClass: "JSON", jsonShape: "array", jsonItemCount: parsed.length, excerpt, ...withMapping };
      }
      if (parsed !== null && typeof parsed === "object") {
        const keys = Object.keys(parsed as Record<string, unknown>);
        // A payload that wraps its rows under one key is the common shape and the
        // one a generic mapper must handle. Naming the key is naming the contract,
        // which is the whole point of this step.
        const arrayKeys = keys.filter(
          (k) => Array.isArray((parsed as Record<string, unknown>)[k]),
        );
        return {
          ...base,
          responseClass: "JSON",
          jsonShape: arrayKeys.length === 1 ? `object with array key "${arrayKeys[0]}"` : `object with keys: ${keys.slice(0, 8).join(", ")}`,
          jsonItemCount: arrayKeys.length === 1
            ? ((parsed as Record<string, unknown>)[arrayKeys[0]] as unknown[]).length
            : undefined,
          excerpt,
          ...withMapping,
        };
      }
      return { ...base, responseClass: "JSON", jsonShape: typeof parsed, excerpt, ...withMapping };
    } catch {
      if (ct.includes("json")) return { ...base, responseClass: "JSON", jsonShape: "unparseable", excerpt };
    }
  }
  if (ct.includes("xml")) return { ...base, responseClass: "XML", excerpt };
  if (ct.includes("html") || /^\s*<(!doctype|html|div|table|ul|section|article|p|span|a|h[1-6])/i.test(body)) {
    const embedded = /=\s*(\{[\s\S]{10,}?\}|\[[\s\S]{10,}?\])\s*[;<]/i.test(body);
    if (embedded) return { ...base, responseClass: "JSON_IN_HTML", excerpt };
    const whole = /<html[\s>]/i.test(body);
    return { ...base, responseClass: whole ? "HTML_PAGE" : "HTML_FRAGMENT", excerpt };
  }
  if (ct.startsWith("text/")) return { ...base, responseClass: "PLAIN_TEXT", excerpt };
  return { ...base, responseClass: "UNAVAILABLE", excerpt };
}

// --- fetch policy -----------------------------------------------------------

function apexOf(host: string): string {
  const labels = host.replace(/^www\./i, "").toLowerCase().split(".");
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-3).join(".");
}

function policyFor(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  const apex = apexOf(host);
  return {
    allowedHosts: apex === host ? [host] : [host, apex],
    allowSubdomainsOf: [apex],
    maxBytes: MAX_BYTES_PER_RESPONSE,
    maxRedirects: 3,
    maxRetries: 1,
    timeoutMs: TIMEOUT_MS,
    minIntervalMs: MIN_INTERVAL_MS,
    resolveHost: nodeResolveHost,
  };
}

let pageFetches = 0;
let scriptFetches = 0;
let probes = 0;
let bytesTotal = 0;

interface Fetched {
  ok: boolean;
  status: number | null;
  contentType: string;
  body: string;
  bytes: number;
  finalUrl: string;
  error?: string;
}

async function controlledGet(url: string): Promise<Fetched> {
  // The declared bound is enforced, not merely reported. The first run of this
  // script recorded 13.0 MB against a 10.5 MB limit because the total was printed
  // but never checked, which is how a research budget quietly stops being a budget.
  if (bytesTotal >= MAX_BYTES_TOTAL) {
    return { ok: false, status: null, contentType: "", body: "", bytes: 0, finalUrl: url, error: "byte budget exhausted" };
  }
  try {
    const r = (await new ControlledFetcher(policyFor(url)).fetchControlled({ url, requestId: `dyn-${url}` })).result;
    bytesTotal += r.bodyBytes;
    if (bytesTotal > MAX_BYTES_TOTAL) {
      console.warn(`  [budget] ${bytesTotal} bytes exceeds ${MAX_BYTES_TOTAL}; no further fetches this run`);
    }
    return {
      ok: true,
      status: r.httpStatus,
      contentType: r.contentType ?? "",
      body: r.bodyBytes > 0 ? new TextDecoder().decode(r.body) : "",
      bytes: r.bodyBytes,
      finalUrl: r.finalUrl,
    };
  } catch (e) {
    return { ok: false, status: null, contentType: "", body: "", bytes: 0, finalUrl: url, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- the investigation ------------------------------------------------------

interface DynamicSource {
  institution_id: string;
  institution_name: string | null;
  source_id: string;
  career_page: string;
  observed_dynamic_behavior: string;
  same_origin_host: string;
  suspected_endpoints: Array<{
    url: string;
    discovered_by: string;
    source_literal: string;
    resolved_via_constant: boolean;
    /**
     * The candidate's own verdict. A candidate with no verdict is an unreviewable
     * claim, so this is always filled in: either from the probe of this exact URL, or
     * with the reason it was not probed.
     */
    probed: boolean;
    response_class: string | null;
    http_status: number | null;
    content_type: string | null;
    vacancy_records_found: number | null;
    not_probed_reason: string | null;
  }>;
  discovery_method: string;
  evidence: string;
  observed_at: string;
  /**
   * The bytes this classification was derived from. Two runs that disagree about a
   * page can be told apart by these two fields, instead of one run being assumed to
   * have made a mistake.
   */
  page_bytes: number;
  page_content_hash: string | null;
  /**
   * What the classification is a claim about. It describes this one response, not the
   * institution: a page that served no request call in this run is reported as having
   * none in that response, and the same host may serve a different variant later.
   */
  classification_scope: string;
  probes: ProbeResult[];
  classification: string;
}

/** A request that could plausibly be the page's own content. */
function isContentCandidate(c: EndpointCandidate): boolean {
  if (!c.sameOriginHttps) return false;
  if (c.pattern.startsWith("form.action")) return false;
  if (c.pattern === "$.ajax.url" && !/content|api|data|json/i.test(c.raw)) return false;
  return true;
}

async function main(): Promise<void> {
  const registry = JSON.parse(readFileSync("data/pilot/career-source-registry.json", "utf8")) as {
    entries: Array<Record<string, unknown>>;
    detail_entries: Array<Record<string, unknown>>;
  };
  // Detail entries carry no institution name of their own, so the names are taken
  // from the primary entries once and looked up here. An entry that never resolves
  // is reported as unresolved rather than written out as "undefined".
  const nameById = new Map<string, string>();
  for (const e of registry.entries) {
    if (typeof e.institution_name === "string") nameById.set(String(e.institution_id), e.institution_name);
  }
  const nameOf = (id: unknown): string | null => {
    const v = nameById.get(String(id));
    return v === undefined ? null : v;
  };
  const allPages = [...registry.entries, ...registry.detail_entries];
  const pages =
    SCOPE === "flagged"
      ? allPages.filter((e) => e.page_shape === "CAREER_CONTENT_CLIENT_LOADED")
      : allPages;

  const sources: DynamicSource[] = [];
  const seen = new Set<string>();

  for (const p of pages) {
    const url = String(p.url);
    if (seen.has(url) || pageFetches >= MAX_PAGE_FETCHES) continue;
    seen.add(url);
    pageFetches += 1;
    const page = await controlledGet(url);
    if (!page.ok || page.bytes === 0) {
      sources.push({
        institution_id: String(p.institution_id),
        institution_name: nameOf(p.institution_id),
        source_id: String(p.source_id),
        career_page: url,
        observed_dynamic_behavior: "page could not be read in this run",
        same_origin_host: new URL(url).hostname,
        suspected_endpoints: [],
        discovery_method: "static read of the page's own script",
        evidence: page.error ?? `http ${page.status}, ${page.bytes} bytes`,
        observed_at: new Date().toISOString(),
        page_bytes: page.bytes,
        page_content_hash: page.ok ? createHash("sha256").update(page.body).digest("hex") : null,
        classification_scope: "this response; nothing was read, so this is not a claim about the institution",
        probes: [],
              // A page that could not be read has not been shown to have no
              // endpoint, so it is not NO_ENDPOINT_FOUND. It is unsupported by
              // this investigation, and the reason is kept in the evidence field
              // rather than promoted to a verdict of its own.
              classification: "UNSUPPORTED",
      });
      continue;
    }

    const candidates = extractEndpointCandidates(page.body, url, "inline");
    // Non-vendor external scripts only: a project's own bundle is where a
    // framework-free site keeps its endpoint.
    const scripts = externalScriptUrls(page.body, url).filter((s) => !VENDOR_SCRIPT_RE.test(s));
    const scriptCandidates: EndpointCandidate[] = [];
    let scannedScripts = 0;
    for (const s of scripts) {
      if (scriptFetches >= MAX_SCRIPT_FETCHES) break;
      scriptFetches += 1;
      scannedScripts += 1;
      const res = await controlledGet(s);
      if (!res.ok || res.bytes === 0) continue;
      scriptCandidates.push(...extractEndpointCandidates(res.body, s, new URL(s).pathname));
    }

    const all = [...candidates, ...scriptCandidates];
    const content = all.filter(isContentCandidate);
    const rejected = all.filter((c) => !c.sameOriginHttps);
    const byUrl = new Map<string, EndpointCandidate>();
    for (const c of content) if (!byUrl.has(c.url ?? "")) byUrl.set(c.url ?? "", c);
    const ordered = [...byUrl.keys()];

    // Probe first, so each candidate can be written out with the verdict for its own
    // URL rather than leaving the reader to match a probe list back to a URL list.
    const probeByUrl = new Map<string, ProbeResult>();
    const unprobedReason = new Map<string, string>();
    for (const u of ordered) {
      if (probes >= MAX_PROBES) {
        unprobedReason.set(u, `probe budget of ${MAX_PROBES} was exhausted; this candidate is unprobed and proves nothing either way`);
        continue;
      }
      probes += 1;
      const res = await controlledGet(u);
      const verdict = classifyResponse({
        httpStatus: res.status,
        contentType: res.contentType,
        body: res.body,
        bytes: res.bytes,
        finalUrl: res.finalUrl,
        requestUrl: u,
        ...(res.error ? { error: res.error } : {}),
      });
      probeByUrl.set(u, verdict);
    }
    const probeResults = [...probeByUrl.values()];

    const suspected = ordered.map((u) => {
      const c = byUrl.get(u) as EndpointCandidate;
      const p = probeByUrl.get(u);
      return {
        url: u,
        discovered_by: c.pattern,
        source_literal: c.raw,
        resolved_via_constant: c.pattern.endsWith("+const"),
        probed: p !== undefined,
        response_class: p?.responseClass ?? null,
        http_status: p?.httpStatus ?? null,
        content_type: p ? p.contentType : null,
        vacancy_records_found: p?.vacancyRecordsFound ?? null,
        not_probed_reason: p ? null : unprobedReason.get(u) ?? "not probed",
      };
    });

    // An off-site literal is recorded even though it will never be fetched, because
    // "the vacancy is on somebody else's portal" is the finding that decides the
    // product, and it has to be visible here to be reviewable.
    const offSite = [...new Set(rejected.map((c) => c.raw).filter((r) => /https?:\/\//i.test(r)))];

    const evidence = [
      `request calls in page script: ${(page.body.match(/\bfetch\s*\(|\$\s*\.\s*(?:ajax|get|getJSON|post)\s*\(/gi) ?? []).length}`,
      `non-vendor same-origin scripts read: ${scannedScripts}`,
      `same-origin content candidates: ${suspected.length}`,
      `off-site or non-HTTPS literals refused: ${rejected.length}`,
      ...suspected.map((s) => `  ${s.discovered_by}: ${s.source_literal}`),
      ...(offSite.length ? [`  off-site literals refused: ${offSite.join(" | ")}`] : []),
    ].join("\n");


    sources.push({
      institution_id: String(p.institution_id),
      institution_name: nameOf(p.institution_id),
      source_id: String(p.source_id),
      career_page: url,
      observed_dynamic_behavior: String(p.shape_reason),      same_origin_host: new URL(url).hostname,
      suspected_endpoints: suspected,
      discovery_method: "static read of inline script and non-vendor same-origin scripts; no script executed",
      evidence,
      observed_at: new Date().toISOString(),
      page_bytes: page.bytes,
      page_content_hash: createHash("sha256").update(page.body).digest("hex"),
      classification_scope: "this response only; a site may serve a different variant on another request, and a negative here is a negative for these bytes",
      probes: probeResults,
      classification: classifySource(
        probeResults,
        probeResults.reduce((n, r) => n + (r.vacancyRecordsFound ?? 0), 0),
      ),
    });
  }

  const out = {
    $schema: "career-dynamic-sources/v1",
    generated_at: new Date().toISOString(),
    purpose:
      "M3.5 investigation: whether official same-origin endpoints behind these career pages expose deterministic machine-readable vacancy data. Endpoints are read from page source as text and probed with the existing ControlledFetcher policy. No JavaScript is executed, no browser is used, and no vacancy field is extracted from a non-structured response.",
    constraints: [
      "no OCR",
      "no AI or LLM",
      "no browser automation",
      "no credentials, cookies or session replay",
      "same-site and HTTPS only",
      "no institution-specific parsing",
    ],
    scope: {
      mode: SCOPE,
      pages_in_registry: allPages.length,
      pages_scanned: sources.length,
      note:
        SCOPE === "all"
          ? "every page the pilot read was scanned for a same-origin content endpoint, so a negative result covers the whole population rather than only the pages a heuristic flagged"
          : "only pages the shape classifier flagged as client-loaded were scanned",
    },
    usage: {
      page_fetches: pageFetches,
      script_fetches: scriptFetches,
      probes,
      bytes: bytesTotal,
      limits: {
        max_page_fetches: MAX_PAGE_FETCHES,
        max_script_fetches: MAX_SCRIPT_FETCHES,
        max_probes: MAX_PROBES,
        max_bytes: MAX_BYTES_TOTAL,
      },
    },
    sources,
  };
  writeFileSync("data/pilot/career-dynamic-sources.json", `${JSON.stringify(out, null, 2)}\n`);

  for (const s of sources) {
    console.log(`\n=== ${s.institution_id} ${s.career_page}`);
    if (s.suspected_endpoints.length === 0) console.log("  no same-origin content endpoint found");
    for (const e of s.suspected_endpoints) {
      const verdict = e.probed
        ? `${e.response_class}${e.http_status === null ? "" : ` http ${e.http_status}`}${e.vacancy_records_found === null ? "" : ` vacancies=${e.vacancy_records_found}`}`
        : `not probed (${e.not_probed_reason})`;
      console.log(`  endpoint ${e.url}  (${e.discovered_by}: ${e.source_literal})`);
      console.log(`    -> ${verdict}`);
    }
    for (const r of s.probes) {
      console.log(
        `  -> http ${r.httpStatus} ${r.contentType || "(none)"} ${r.bytes}B = ${r.responseClass}` +
          (r.jsonShape ? ` [${r.jsonShape}${r.jsonItemCount !== undefined ? `, ${r.jsonItemCount} items` : ""}]` : "") +
          (r.vacancyRecordsFound !== undefined ? ` vacancies=${r.vacancyRecordsFound}` : "") +
          (r.error ? ` (${r.error})` : ""),
      );
      for (const w of r.mapping?.warnings ?? []) console.log(`       ! ${w}`);
    }
    if (s.probes.length > 0) console.log(`  classification: ${s.classification}`);
  }
  console.log(`\nusage: pages ${pageFetches} scripts ${scriptFetches} probes ${probes} bytes ${bytesTotal}`);
  console.log("written: data/pilot/career-dynamic-sources.json");
}

void main();
