import { financialAssertions, openFinancialConflicts } from "@/data/financials";
import { financialsFromAssertionRows, type FinancialAssertionRecord } from "./projection";
import type { FinancialDocumentDto } from "./types";

/**
 * Every currently published financial document, projected from the generated
 * src/data/financials.ts evidence snapshot.
 *
 * Same contract as allPublishedPeople()/allPublishedBranches(): the module holds
 * raw source-owned assertions, and the single projection in
 * lib/repository/projection.ts gives them one meaning everywhere. The owning
 * institution is a column on each row, never re-derived from the entity id.
 */
let cache: FinancialDocumentDto[] | null = null;

export function allPublishedFinancials(): FinancialDocumentDto[] {
  if (cache) return cache;
  cache = financialsFromAssertionRows(
    (financialAssertions as unknown as FinancialAssertionRecord[]),
    { openConflictKeys: new Set(openFinancialConflicts.map((c) => `${c.entity_id}|${c.field_name}`)) },
  );
  return cache;
}