// ============================================================================
// Phase 2 (M2.1) — institution comparison projection. PURE domain module (no
// infra imports, no randomness, no AI): the side-by-side table is derived
// deterministically from the existing generated data modules (institutions,
// pilot crawl sources, NRB ledger). Missing data is null (rendered "—"), never
// invented, never 0. See docs/PHASE-2-DESIGN.md §1.
// ============================================================================

import type { CrawlSource, Institution, NrbDocument, NrbInstitutionLink, NrbRegulatoryEvent } from "@/types";

export type MetricKind = "text" | "number" | "date";

export interface CompareMetric {
  key: string;
  label: string;
  kind: MetricKind;
  /** For numeric metrics: "max" wins and is highlighted, "min" wins lowest. */
  best?: "max" | "min";
}

export interface CompareInstitution {
  id: string;
  slug: string;
  name: string;
  /** metric key → display value; null when the underlying data is absent. */
  series: Record<string, string | number | null>;
}

export interface CompareModel {
  metrics: CompareMetric[];
  institutions: CompareInstitution[];
  /** metric key → institution id that "wins" among the current selection. */
  leaders: Record<string, string | null>;
}

export const COMPARE_METRICS: CompareMetric[] = [
  { key: "licenseClass", label: "License class", kind: "text" },
  { key: "operationDate", label: "Operation date", kind: "date" },
  { key: "paidUpCapitalCrore", label: "Paid-up capital (NPR crore)", kind: "number", best: "max" },
  { key: "workingArea", label: "Working area", kind: "text" },
  { key: "coverageType", label: "Coverage", kind: "text" },
  { key: "headOffice", label: "Head office", kind: "text" },
  { key: "websiteStatus", label: "Website status", kind: "text" },
  { key: "branchCount", label: "Branches (web evidence)", kind: "number", best: "max" },
  { key: "vacancyCount", label: "Vacancies (web evidence)", kind: "number", best: "max" },
  { key: "documentCount", label: "Documents (web evidence)", kind: "number", best: "max" },
  { key: "snapshots", label: "Snapshots", kind: "number", best: "max" },
  { key: "lastStatus", label: "Source status", kind: "text" },
  { key: "nrbDocuments", label: "NRB docs matched", kind: "number", best: "max" },
  { key: "nrbEvents", label: "Regulatory events", kind: "number", best: "max" },
];

interface NrbInput {
  documents: NrbDocument[];
  links: NrbInstitutionLink[];
  events: NrbRegulatoryEvent[];
}

/** Build the full comparison model over all delivered deterministic data. */
export function buildCompareModel(
  institutions: Institution[],
  crawlSources: CrawlSource[],
  nrb: NrbInput,
): CompareModel {
  const crawlByInst = new Map<string, CrawlSource>();
  for (const c of crawlSources) crawlByInst.set(c.institutionId, c);

  const nrbDocsByInst = new Map<string, number>();
  const nrbEventsByInst = new Map<string, number>();
  const nrbLinksByInst = new Map<string, number>();
  for (const doc of nrb.documents) {
    const src = nrb.links.find((l) => l.nrbDocumentId === doc.id)?.institutionId;
    if (src) nrbDocsByInst.set(src, (nrbDocsByInst.get(src) ?? 0) + 1);
  }
  for (const link of nrb.links) nrbLinksByInst.set(link.institutionId, (nrbLinksByInst.get(link.institutionId) ?? 0) + 1);
  for (const ev of nrb.events) nrbEventsByInst.set(ev.institutionId, (nrbEventsByInst.get(ev.institutionId) ?? 0) + 1);

  const institutionRows: CompareInstitution[] = institutions.map((i) => {
    const crawl = crawlByInst.get(i.id);
    const series: Record<string, string | number | null> = {
      licenseClass: i.licenseClass,
      operationDate: i.operationDate,
      paidUpCapitalCrore: i.paidUpCapitalCrore ?? null,
      workingArea: i.workingArea,
      coverageType: i.coverageType,
      headOffice: i.headOffice,
      websiteStatus: i.websiteStatus,
      branchCount: crawl?.branchCount ?? null,
      vacancyCount: crawl?.vacancyCount ?? null,
      documentCount: crawl?.documentCount ?? null,
      snapshots: crawl?.snapshots ?? null,
      lastStatus: crawl?.status ?? null,
      nrbDocuments: nrbDocsByInst.get(i.id) ?? null,
      nrbEvents: nrbEventsByInst.get(i.id) ?? null,
    };
    return { id: i.id, slug: i.slug, name: i.name, series };
  });

  const model: CompareModel = { metrics: COMPARE_METRICS, institutions: institutionRows, leaders: {} };
  return recomputeLeaders(model);
}

/** Recompute metric leaders over the current institution selection. */
export function recomputeLeaders(model: CompareModel): CompareModel {
  const leaders: Record<string, string | null> = {};
  for (const m of model.metrics) {
    if (m.kind !== "number" || !m.best) {
      leaders[m.key] = null;
      continue;
    }
    let bestId: string | null = null;
    let bestVal: number | null = null;
    for (const inst of model.institutions) {
      const v = inst.series[m.key];
      if (typeof v !== "number") continue;
      const wins =
        bestId === null ||
        (m.best === "max" && v > (bestVal as number)) ||
        (m.best === "min" && v < (bestVal as number));
      if (wins) {
        bestId = inst.id;
        bestVal = v;
      }
    }
    leaders[m.key] = bestId ?? null;
  }
  return { ...model, leaders };
}

/** Subset the model to the given institution ids (preserving their order). */
export function selectCompare(model: CompareModel, ids: string[]): CompareModel {
  const byId = new Map(model.institutions.map((i) => [i.id, i]));
  const picked: CompareInstitution[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const inst = byId.get(id);
    if (inst && !seen.has(id)) {
      picked.push(inst);
      seen.add(id);
    }
  }
  return recomputeLeaders({ ...model, institutions: picked });
}

export default buildCompareModel;