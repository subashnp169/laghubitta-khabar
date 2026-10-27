// ============================================================================
// Site data facade — the ONLY module allowed to import generated snapshots.
//
// WHY THIS FILE EXISTS
// The generated modules under src/data/* are BUILD OUTPUT, not source. They are
// rewritten by scripts/pilot-export*.ts, scripts/build-*-module.ts and
// scripts/generate-nrb-data.ts. Pages that import them directly create a
// dependency on generated shape, which is how the frontend silently drifts from
// the repository contract in lib/repository.
//
// THE RULE (enforced by scripts/check-discipline.cjs rule R6)
//   src/data/*        -> may be imported ONLY by this file.
//   src/lib/site-data -> the sanctioned read surface for pages, components, utils.
//   lib/repository    -> backend only. Never reachable from src/ (rule R5).
//
// Frontend is dumb by design (docs/ARCHITECTURE.md): it never touches D1 and
// never queries a database. It reads a build-time projection of the canonical
// store. The API Worker (worker/src) serves the same projections at runtime.
//
// Adding a new generated dataset? Re-export it here, then use it from
// @/lib/site-data everywhere. Do not widen the R6 allowlist.
// ============================================================================

// --- Canonical universe (src/data/institutions.ts) ---------------------------
export {
  institutions,
  directorySource,
  getInstitutionBySlug,
  getProvinceFromHeadOffice,
  slugAliases,
  getInstitutionSlugRedirect,
} from "@/data/institutions";

// --- Branches, as source-owned assertions (src/data/branches.ts) ------------
// Exported as assertions, not as resolved branch records: unresolved and
// conflicting branches must stay visible rather than silently dropped.
export { branchAssertions, openBranchConflicts } from "@/data/branches";

// --- People / leadership, as source-owned assertions (src/data/people.ts) ----
// Same rule as branches: assertions in, never pre-merged "truth" out.
export { peopleAssertions, openPeopleConflicts } from "@/data/people";

// --- Financial documents and rate notices (src/data/financials.ts) ---------
// Same rule as branches/people: raw source-owned assertions in, never a
// pre-merged document read model out. The FinancialDocumentDto projection is
// applied once, in lib/repository/projection.ts, and pages read it through
// lib/api/repository (allFinancialDocuments / institutionFinancials).
export { financialAssertions, openFinancialConflicts, financialsProvenance } from "@/data/financials";

// --- Careers (src/data/jobs.ts) --------------------------------------------
// NOTE: this module declares its own `Job`. src/types/index.ts declares a
// second, unused `Job`. The live shape wins here; the duplicate is tracked as
// dead type surface in docs/architecture/ASSET-DECISION-MATRIX.md (ADAPT table).
export { jobs, jobsProvenance } from "@/data/jobs";
export type { Job } from "@/data/jobs";

// --- General documents, title-only evidence (src/data/documents.ts) ---------
// Same rule as the layers above: raw source-owned assertions in, never a
// pre-merged read model out. The DocumentDto projection is applied once, in
// lib/repository/projection.ts, and pages read it through
// lib/repository/static-documents (allPublishedDocuments).
export { documentAssertions, openDocumentConflicts, documentsProvenance } from "@/data/documents";

// --- Corporate history: predecessor names (src/data/former-names.ts) --------
// The FORMER-alias lineage register (P8): the predecessor names a licensed
// institution absorbed through a merger, acquisition or rename. Keyed by
// canonical institution id. Read as `formerNames[institution.id]` ([] if none).
export { formerNames, formerNamesProvenance } from "@/data/former-names";
export type { FormerName, FormerEventType } from "@/data/former-names";

// --- Digital / social presence (P7) ---------------------------------------
export { officialWebsites, socialAccounts, digitalProvenance } from "@/data/social";
export type { OfficialWebsite, SocialAccount } from "@/data/social";

// --- Media / activity (P10): videos, posts, digital services ---------------
export { videos, posts, digitalServices, mediaProvenance } from "@/data/media";
export type { MediaVideo, MediaPost, MediaDigitalService } from "@/data/media";

// --- Snapshot diff (P4-1): what changed between two dated evidence runs -------
export { diffChanges, diffAlertsSource } from "@/data/diff-alerts";
export type { DiffChange } from "../../lib/diff";

// --- NRB regulatory layer (src/data/nrb.ts) -------------------------------
export {
  nrbSummary,
  nrbDocuments,
  nrbInstitutionLinks,
  nrbRegulatoryEvents,
} from "@/data/nrb";

// --- Ingestion/crawl transparency (src/data/pilot.ts) ----------------------
// These power /ingestion and /alerts. They expose source health to the public
// on purpose: coverage honesty is a product feature, not internal telemetry.
export { crawlSources, crawlSummary } from "@/data/pilot";

// --- Domain types (src/types/index.ts) ------------------------------------
// Type-only, so importing them does not create a runtime edge to generated data.
export type {
  Institution,
  NrbDocument,
  NrbInstitutionLink,
  NrbRegulatoryEvent,
  NrbSourceRef,
  NrbSummary,
  CrawlSource,
  CrawlSummary,
  CapabilityLocation,
} from "@/types";