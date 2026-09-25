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
export { LocalSqliteEvidenceWriter, LocalSourceRegistry } from "./adapters/local";