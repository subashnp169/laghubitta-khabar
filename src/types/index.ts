export interface Institution {
  serial: number;
  id: string;
  slug: string;
  name: string;
  sourceNameRaw: string;
  licenseClass: string;
  licenseStatus: string;
  operationDate: string;
  operationDateIsJointAfterMerger: boolean;
  headOffice: string;
  paidUpCapitalCrore: number;
  workingArea: string;
  officialWebsite: string | null;
  websiteStatus: string;
  aliases: string[];
  evidence: Record<string, { grade: string; sourceId?: string; verifiedOn?: string; status?: string; asOf?: string }>;
  coverageType: string;
  operationDateStatus: string;
  operationDateNote?: string;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  author: string;
  publishedAt: string;
  image?: string;
}

export interface Job {
  id: string;
  title: string;
  institution: string;
  location: string;
  type: string;
  deadline: string;
  description: string;
  slug: string;
}

export interface Video {
  id: string;
  title: string;
  embedId: string;
  channel: string;
  duration: string;
  publishedAt: string;
}

export interface NrbSourceRef {
  id: string;
  title: string;
  publisher: string;
}

export interface NrbDocument {
  id: string;
  title: string;
  docType: string;
  topic: string | null;
  officialUrl: string;
  publishedAt: string | null;
  size: string | null;
  sourceId: string;
  sourceTitle: string;
}

export interface NrbInstitutionLink {
  id: string;
  institutionId: string;
  institutionSlug: string;
  institutionName: string;
  linkType: string;
  linkDate: string | null;
  nrbDocumentId: string | null;
}

export interface NrbRegulatoryEvent {
  id: string;
  institutionId: string;
  institutionSlug: string;
  institutionName: string;
  eventType: string;
  title: string;
  occurredAt: string | null;
  description: string;
}

export interface NrbSummary {
  generatedAt: string;
  observedAt: string;
  documents: number;
  documentsByType: Record<string, number>;
  institutions: number;
  institutionLinks: number;
  institutionLinksByType: Record<string, number>;
  regulatoryEvents: number;
  eventsByType: Record<string, number>;
  sources: NrbSourceRef[];
}

export interface Document {
  id: string;
  title: string;
  type: string;
  institution: string;
  date: string;
  size: string;
  url: string;
}

export interface ResearchItem {
  id: string;
  title: string;
  author: string;
  date: string;
  category: string;
  summary: string;
  url: string;
}

export interface ReportMetric {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
}

export interface IndustryReport {
  id: string;
  title: string;
  period: string;
  publishedAt: string;
  summary: string;
  metrics: ReportMetric[];
  category: string;
}

export interface CapabilityLocation {
  capability: string;
  knownUrl: string | null;
  note: string | null;
}

export interface CrawlSource {
  sourceId: string;
  institutionId: string;
  website: string;
  capabilities: string[];
  capabilityPages: CapabilityLocation[];
  runs: number;
  snapshots: number;
  items: number;
  documents: number;
  errors: number;
  changedItems: number;
  discoveredUrls: number;
  status: string;
  lastStatus: string | null;
  lastRun: string | null;
  branchCount: number;
  vacancyCount: number;
  documentCount: number;
  branchNames: string[];
  vacancyTitles: string[];
  documentTitles: string[];
}

export interface CrawlSummary {
  generatedAt: string;
  mode: string;
  institutions: number;
  sources: number;
  withEvidence: number;
  capabilitiesLocated: number;
  sourcesWithLocatedPages: number;
  runs: number;
  items: number;
  snapshots: number;
  documents: number;
  errors: number;
  fetchFailures: number;
  passCount: number;
  failCount: number;
  pendingCount: number;
  conflictsOpen: number;
  duplicateSnapshotGroups: number;
  pdfSnapshots: number;
  healthy: number;
  degraded: number;
}
