// ============================================================================
// Ingestion facade — Phase C+D surface. Domain depends only on this barrel.
// Subsequent phases (engine, fetcher, discovery, extractor adapters) re-export
// here as they land; nothing is exported before it exists.
// ============================================================================

export * from "./types";
export * from "./contract";
export * from "./config";
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
  parseRobotsSitemap,
  parseSitemapLocs,
  type DiscoveryConfig,
  type DiscoveryRule,
} from "./discovery";
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