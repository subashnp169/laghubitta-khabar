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
  composeExtractors,
  nameLike,
  peopleDirectoryValidator,
  peopleExtractor,
  peopleValidators,
  type HtmlExtractor,
} from "./people";
export {
  BRANCH_DIRECTORY_RULE_ID,
  BRANCH_PARSER_ID,
  FINANCIAL_METADATA_RULE_ID,
  FINMETADATA_PARSER_ID,
  VACANCY_RULE_ID,
  VACANCY_PARSER_ID,
  branchDirectoryExtractor,
  branchDirectoryValidator,
  financialMetadataExtractor,
  financialMetadataValidator,
  structuredValidators,
  vacancyExtractor,
  vacancyValidator,
} from "./structured";
export { LocalSqliteEvidenceWriter, LocalSourceRegistry } from "./adapters/local";