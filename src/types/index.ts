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

export interface NrbCircular {
  id: string;
  title: string;
  date: string;
  category: string;
  summary: string;
  url: string;
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
