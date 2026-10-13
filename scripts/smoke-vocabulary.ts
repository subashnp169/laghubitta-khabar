// ============================================================================
// P1-7 — uniform status vocabulary acceptance tests.
//
// `docs/DATA-STATUS-VOCABULARY.md` requires one vocabulary for statuses across
// every page. These assert the shared `src/util/evidence.ts` mapping is the
// single authority for source health, run outcome, and evidence field state, so
// a page can no longer invent its own label or tone.
//
// Run: npm run smoke:vocabulary
// ============================================================================
import {
  BRANDING_NOTE,
  fieldState,
  institutionStatus,
  isCurrentInstitution,
  isVerifiedWebsite,
  runStatus,
  sourceStatus,
  UNKNOWN_LABEL,
  verificationStatus,
  websiteStatus,
} from "../src/util/evidence";
import { institutions } from "../src/data/institutions";

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

// Source health: every token the ingestion UI and the database use must resolve
// to a labelled, toned presentation — no page-local map.
for (const token of ["HEALTHY", "DEGRADED", "UNHEALTHY", "ERROR", "PAUSED", "NEVER-RUN", "never_run"]) {
  const s = sourceStatus(token);
  check(`sourceStatus(${token}) labelled`, s.label.length > 0 && s.label !== token);
}
check("sourceStatus(UNHEALTHY) tone conflict", sourceStatus("UNHEALTHY").tone === "conflict");
check("sourceStatus(ERROR) shares UNHEALTHY label", sourceStatus("ERROR").label === sourceStatus("UNHEALTHY").label);
check("sourceStatus hyphens fold (NEVER-RUN == NEVER_RUN)", sourceStatus("NEVER-RUN").label === sourceStatus("NEVER_RUN").label);
check("sourceStatus(null) is not a raw token", !/null|undefined/i.test(sourceStatus(null).label));

// Run outcome: the ingestion page's local LAST_RUN_TONE vocabulary now lives here.
for (const token of ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED"]) {
  const s = runStatus(token);
  check(`runStatus(${token}) labelled`, s.label.length > 0);
}
check("runStatus(SUCCESS) tone positive", runStatus("SUCCESS").tone === "positive");
check("runStatus(FAILED) tone conflict", runStatus("FAILED").tone === "conflict");

// Evidence field state: lowercase domain tokens resolve without a page map.
for (const token of ["candidate", "verified", "pending_reverification"]) {
  const s = fieldState(token);
  check(`fieldState(${token}) labelled`, s.label.length > 0 && s.label !== token);
}
check("fieldState(verified) tone positive", fieldState("verified").tone === "positive");
check("fieldState(pending_reverification) tone attention", fieldState("pending_reverification").tone === "attention");

// Verification status still resolves through the same module.
check("verificationStatus resolves a known token", verificationStatus("human_verified").label.length > 0);

// The canonical unknown word is exported, not re-invented per page.
check("UNKNOWN_LABEL is canonical", UNKNOWN_LABEL === "Unknown");

// Institution lifecycle (P0-5). The vocabulary is fixed by
// docs/INSTITUTION-MASTER-MODEL.md, and anything other than ACTIVE means the
// institution is not current — it must read as historical, never as a current
// licensed institution.
for (const token of ["ACTIVE", "MERGED", "ACQUIRED", "LIQUIDATED", "CLOSED", "SUSPENDED", "HISTORICAL", "LICENSE STATUS UNKNOWN"]) {
  const s = institutionStatus(token);
  check(`institutionStatus(${token}) labelled`, s.label.length > 0 && s.label !== token);
}
check("institutionStatus(ACTIVE) is current", isCurrentInstitution("ACTIVE"));
check("institutionStatus(ACTIVE) tone positive", institutionStatus("ACTIVE").tone === "positive");
check("institutionStatus(MERGED) not current", !isCurrentInstitution("MERGED"));
check("institutionStatus(LIQUIDATED) not current", !isCurrentInstitution("LIQUIDATED"));
check("institutionStatus(SUSPENDED) not current", !isCurrentInstitution("SUSPENDED"));
check("institutionStatus(null) is not current and not a raw token", !isCurrentInstitution(null) && !/null|undefined/i.test(institutionStatus(null).label));
check("institutionStatus hyphen/space fold (LICENSE STATUS UNKNOWN == LICENSE_STATUS_UNKNOWN)", institutionStatus("LICENSE STATUS UNKNOWN").label === institutionStatus("LICENSE_STATUS_UNKNOWN").label);
check("institutionStatus(licensed) folds to ACTIVE", institutionStatus("licensed").label === institutionStatus("ACTIVE").label && isCurrentInstitution("licensed"));

// Every published institution carries a canonical lifecycle token. This is the
// regression guard: a row reverting to the old `licensed` literal fails here.
const CANONICAL_LIFECYCLE = new Set([
  "ACTIVE", "MERGED", "ACQUIRED", "LIQUIDATED", "CLOSED", "SUSPENDED", "HISTORICAL", "LICENSE_STATUS_UNKNOWN",
]);
for (const inst of institutions) {
  check(`institution ${inst.slug} lifecycle canonical (${inst.licenseStatus})`, CANONICAL_LIFECYCLE.has(inst.licenseStatus));
}

// Digital presence (P2-3): a website is official only when verified, and no
// brand asset is invented. `isVerifiedWebsite` is the single gate the pages use.
for (const token of ["VERIFIED", "CONFIRMED", "OFFICIAL", "verified"]) {
  check(`isVerifiedWebsite(${token}) is true`, isVerifiedWebsite(token));
}
for (const token of ["candidate", "UNVERIFIED", "", null, undefined, "pending_reverification"]) {
  check(`isVerifiedWebsite(${String(token)}) is false`, !isVerifiedWebsite(token as string | null | undefined));
}
for (const token of ["verified", "candidate", "UNVERIFIED", null]) {
  const s = websiteStatus(token);
  check(`websiteStatus(${String(token)}) labelled`, s.label.length > 0 && s.label !== token);
}
check("websiteStatus(verified) tone positive", websiteStatus("verified").tone === "positive");
check("websiteStatus(candidate) tone attention", websiteStatus("candidate").tone === "attention");
check("websiteStatus(null) is neutral and not a raw token", websiteStatus(null).tone === "neutral" && !/null|undefined/i.test(websiteStatus(null).label));
check("BRANDING_NOTE forbids guessed assets", /logo|colours/i.test(BRANDING_NOTE));
// No published institution exposes a brand asset field: nothing to guess from.
for (const inst of institutions) {
  const record = inst as unknown as Record<string, unknown>;
  check(`institution ${inst.slug} carries no logo/colour field`, record.logo === undefined && record.logoUrl === undefined && record.brandColor === undefined);
}
// A candidate website must never pass the official-website gate.
for (const inst of institutions) {
  if (inst.websiteStatus === "candidate") {
    check(`institution ${inst.slug} candidate website is not verified`, !isVerifiedWebsite(inst.websiteStatus));
  }
}

console.log(`\nsmoke:vocabulary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
