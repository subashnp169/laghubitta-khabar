// ============================================================================
// P2-E — news / content layer acceptance tests.
//
// These assert the PROPERTIES P2-E guarantees over the canonical activity
// projection (src/util/activity.ts `newsRecords`) and the frozen
// `GET /api/news` contract. The page feed and the API are derived from ONE
// iteration, so every check here that compares them is structural, not
// coincidental: a regression in either surface fails here.
//
// Nothing here invents content. The 62 regulatory events and 97 document
// listings are the frozen evidence snapshot (src/data/nrb.ts); this suite
// re-derives the collapsed 93-document set, the publisher → tier/scope
// classification and the event source attribution independently of the code
// under test, then locks them to the surviving artifacts (data/master).
//
// Run: npm run smoke:news-p2e   (after `npm run seed && npm run durable:build`)
// ============================================================================

// Integration harness reading response bodies with unchecked shape access.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { handleApiRequest } from "../lib/api/handler";
import { nrbDocuments, nrbRegulatoryEvents, nrbSummary } from "../src/data/nrb";
import { allActivity, newsRecords } from "../src/util/activity";
import {
  CONTENT_BUCKET_LABEL,
  CONTENT_BUCKET_ORDER,
  contentBucketCounts,
} from "../src/util/buckets";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
type CountRow = { c: number };
const Database = require("better-sqlite3") as new (
  p: string,
  o?: { readonly?: boolean },
) => {
  prepare(s: string): { get(...a: unknown[]): CountRow; all(...a: unknown[]): Row[] };
  close(): void;
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}

function request(method: string, url: string): { status: number; body: Record<string, any> } {
  const out = handleApiRequest({ method, url });
  return { status: out.status, body: JSON.parse(out.body) as Record<string, any> };
}

function newsPage(page: number, limit: number): Record<string, any> {
  return request("GET", `/api/news?page=${page}&limit=${limit}`).body;
}

const evById = new Map(nrbRegulatoryEvents.map((e) => [e.id, e]));
const docById = new Map(nrbDocuments.map((d) => [d.id, d]));
const PHRASE: Record<string, string> = { MERGED: "Merged with", ACQUIRED: "Acquired", RENAMED: "Renamed to" };

// ---------------------------------------------------------------------------
// PE-1  Canonical identity — what the content layer is
// ---------------------------------------------------------------------------
console.log("PE-1 canonical identity");

const records = newsRecords();
check("canonical record set is 155 (62 events + 93 distinct documents)", records.length === 155);
const regCount = nrbRegulatoryEvents.length;
const pubListings = nrbDocuments.length;

// Independent collapse of listings to documents: keep the first listing per
// officialUrl, keep every listing that has no URL untouched.
const urlSeen = new Set<string>();
const expectedDistinctDocIds: string[] = [];
for (const d of nrbDocuments) {
  if (d.officialUrl) {
    if (urlSeen.has(d.officialUrl)) continue;
    urlSeen.add(d.officialUrl);
  }
  expectedDistinctDocIds.push(d.id);
}
check(`raw listings collapse to unique documents (${pubListings} → ${expectedDistinctDocIds.length})`, expectedDistinctDocIds.length === 93);
check("the 97 listings collapse to 93 by exactly 4 shared URLs", pubListings - expectedDistinctDocIds.length === 4);
const recordKinds = records.reduce<Record<string, number>>((a, r) => {
  a[r.kind] = (a[r.kind] ?? 0) + 1;
  return a;
}, {});
check("record kinds match the source arrays (62 regulatory, 93 publication)", recordKinds.regulatory === regCount && recordKinds.publication === expectedDistinctDocIds.length);
check("every record id is unique", new Set(records.map((r) => r.id)).size === records.length);
check("raw listings count is 97 and summary agrees", pubListings === 97 && nrbSummary.documents === pubListings);

const rec1 = JSON.stringify(records);
const rec2 = JSON.stringify(newsRecords());
check("newsRecords() is deterministic across calls", rec1 === rec2);

// ---------------------------------------------------------------------------
// PE-2  Evidence membership — every item traces to a source record
// ---------------------------------------------------------------------------
console.log("PE-2 evidence membership");

const regIds = new Set((nrbRegulatoryEvents).map((e) => e.id));
const docIds = new Set(expectedDistinctDocIds);
check("every regulatory record is an actual event id", records.filter((r) => r.kind === "regulatory").every((r) => evById.has(r.id) && regIds.has(r.id)));
check("every publication record is the first listing of an actual document", records.filter((r) => r.kind === "publication").every((r) => docById.has(r.id) && docIds.has(r.id)));
check("regulatory ids and publication ids are disjoint sets", [...regIds].every((id) => !docIds.has(id)));
check("every record href is routable", records.every((r) => (r.kind === "regulatory" ? r.href === `/news/${r.id}` : r.href === docById.get(r.id)?.officialUrl)));

// ---------------------------------------------------------------------------
// PE-3  Dates are evidence — never placed there by this pipeline
// ---------------------------------------------------------------------------
console.log("PE-3 dates are evidence");

const ISO = /^\d{4}-\d{2}-\d{2}$/;
check("every published_at is an ISO date", records.every((r) => ISO.test(r.occurredAt ?? "")));
const docUndated = nrbDocuments.filter((d) => !d.publishedAt);
const docNullDate = nrbDocuments.filter((d) => d.publishedAt && !ISO.test(d.publishedAt));
check("every document carries a valid publication date (0 null, 0 invalid)", docUndated.length === 0 && docNullDate.length === 0);
check("every event carries the documented observed_at fallback", records.filter((r) => r.kind === "regulatory").every((r) => r.occurredAt === nrbSummary.observedAt));
check("document dates are carried verbatim from their listing", records.filter((r) => r.kind === "publication").every((r) => r.occurredAt === docById.get(r.id)!.publishedAt));
const snapshotDate = nrbSummary.generatedAt.slice(0, 10);
const maxPublished = records.map((r) => r.occurredAt ?? "").reduce((m, d) => (d > m ? d : m), "0000-00-00");
check("last_verified_at is the snapshot build date and is never earlier than any record's own date", snapshotDate >= maxPublished);

// ---------------------------------------------------------------------------
// PE-4  Tier & scope are derived, never guessed
// ---------------------------------------------------------------------------
console.log("PE-4 tier/scope derivation");

const PUBLISHER_TIER: Record<string, string> = { "Nepal Rastra Bank": "NRB" };
const PUBLISHER_SCOPE: Record<string, string> = { "Nepal Rastra Bank": "NRB" };
check("all 9 registered sources are published by Nepal Rastra Bank", nrbSummary.sources.every((s) => s.publisher === "Nepal Rastra Bank"));
check("no registered publisher lacks a tier/scope classification", nrbSummary.sources.every((s) => PUBLISHER_TIER[s.publisher] && PUBLISHER_SCOPE[s.publisher]));

const news = request("GET", "/api/news");
const allNewsItems = [...newsPage(1, 100).data, ...newsPage(2, 100).data] as Array<Record<string, any>>;
check("unfiltered API returns all 155 records", allNewsItems.length === 155);
check("every item's tier equals the classification of its source publisher", allNewsItems.every((i) => {
  const src = nrbSummary.sources.find((s) => s.id === i.source_id);
  return src !== undefined && i.tier === PUBLISHER_TIER[src.publisher] && i.scope === PUBLISHER_SCOPE[src.publisher];
}));
check("every item is tier NRB and scope NRB", allNewsItems.every((i) => i.tier === "NRB" && i.scope === "NRB"));
const counts = news.body.meta.tier as Record<string, number>;
check("meta.tier has exactly the four contract tiers", JSON.stringify(Object.keys(counts).sort()) === JSON.stringify(["KHABAR", "MEDIA", "NRB", "OFFICIAL"].sort()));
check("meta.tier counts sum to the record count", Object.values(counts).reduce((a, b) => a + b, 0) === allNewsItems.length);
check("NRB counts all records; OFFICIAL/KHABAR/MEDIA are honestly zero", counts.NRB === 155 && counts.OFFICIAL === 0 && counts.KHABAR === 0 && counts.MEDIA === 0);

// ---------------------------------------------------------------------------
// PE-5  Nothing is fabricated — titles, snippets, URLs
// ---------------------------------------------------------------------------
console.log("PE-5 no fabrication");

check("every snippet is non-empty plain explanation", allNewsItems.every((i) => typeof i.snippet === "string" && i.snippet.length > 0));
const evItems = allNewsItems.filter((i) => evById.has(i.id));
const pubItems = allNewsItems.filter((i) => docById.has(i.id));
check("publication snippets state the limit, never the contents", pubItems.every((i) => i.snippet === "Document published; contents not read"));
check("event snippets name the institution the directory states", evItems.every((i) => i.snippet === evById.get(i.id)!.institutionName));
check("event titles come from the closed phrase vocabulary", evItems.every((i) => {
  const e = evById.get(i.id)!;
  const phrase = PHRASE[e.eventType] ?? e.eventType.replace(/_/g, " ").toLowerCase();
  return i.title === `${phrase} ${e.title}`.trim();
}));
check("document titles are carried verbatim", pubItems.every((i) => i.title === docById.get(i.id)!.title));
check("event source_urls are parsed from the description or honestly null", evItems.every((i) => {
  const e = evById.get(i.id)!;
  return i.meta.source_url === null || e.description.trim().endsWith(i.meta.source_url);
}));
const evWithUrl = evItems.filter((i) => i.meta.source_url !== null).length;
check("exactly 52 events carry a trailing evidence URL and 10 carry none", evWithUrl === 52 && evItems.length - evWithUrl === 10);
check("document source_urls are their carried officialUrls", pubItems.every((i) => i.meta.source_url === docById.get(i.id)!.officialUrl && i.meta.source_url !== null));
check("institution_slug is the event's own slug and null for publications", evItems.every((i) => i.institution_slug === evById.get(i.id)!.institutionSlug) && pubItems.every((i) => i.institution_slug === null));

// ---------------------------------------------------------------------------
// PE-6  API contract — filters, validation, pagination
// ---------------------------------------------------------------------------
console.log("PE-6 API contract");

const scoped = request("GET", "/api/news?scope=NRB");
check("scope=NRB returns every record", scoped.body.pagination.total === 155);
const emptyScope = request("GET", "/api/news?scope=INSTITUTION");
check("scope=INSTITUTION returns an empty honest collection", emptyScope.status === 200 && emptyScope.body.data.length === 0 && emptyScope.body.pagination.total === 0);
check("empty scope still carries a full meta.tier of zeros", Object.values(emptyScope.body.meta.tier as Record<string, number>).every((c: number) => c === 0));
const emptyTier = request("GET", "/api/news?tier=MEDIA");
check("tier=MEDIA returns an empty collection but facets the full set", emptyTier.body.data.length === 0 && emptyTier.body.pagination.total === 0 && emptyTier.body.meta.tier.NRB === 155);
const both = request("GET", "/api/news?scope=INSTITUTION&tier=OFFICIAL");
check("scope+tier combined filter is consistent", both.body.data.length === 0 && both.status === 200);
check("tier=OFFICIAL alone is empty (nothing is OFFICIAL)", request("GET", "/api/news?tier=OFFICIAL").body.data.length === 0);
const badTier = request("GET", "/api/news?tier=NOTHING");
check("unknown tier → 422 VALIDATION", badTier.status === 422 && badTier.body.error.code === "VALIDATION");
const badScope = request("GET", "/api/news?scope=NOTHING");
check("unknown scope → 422 VALIDATION", badScope.status === 422 && badScope.body.error.code === "VALIDATION");
const badBoth = request("GET", "/api/news?tier=X&scope=Y");
check("unknown tier and scope together → 422", badBoth.status === 422);
const lower = request("GET", "/api/news?tier=khabar&scope=nrb");
check("filters accept lowercase and normalize", lower.status === 200);
check("page beyond the end is empty with total unchanged", newsPage(99, 20).data.length === 0 && newsPage(99, 20).pagination.total === 155);
check("deep page returns the exact remainder", newsPage(8, 20).data.length === 15 && newsPage(8, 20).pagination.page === 8);
check("limit clamps to 100", request("GET", "/api/news?limit=999").body.data.length === 100);

// ---------------------------------------------------------------------------
// PE-7  Page/API parity — one canonical projection, two surfaces
// ---------------------------------------------------------------------------
console.log("PE-7 page/API parity");

const feedIds = allActivity().map((i) => i.id);
const apiIds = allNewsItems.map((i) => i.id);
check("API id order equals feed order exactly", JSON.stringify(apiIds) === JSON.stringify(feedIds));
const feedById = new Map(allActivity().map((i) => [i.id, i]));
check("API title equals feed title for every record", allNewsItems.every((i) => i.title === feedById.get(i.id)!.title));
check("API snippet equals feed detail for every record", allNewsItems.every((i) => i.snippet === feedById.get(i.id)!.detail));
check("API slug equals feed id (the /news/[slug] route key)", allNewsItems.every((i) => i.slug === i.id && feedById.has(i.slug)));

// ---------------------------------------------------------------------------
// PE-8  master.json reconstruction lock — the event source attribution
// ---------------------------------------------------------------------------
console.log("PE-8 master.json reconstruction lock");

const masterPath = join(process.cwd(), "data", "master", "master.json");
check("data/master/master.json exists", existsSync(masterPath));
const master = JSON.parse(readFileSync(masterPath, "utf8")) as {
  timeline?: Array<{ source_id?: string | null }>;
  universeSnapshot?: { source_id?: string | null };
};
const timelineSourceIds = new Set((master.timeline ?? []).map((t) => t.source_id));
check("every timeline row carries the same source_id (all 62)", master.timeline?.length === 62 && timelineSourceIds.size === 1 && timelineSourceIds.has("nrb-bfi-mid-may-2026"));
check("the universe snapshot attributes itself to the same source", master.universeSnapshot?.source_id === "nrb-bfi-mid-may-2026");
check("every API event item agrees with master.json (reconstructed attribution is locked)", evItems.every((i) => i.source_id === "nrb-bfi-mid-may-2026"));
check("the attributed source is registered in nrbSummary.sources", nrbSummary.sources.some((s) => s.id === "nrb-bfi-mid-may-2026"));
check("the attributed source is published by Nepal Rastra Bank", nrbSummary.sources.find((s) => s.id === "nrb-bfi-mid-may-2026")?.publisher === "Nepal Rastra Bank");

// ---------------------------------------------------------------------------
// PE-9  Registry coherence — source titles are source-owned
// ---------------------------------------------------------------------------
console.log("PE-9 registry coherence");

const regTitles = new Set(nrbSummary.sources.map((s) => s.title));
check("every meta.source is a registered source title", allNewsItems.every((i) => regTitles.has(i.meta.source)));
check("every meta.sources is exactly [meta.source]", allNewsItems.every((i) => Array.isArray(i.meta.sources) && i.meta.sources.length === 1 && i.meta.sources[0] === i.meta.source));
check("carried document source titles equal their registered titles", pubItems.every((i) => i.meta.source === docById.get(i.id)!.sourceTitle));
check("every item shares the snapshot's last_verified_at", allNewsItems.every((i) => i.meta.last_verified_at === snapshotDate));
check("every item is honest UNVERIFIED", allNewsItems.every((i) => i.meta.verification_status === "UNVERIFIED"));

// ---------------------------------------------------------------------------
// PE-10 The evidence store stayed empty — no fabricated news rows anywhere
// ---------------------------------------------------------------------------
console.log("PE-10 news tables stay empty");

function countTable(dbPath: string, table: string): number | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!row.c) return 0;
    return db.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c as number;
  } finally {
    db.close();
  }
}
for (const dbPath of [join(process.cwd(), "data", "durable", "store.db"), join(process.cwd(), "lk.db")]) {
  for (const table of ["news", "posts", "post_sources"]) {
    const c = countTable(dbPath, table);
    check(`${table} has 0 rows in ${dbPath.split(/(\\|\/)/).pop()}`, c === 0);
  }
}

// ---------------------------------------------------------------------------
// PE-11 Content buckets keep regulatory events, documents and news apart
// ---------------------------------------------------------------------------
console.log("PE-11 content buckets");

const bucketCounts = contentBucketCounts();
check("three buckets, in a stable order, each with a distinct label", CONTENT_BUCKET_ORDER.length === 3 && new Set(CONTENT_BUCKET_ORDER.map((b) => CONTENT_BUCKET_LABEL[b])).size === 3);
check("the regulatory-events bucket equals the NRB event count", bucketCounts["regulatory-events"] === nrbSummary.regulatoryEvents);
check("the documents bucket covers every document layer and is non-empty", bucketCounts.documents > 0 && bucketCounts.documents >= nrbSummary.documents);
check("the news & activity bucket is empty — no media coverage is held", bucketCounts["news-activity"] === 0);

console.log(`\nP2-E news/content results: ${pass} ok / ${fail} fail`);
if (fail > 0) process.exit(1);