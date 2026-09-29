// M3.4: re-point the BRANCH_DIRECTORY known_url values to the real branch pages
// that M3.4 branch-url-discovery structurally confirmed.
//
// SCOPE, deliberately narrow:
//   - ONLY the 10 sources with a VERIFIED_BRANCH_DIRECTORY verdict are touched.
//   - proven_by is NEVER modified. The May-2026 universe provenance stands; this
//     script corrects WHICH PAGE the capability points at, and says so in the
//     note. It does not manufacture new provenance for a URL the May snapshot
//     never contained.
//   - The 10 BRANCH_PAGE_NEEDS_JS sources are left alone on purpose: a page we
//     cannot read without a browser is a different decision, and this project
//     does not do JS rendering. They are reported, not silently swapped.
//   - Nothing is asserted. No assertions, no schema, no pilot execution.
//
//   npx tsx scripts/apply-branch-target-corrections.ts [--dry-run]
//
import { readFileSync, writeFileSync } from "node:fs";

const SOURCES = "data/pilot/pilot-sources.json";
const DISCOVERY = "data/pilot/branch-url-discovery.json";
const DRY_RUN = process.argv.includes("--dry-run");

interface Verified {
  url: string;
  verdict: string;
  dryRunBranchNames: number;
  parserOutput: { quality: string; distinct: number; topName: string | null; topCount: number };
  contentHash: string;
  snapshotId: string;
}

interface Cap {
  capability: string;
  status?: string;
  known_url: string | null;
  link_type?: string;
  note?: string;
}

function main(): void {
  const discovery = JSON.parse(readFileSync(DISCOVERY, "utf8")) as {
    generated_at: string;
    results: Array<{ sourceId: string; verified: Verified[] }>;
  };
  const pilot = JSON.parse(readFileSync(SOURCES, "utf8")) as {
    sources: Array<{ id: string; proven_by: string; capabilities: Cap[] }>;
  };

  // Best confirmed page per source: prefer one the parser reads cleanly, then
  // the most names. A page we can read is a more useful target than one we
  // cannot, and both are strictly better than a homepage.
  const best = new Map<string, Verified>();
  for (const r of discovery.results) {
    const vs = r.verified.filter((v) => v.verdict === "VERIFIED_BRANCH_DIRECTORY");
    if (vs.length === 0) continue;
    const pick = vs.sort((a, b) => {
      const aq = a.parserOutput.quality === "CLEAN" ? 1 : 0;
      const bq = b.parserOutput.quality === "CLEAN" ? 1 : 0;
      if (aq !== bq) return bq - aq;
      return b.dryRunBranchNames - a.dryRunBranchNames;
    })[0];
    best.set(r.sourceId, pick);
  }

  const changes: Array<{ sourceId: string; from: string | null; to: string; note: string }> = [];

  for (const s of pilot.sources) {
    const cap = s.capabilities.find((c) => c.capability === "BRANCH_DIRECTORY");
    if (!cap) continue;
    const v = best.get(s.id);
    if (!v) continue;
    if (cap.known_url === v.url) continue;

    const priorNote = cap.note ?? "(no prior note)";
    const readable =
      v.parserOutput.quality === "CLEAN" && v.dryRunBranchNames >= 2
        ? `branch-html-v1 dry run reads ${v.dryRunBranchNames} names (${v.parserOutput.distinct} distinct)`
        : v.dryRunBranchNames === 0
          ? "branch-html-v1 dry run reads 0 names (page is a real directory the parser cannot read yet)"
          : `branch-html-v1 dry run reads ${v.dryRunBranchNames} names but output is ${v.parserOutput.quality} (top "${v.parserOutput.topName}" x${v.parserOutput.topCount})`;

    const note =
      `m34 2026-09-27: re-pointed to a structurally confirmed branch page. prior target was not a branch page [${priorNote}]. ` +
      `confirmed by branch-url-discovery on a repeated-address/phone row structure (branchRows>=2); ${readable}. ` +
      `snapshot ${v.snapshotId} sha256:${v.contentHash.slice(0, 12)}. ` +
      `source-level proven_by (${s.proven_by}) unchanged: this corrects WHICH page, it does not re-prove the institution.`;

    changes.push({ sourceId: s.id, from: cap.known_url, to: v.url, note });
    cap.known_url = v.url;
    cap.note = note;
  }

  console.log(`${changes.length} BRANCH_DIRECTORY target(s) re-pointed${DRY_RUN ? "  (DRY RUN, nothing written)" : ""}:`);
  for (const c of changes) {
    console.log(`  ${c.sourceId}`);
    console.log(`    from ${c.from}`);
    console.log(`    to   ${c.to}`);
  }
  if (DRY_RUN) return;

  // ---- BYTE-PRESERVING edit -------------------------------------------------
  // A whole-file JSON round-trip re-serialises hand-authored compact formatting
  // elsewhere in the file (the data_api blocks use single-line arrays and
  // objects), producing unrelated diff noise in committed data. So the file is
  // edited as text: only the known_url and note string literals inside the
  // BRANCH_DIRECTORY capability of each affected source are replaced, and
  // everything else is left byte-for-byte identical.
  let text = readFileSync(SOURCES, "utf8");
  for (const c of changes) {
    const start = text.indexOf(`"id": ${JSON.stringify(c.sourceId)}`);
    if (start < 0) throw new Error(`source block not found: ${c.sourceId}`);
    const nextSource = text.indexOf('"id": "', start + 4);
    const end = nextSource < 0 ? text.length : nextSource;
    const block = text.slice(start, end);
    const marker = block.indexOf('"capability": "BRANCH_DIRECTORY"');
    if (marker < 0) throw new Error(`BRANCH_DIRECTORY capability not found: ${c.sourceId}`);

    // Field order inside a capability object is stable, so the first known_url
    // and the first note AFTER the marker are the branch ones.
    const patched = replaceStringLiteralAfter(block, marker, "known_url", c.to);
    const withNote = replaceStringLiteralAfter(patched, marker, "note", c.note);
    text = text.slice(0, start) + withNote + text.slice(end);
  }

  // The result must still parse, or we would have corrupted committed data.
  JSON.parse(text);

  writeFileSync(SOURCES, text, "utf8");
  console.log(`\nwrote ${SOURCES} (text surgery; reparsed OK)`);
}

/** Replace the value of the first `key: "..."` occurrence after `from`. */
function replaceStringLiteralAfter(text: string, from: number, key: string, value: string): string {
  const at = text.indexOf(`"${key}": "`, from);
  if (at < 0) throw new Error(`"${key}" not found after offset ${from}`);
  const valueStart = at + key.length + 5;
  const valueEnd = text.indexOf('"', valueStart);
  if (valueEnd < 0) throw new Error(`unterminated "${key}" literal`);
  return text.slice(0, valueStart) + JSON.stringify(value).slice(1, -1) + text.slice(valueEnd);
}

main();
