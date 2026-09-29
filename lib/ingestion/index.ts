// ============================================================================
// Ingestion facade — Phase C+D surface. Domain depends only on this barrel.
// Subsequent phases (engine, fetcher, discovery, extractor adapters) re-export
// here as they land; nothing is exported before it exists.
// ============================================================================

export * from "./types";
export * from "./contract";
export * from "./config";
export {
  classifyCoverage,
  countBranchRows,
  structuralDensities,
  structuralEvidence,
  type BranchCoverage,
  type CoverageInput,
  type CoverageVerdict,
  type StructureKind,
  type StructuralEvidence,
} from "./shape-signals";
export {
  analyzeBranchPage,
  isAssertableBranchAttribute,
  isAssertableBranchName,
  selectBranchRows,
  type AttributeTally,
  type BranchAttributeRejection,
  type BranchAttributeVerdict,
  type BranchPageAnalysis,
  type BranchPath,
} from "./structured";
export {
  canonicalizeHtml,
  createSha256Hex,
  deterministicHtmlCanonicalizer,
} from "./canonical";
export {
  ControlledFetcher,
  DEFAULT_POLICY,
  FetcherPolicyError,
  assertUrlAllowed,
  assertResolvedAddresses,
  hostLooksLocal,
  isPrivateV4,
  isPrivateV6,
  type ControlledFetchInput,
  type ControlledFetchOutput,
  type FetcherPolicy,
} from "./fetcher";
export { nodeResolveHost } from "./fetcher.node";
export {
BrowserDiscovery,
DISCOVERY_HINT_RULES,
locateCapabilityForUrl,
extractSameHostLinks,
normalizeDiscoveredUrl,
parseRobotsSitemap,
parseSitemapLocs,
type DiscoveryConfig,
type DiscoveryRule,
} from "./discovery";
export {
extractPeopleCandidates,
scorePeopleLink,
MAX_PEOPLE_CANDIDATES,
type PeopleCandidate,
type PeopleLinkInput,
type PeopleLinkScore,
} from "./people-discovery";
export { buildEngine, GenericIngestionEngine } from "./engine";
export {
  emailFormatValidator,
  pilotValidators,
  titlePresentValidator,
} from "./validators";
export {
  PEOPLE_CAPABILITIES,
  PEOPLE_DIRECTORY_RULE_ID,
  PEOPLE_JSON_PARSER_ID,
  PEOPLE_PARSER_ID,
  composeExtractors,
  extractPeopleJson,
  nameLike,
  peopleDirectoryValidator,
  peopleExtractor,
  peopleRoleFamily,
  peopleValidators,
  type HtmlExtractor,
  type PeopleCapability,
} from "./people";
export {
  BRANCH_DIRECTORY_RULE_ID,
  BRANCH_PARSER_ID,
  FINANCIAL_METADATA_RULE_ID,
  FINMETADATA_PARSER_ID,
  NRB_LISTING_RULE_ID,
  NRB_LISTING_PARSER_ID,
  VACANCY_RULE_ID,
  VACANCY_PARSER_ID,
  branchDirectoryExtractor,
  branchDirectoryValidator,
  financialMetadataExtractor,
  financialMetadataValidator,
  nrbListingExtractor,
  nrbListingValidator,
  nrbStructuredValidators,
  structuredValidators,
  vacancyExtractor,
  vacancyValidator,
} from "./structured";
export { LocalSqliteEvidenceWriter, LocalSourceRegistry } from "./adapters/local";
export {
  DATA_API_PARSER_ID,
  DataApiConfigError,
  dataApiDocumentSlug,
  extractDataApiPayload,
  parseDataApiConfig,
  runDataApiPass,
  type DataApiConfig,
  type DataApiExtraction,
  type DataApiPassDeps,
  type DataApiPassOptions,
  type DataApiPassOutcome,
  type DataApiPassResult,
  type DataApiRoute,
} from "./dataapi";
export {
  flagPeopleConflicts,
  listOpenConflicts,
  resolveConflict,
  reviewAssertion,
  type FlagConflictsInput,
  type OpenConflictRow,
  type ResolveConflictInput,
  type ReviewAssertionInput,
  type ReviewAssertionResult,
  type ReviewVerdict,
} from "./review";

// M3.4 extension: external branch evidence fallback.
export {
  BRANCH_SOURCE_DB_TYPE,
  BRANCH_SOURCE_GRADE,
  BRANCH_SOURCE_PRIORITY,
  applyExternalPlan,
  branchSourcePriority,
  buildBranchSourcePlan,
  changedExternalFields,
  decideBranchEvidence,
  diffExternalRecords,
  externalBranchEntityId,
  externalRecordFingerprint,
  indexExternalRecordState,
  mapExternalHeader,
  matchInstitution,
  officialAllowsExternalFallback,
  parseExternalBranchTable,
  planExternalRepeat,
  reconcileBranchEvidence,
  registryFirstOfType,
  registryForInstitution,
  type BranchDiscoveryMethod,
  type BranchEvidenceClaim,
  type BranchEvidenceCoverage,
  type BranchEvidenceDecision,
  type BranchFieldConflict,
  type BranchReconciliation,
  type BranchReconciliationStatus,
  type BranchSourcePlan,
  type BranchSourcePlanEntry,
  type BranchSourceRegistry,
  type BranchSourceSpec,
  type BranchSourceType,
  type ExternalBranchField,
  type ExternalBranchRecord,
  type ExternalBranchTable,
  type ExternalColumnMap,
  type ExternalRecordChange,
  type ExternalRecordDelta,
  type ExternalRecordState,
  type ExternalRejectedRow,
  type ExternalRepeatPlan,
  type ExternalSourceAvailability,
  type ExternalWrite,
  type InstitutionCandidate,
  type InstitutionMatch,
  type InstitutionMatchMethod,
  type OfficialBranchSourceRef,
} from "./branch-external";