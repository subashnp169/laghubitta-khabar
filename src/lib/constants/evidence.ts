export const EVIDENCE_STATUS = {
  VERIFIED: "VERIFIED",
  AUTO_VERIFIED: "AUTO_VERIFIED",
  HUMAN_VERIFIED: "HUMAN_VERIFIED",
  REPORTED: "REPORTED",
  PARTIAL: "PARTIAL",
  CONFLICT: "CONFLICT",
  STALE: "STALE",
  UNKNOWN: "UNKNOWN",
  NOT_EXTRACTED: "NOT_EXTRACTED",
  NOT_FOUND: "NOT_FOUND",
  HISTORICAL: "HISTORICAL",
} as const;

export const EVIDENCE_GRADE = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
} as const;

export const CURRENCY_STATE = {
  CURRENT: "CURRENT",
  RETIRED: "RETIRED",
  SUPERSEDED: "SUPERSEDED",
} as const;

export type EvidenceStatus = typeof EVIDENCE_STATUS[keyof typeof EVIDENCE_STATUS];
export type EvidenceGrade = typeof EVIDENCE_GRADE[keyof typeof EVIDENCE_GRADE];
export type CurrencyState = typeof CURRENCY_STATE[keyof typeof CURRENCY_STATE];
