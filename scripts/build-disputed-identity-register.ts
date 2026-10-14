// ============================================================================
// P1 — Disputed identity register.
//
// RECORDS A CONFLICT. RESOLVES NOTHING BY ITSELF.
//
// src/data/institutions.ts and data/master/master.json disagree on the identity
// of 16 institutions (mfi-036 .. mfi-051). This script arbitrates each one
// against the evidence layer and writes the verdict to
// data/master/disputed-identities.json.
//
// Why this exists rather than a one-line edit to src/data/institutions.ts:
//
//  1. src/data/institutions.ts publishes those 16 identities to the live site,
//     with a paidUpCapitalCrore figure stamped grade A / NRB / asOf
//     2026-05-15 on each. master.json holds no capital figure at all, and the
//     capital figures came from a DIFFERENT NRB source (nrb-kfi, Key Financial
//     Indicators). If the name -> id binding was wrong, the capital figures are
//     attached to the wrong entities too. That cannot be re-derived offline.
//  2. The published slugs are in the live URL space. Correcting the identity
//     means the old slug must become a redirect, which is a routing decision.
//
// So: the conflict is registered with evidence, and the rewrite is a separate,
// deliberate step. Nothing here deletes or rewrites a disputed identity.
//
//   npx tsx scripts/build-disputed-identity-register.ts
//
// Read-only against master.json, the published module and the evidence DBs.
// Writes exactly one file and touches nothing else.
// ============================================================================

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Matches the repo convention (build-durable-store.ts, build-jobs-module.ts):
// better-sqlite3 via require, typed with a local minimal interface.
interface Db {
  prepare(sql: string): { all(...a: unknown[]): Row[]; get(...a: unknown[]): Row };
  close(): void;
}
const Database = require("better-sqlite3") as new (p: string, o?: { readonly?: boolean; fileMustExist?: boolean }) => Db;

const ROOT = resolve(__dirname, "..");
const MASTER_PATH = join(ROOT, "data", "master", "master.json");
const PUBLISHED_PATH = join(ROOT, "src", "data", "institutions.ts");
const EVIDENCE_DIR = join(ROOT, "data", "pilot", "evidence");
const OUT_PATH = join(ROOT, "data", "master", "disputed-identities.json");

type Row = Record<string, unknown>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hostOf = (url?: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const master = JSON.parse(readFileSync(MASTER_PATH, "utf8"));
const masterById = new Map<string, Row>((master.institutions as Row[]).map((i) => [i.id as string, i]));

// ---------------------------------------------------------------------------
// Published module: extract the array literal without executing TS.
// ---------------------------------------------------------------------------
function loadPublished(): Row[] {
  const src = readFileSync(PUBLISHED_PATH, "utf8");
  const tok = "export const institutions: Institution[] = ";
  const start = src.indexOf(tok) + tok.length;
  if (start < tok.length) throw new Error("published institutions export not found");
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("could not find the end of the institutions array");
  return new Function(`return ${src.slice(start, end)}`)() as Row[];
}
const published = loadPublished();

// ---------------------------------------------------------------------------
// Slug redirects written by apply-identity-corrections.ts. These are the
// surviving record of the 16 disputed identities: `was` holds the old
// published name, `old_slug` the old URL. After the correction ran, published
// name == master name, so a naive re-run of the comparison below reports 0
// conflicts — the historical dispute must be reconstructed from here instead
// of being silently forgotten.
// ---------------------------------------------------------------------------
function loadSlugAliases(): Row[] {
  const src = readFileSync(PUBLISHED_PATH, "utf8");
  const m = src.match(/slugAliases[^=]*=\s*(\[[\s\S]*?\]);/m);
  if (!m) return [];
  return new Function(`return ${m[1]}`)() as Row[];
}
const slugAliases = loadSlugAliases();

// ---------------------------------------------------------------------------
// Evidence layer: institution_id -> domains bound, and names asserted.
// ---------------------------------------------------------------------------
const domains = new Map<string, Set<string>>();
const asserted = new Map<string, Set<string>>();
const assertionsByDomain = new Map<string, number>();
let dbCount = 0;

for (const f of readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".db"))) {
  let db: Db | undefined;
  try {
    db = new Database(join(EVIDENCE_DIR, f), { readonly: true, fileMustExist: true });
    dbCount++;
    for (const r of db
      .prepare("SELECT institution_id, domain FROM ingestion_sources WHERE institution_id IS NOT NULL")
      .all() as Row[]) {
      if (!r.domain) continue;
      const key = r.institution_id as string;
      if (!domains.has(key)) domains.set(key, new Set());
      domains.get(key)!.add((r.domain as string).replace(/^www\./, ""));
    }
    for (const r of db
      .prepare(
        "SELECT entity_id, value FROM data_assertions WHERE entity_type='institution' AND value LIKE '%Laghubitta%'",
      )
      .all() as Row[]) {
      const key = r.entity_id as string;
      if (!asserted.has(key)) asserted.set(key, new Set());
      asserted.get(key)!.add((r.value as string).replace(/&amp;/g, "&"));
    }
  } catch {
    /* evidence DB predates the table; not all 13 have every table */
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Arbitrate each id.
// ---------------------------------------------------------------------------
interface Verdict {
  id: string;
  verdict: "EVIDENCE_SUPPORTS_MASTER" | "EVIDENCE_SUPPORTS_PUBLISHED" | "UNRESOLVED";
  published: { name: string; slug: string; paidUpCapitalCrore: number | null; capitalClaim: string };
  master: { name: string; slug: string; official_website: string | null; operation_date: string | null };
  evidence: { domains: string[]; asserted_names: string[]; corroborates: string };
  /** Present only on reconstructed entries: the correction has already shipped. */
  applied_correction?: {
    corrected_to: { name: string; slug: string };
    slug_redirect: { old_slug: string; moved_to: string };
    capital_action: string;
    baseline: string;
  };
}

function arbitrate(p: Row): Verdict | null {
  const id = p.id as string;
  const m = masterById.get(id);
  if (!m) {
    return {
      id,
      verdict: "UNRESOLVED",
      published: { name: p.name as string, slug: p.slug as string, paidUpCapitalCrore: (p.paidUpCapitalCrore as number) ?? null, capitalClaim: "n/a" },
      master: { name: "ABSENT FROM MASTER", slug: "", official_website: null, operation_date: null },
      evidence: { domains: [...(domains.get(id) ?? [])], asserted_names: [...(asserted.get(id) ?? [])], corroborates: "id missing from master.json" },
    };
  }
  if (m.name_en === p.name) return null;

  const mh = hostOf(m.official_website as string);
  const evDomains = [...(domains.get(id) ?? [])].sort();
  const domainMatch = mh ? evDomains.some((d) => d === mh || d.endsWith("." + mh) || mh.endsWith("." + d)) : false;

  // A directly asserted full legal name is stronger than a bare domain match.
  const pubKey = norm(p.name as string);
  const assertedNames = [...(asserted.get(id) ?? [])].sort();
  const nameHit = assertedNames.find((a) => {
    const an = norm(a.replace(/\s*[-|].*$/, ""));
    if (!an) return false;
    return an === pubKey || (mh && a.toLowerCase().includes(mh));
  });

  let verdict: Verdict["verdict"] = "UNRESOLVED";
  let corroborates = "nothing in the evidence layer bears on this id";
  if (nameHit && mh && nameHit.toLowerCase().includes(mh)) {
    verdict = "EVIDENCE_SUPPORTS_MASTER";
    corroborates = `evidence asserts the legal name "${nameHit}" from ${mh}, which is master.json's website`;
  } else if (domainMatch) {
    verdict = "EVIDENCE_SUPPORTS_MASTER";
    corroborates = `evidence binds ${id} to ${mh} (master.json's website); no evidence binds it to any published identity`;
  }

  const capEvidence = (p.evidence as Row | undefined)?.paidUpCapitalCrore as Row | undefined;
  return {
    id,
    verdict,
    published: {
      name: p.name as string,
      slug: p.slug as string,
      paidUpCapitalCrore: (p.paidUpCapitalCrore as number) ?? null,
      capitalClaim: capEvidence
        ? `grade ${capEvidence.grade}, sourceId ${capEvidence.sourceId}, asOf ${capEvidence.asOf ?? "n/a"}`
        : "unstamped",
    },
    master: {
      name: m.name_en as string,
      slug: m.slug as string,
      official_website: (m.official_website as string) ?? null,
      operation_date: (m.operation_date as string) ?? null,
    },
    evidence: { domains: evDomains, asserted_names: assertedNames, corroborates },
  };
}

const verdicts: Verdict[] = [];
for (const p of published) {
  const v = arbitrate(p);
  if (v) verdicts.push(v);
}

// ---------------------------------------------------------------------------
// Historical reconstruction.
//
// After apply-identity-corrections.ts ran, published name == master name, so
// the live comparison above finds 0 conflicts — but the 16 disputes really
// happened and the file must keep them: apply-identity-corrections.ts promises
// "the original claim is preserved in data/master/disputed-identities.json".
// The pre-correction published module lives in git at PRE_CORRECTION_REF, and
// the redirects written by the apply script name every corrected id.
// ---------------------------------------------------------------------------
const PRE_CORRECTION_REF = "14b96d4"; // last commit before apply-identity-corrections.ts ran

function loadPreCorrectionModule(): { rows: Row[] } | null {
  try {
    const src = execFileSync("git", ["show", `${PRE_CORRECTION_REF}:src/data/institutions.ts`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const tok = "export const institutions: Institution[] = ";
    const start = src.indexOf(tok) + tok.length;
    if (start < tok.length) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return null;
    return { rows: new Function(`return ${src.slice(start, end)}`)() as Row[] };
  } catch {
    return null;
  }
}

const historical: Verdict[] = [];
const pre = loadPreCorrectionModule();
if (pre) {
  const preById = new Map<string, Row>(pre.rows.map((r) => [r.id as string, r]));
  for (const a of slugAliases) {
    const p = preById.get(a.institution_id as string);
    if (!p) continue;
    const v = arbitrate(p);
    if (!v) continue;
    v.applied_correction = {
      corrected_to: { name: v.master.name, slug: v.master.slug },
      slug_redirect: { old_slug: a.old_slug as string, moved_to: a.moved_to as string },
      capital_action:
        "nulled on correction — the claim cited nrb-kfi (a different NRB source) and cannot be re-attributed to the corrected identity offline",
      baseline: `git ${PRE_CORRECTION_REF}:src/data/institutions.ts (pre-correction published module)`,
    };
    historical.push(v);
  }
}

// ---------------------------------------------------------------------------
// Non-identity field drift: report, do not conflate with identity conflicts.
// ---------------------------------------------------------------------------
const fieldDrift: { id: string; field: string; published: unknown; master: unknown }[] = [];
const F: [keyof Row, string][] = [
  ["operationDate", "operation_date"],
  ["headOffice", "head_office_address"],
  ["workingArea", "working_area"],
];
for (const p of published) {
  const m = masterById.get(p.id as string);
  if (!m) continue;
  if ((m.name_en as string) !== p.name) continue; // already reported as identity conflict
  for (const [pubKey, masKey] of F) {
    const a = p[pubKey as string];
    const b = m[masKey];
    if (a == null && b == null) continue;
    if (String(a ?? "") !== String(b ?? "")) {
      fieldDrift.push({ id: p.id as string, field: pubKey, published: a, master: b });
    }
  }
}

// ---------------------------------------------------------------------------
// Merge lineage recoverable from timeline_events. master.aliases[] carries only
// NAME_ALT, but the canonical FORMER aliases (P1-B) close the gap in a separate
// file + the durable store. Report closure, not the raw master-only gap.
// ---------------------------------------------------------------------------
const FORMER_PATH = join(ROOT, "data", "master", "canonical-former-aliases.json");
const timeline = master.timeline as Row[];
const predecessorNames = [...new Set(timeline.map((e) => e.predecessor_name).filter(Boolean))] as string[];
const aliasNames = new Set((master.aliases as Row[]).map((a) => norm(a.alias as string)));
const canonicalFormer = existsSync(FORMER_PATH)
  ? (JSON.parse(readFileSync(FORMER_PATH, "utf8")).rows as Row[])
  : [];
const formerNames = new Set(canonicalFormer.map((r) => norm(r.alias as string)));
const unreachableLineage = predecessorNames.filter((n) => !aliasNames.has(norm(n)) && !formerNames.has(norm(n)));
const closedByFormer = predecessorNames.filter((n) => formerNames.has(norm(n))).length;

const supportingMaster = verdicts.filter((v) => v.verdict === "EVIDENCE_SUPPORTS_MASTER").length;
const appliedSupportingMaster = historical.filter((v) => v.verdict === "EVIDENCE_SUPPORTS_MASTER").length;

const register = {
  generated_by: "scripts/build-disputed-identity-register.ts",
  purpose:
    "Identity conflict between src/data/institutions.ts (published) and data/master/master.json (NRB capture, source nrb-bfi-mid-may-2026). Recorded, NOT auto-resolved.",
  authority_rule:
    "master.json is the NRB capture and outranks the published module. Where the evidence layer backs master.json, the published identity is wrong. No disputed identity is deleted anywhere in this file.",
  not_auto_resolved_because: [
    "master.json holds no paid-up capital figure; the published capital values cite nrb-kfi, a different NRB source, so capital cannot be re-attributed to the corrected identities offline.",
    "The published slugs are in the live URL space, so correcting identity requires slug_aliases redirects — a routing decision, not a data edit.",
  ],
  inputs: {
    master_json_sha256: createHash("sha256")
      .update(readFileSync(MASTER_PATH, "utf8").replace(/\r\n/g, "\n"), "utf8")
      .digest("hex"),
    published_module: "src/data/institutions.ts",
    evidence_databases_read: dbCount,
    evidence_databases_present: readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".db")).length,
    historical_baseline: `${PRE_CORRECTION_REF}:src/data/institutions.ts`,
  },
  summary: {
    ids_compared: published.length,
    identity_agreements: published.length - verdicts.length,
    identity_conflicts: verdicts.length,
    evidence_supports_master: supportingMaster,
    unresolved: verdicts.filter((v) => v.verdict === "UNRESOLVED").length,
    applied_corrections: historical.length,
    applied_evidence_supports_master: appliedSupportingMaster,
    non_identity_field_drift: fieldDrift.length,
    merge_predecessor_names_unreachable_by_alias: unreachableLineage.length,
    merge_predecessor_names_closed_by_canonical_former: closedByFormer,
  },
  identity_conflicts: verdicts,
  applied_identity_corrections: historical,
  non_identity_field_drift: fieldDrift,
  merge_lineage_gap: {
    note:
      "timeline_events records these absorbed predecessor names. master.aliases[] carries only NAME_ALT and must not be edited (it is fingerprinted), so closure lives outside master.json: canonical-former-aliases.json (P1-B) + the durable store backfill (P1-F). predecessor_names lists only names still unreachable by BOTH.",
    predecessor_names: unreachableLineage,
    closed_by_canonical_former_aliases: closedByFormer,
    canonical_former_aliases_file: "data/master/canonical-former-aliases.json",
  },
};

writeFileSync(OUT_PATH, JSON.stringify(register, null, 2) + "\n", "utf8");

console.log("P1 — disputed identity register");
console.log(`  wrote data/master/disputed-identities.json (${statSync(OUT_PATH).size} bytes)`);
console.log(`  ids compared        : ${register.summary.ids_compared}`);
console.log(`  live conflicts      : ${register.summary.identity_conflicts} (published now matches master)`);
console.log(`  applied corrections : ${historical.length} reconstructed, ${appliedSupportingMaster}/${historical.length} evidence-backs-master`);
console.log(`  live unresolved     : ${register.summary.unresolved}`);
console.log(`  non-identity drift  : ${fieldDrift.length}`);
console.log(`  lineage closed      : ${closedByFormer}/${predecessorNames.length} absorbed names now reachable via canonical FORMER aliases (${unreachableLineage.length} still unreachable)`);
for (const d of fieldDrift) console.log(`    drift: ${d.id} ${d.field} published=${JSON.stringify(d.published)} master=${JSON.stringify(d.master)}`);
console.log(
  "\nNo identity is rewritten by this script. The 16 applied corrections are recorded with their",
  "\npre-correction published identity and original capital claim preserved — see applied_identity_corrections.",
);