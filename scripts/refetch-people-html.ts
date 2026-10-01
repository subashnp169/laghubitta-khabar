// ============================================================================
// P2 coverage follow-up: cache the HTML of the 4 institutions the triage proved
// are recoverable, so the assertion-path fix can be verified against real markup
// instead of hand-built fixtures.
//
// Why this exists (and why it is small):
//   Every one of the 688 existing snapshots has r2_key = NULL, i.e. the pipeline
//   never persisted the body it fetched. The People pilot therefore cannot be
//   re-run offline, and the "rosterPairs extracted but never asserted" gap could
//   only be fixed blind. This fetches exactly the 4 hosts the read-only triage
//   identified, so the fix has something real to test against.
//
// Scope discipline:
//   * 4 hosts / 8 URLs. NOT a re-crawl of the 45. The other 9 rejected
//     institutions produced zero candidates on every page, and the other 3
//     false-positive clusters are already correctly excluded, so a broad
//     re-crawl would spend traffic to reproduce the same answer.
//   * Uses the project's own ControlledFetcher, so host allowlist, byte caps,
//     redirect caps, retry and audit-trace policy are unchanged. This script
//     adds no new fetch policy of its own.
//   * Writes HTML to a scratch dir outside the repo. It never opens lk.db and
//     never writes an evidence DB. The output is a test fixture, not evidence.
// ============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ControlledFetcher } from "../lib/ingestion/fetcher";
import { peopleExtractor } from "../lib/ingestion/people";
import { crawlSources } from "../src/data/pilot";

const OUT_DIR = join(tmpdir(), "lk-people-refetch");
const MAX_BYTES = 5_242_880;

/** The 4 hosts the read-only triage proved hold real, publishable people. */
const HOSTS = [
  "himalayanlaghubitta.com",
  "ashamicrofinance.com.np",
  "weannepal.com",
  "dhaulagiribank.com",
];

/** Hosts we deliberately still fetch, to prove the fix does NOT publish them. */
const NEGATIVE_HOSTS = ["aatmanirbhar.com.np", "uniquenepalmicrofinance.com.np", "unnatislbs.com.np"];

const CAPTURE: Array<{ host: string; sourceId: string; institutionId: string; negative: boolean }> = [];
for (const row of crawlSources as unknown as Array<Record<string, unknown>>) {
  const website = String(row.website ?? "");
  let host = "";
  try {
    host = new URL(website).hostname;
  } catch {
    continue;
  }
  if (HOSTS.includes(host) || NEGATIVE_HOSTS.includes(host)) {
    CAPTURE.push({
      host,
      sourceId: String(row.sourceId),
      institutionId: String(row.institutionId),
      negative: NEGATIVE_HOSTS.includes(host),
    });
  }
}

const policy = {
  allowedHosts: [...new Set(CAPTURE.map((c) => c.host))],
  maxBytes: MAX_BYTES,
  maxRedirects: 5,
  maxRetries: 2,
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const fetcher = new ControlledFetcher(policy);

  // One page per host: the board/management page the seed manifest verified.
  const targets = [
    "https://himalayanlaghubitta.com/page/aboutus/2/boardofdirectors/5",
    "https://himalayanlaghubitta.com/page/aboutus/2/managementteam/6",
    "https://ashamicrofinance.com.np/board-of-directors",
    "https://weannepal.com/board-of-directors",
    "https://dhaulagiribank.com/management-team",
    "https://aatmanirbhar.com.np/board-of-directors",
    "https://uniquenepalmicrofinance.com.np/board-of-directors",
    "https://unnatislbs.com.np/board-of-directors",
  ];

  const manifest: Array<Record<string, unknown>> = [];
  for (const url of targets) {
    const host = new URL(url).hostname;
    const cap = CAPTURE.find((c) => c.host === host);
    try {
      const res = await fetcher.fetch(url);
      const body = new TextDecoder().decode(res.body);
      const slug = url.replace(/[^a-z0-9]+/gi, "_").slice(-90);
      writeFileSync(join(OUT_DIR, `${slug}.html`), body, "utf8");

      const evidence = await peopleExtractor.extract({
        sourceId: cap?.sourceId ?? host,
        institutionId: cap?.institutionId,
        capability: "PEOPLE",
        url: res.finalUrl ?? url,
        parserId: peopleExtractor.parserId,
        contentHash: res.contentHash,
        body: res.body,
      });
      const people = evidence.filter(
        (e) => e.capability === "PEOPLE" || String(e.field ?? "").startsWith("people_"),
      );
      manifest.push({
        url,
        host,
        institutionId: cap?.institutionId ?? null,
        negative: cap?.negative ?? false,
        httpStatus: res.httpStatus,
        bytes: res.bodyBytes,
        finalUrl: res.finalUrl,
        extractedPeople: people.length,
        fields: [...new Set(people.map((p) => p.field ?? p.capability))],
        file: `${slug}.html`,
      });
      console.log(
        `  ${res.httpStatus}  ${String(res.bodyBytes).padStart(7)}b  people=${String(people.length).padStart(3)}  ${url}`,
      );
    } catch (err) {
      manifest.push({ url, host, error: (err as Error).message });
      console.log(`  ERR  ${url}  -> ${(err as Error).message}`);
    }
  }

  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n  HTML + manifest -> ${OUT_DIR}`);
}

void main();
