import { documentAssertions, openDocumentConflicts } from "@/data/documents";
import { documentsFromAssertionRows, type DocumentAssertionRecord } from "./projection";
import type { DocumentDto } from "./types";

/**
 * Every currently published general document, projected from the generated
 * src/data/documents.ts evidence snapshot (P2-D).
 *
 * Same contract as allPublishedPeople()/allPublishedBranches()/allPublishedFinancials():
 * the module holds raw source-owned assertions, and the single projection in
 * lib/repository/projection.ts gives them one meaning everywhere. The owning
 * institution is a column on each row, never re-derived from the entity id, and
 * the title plausibility gate runs here too so a module edit cannot smuggle a
 * call-to-action label onto the page.
 */
let cache: DocumentDto[] | null = null;

export function allPublishedDocuments(): DocumentDto[] {
  if (cache) return cache;
  cache = documentsFromAssertionRows(
    documentAssertions as unknown as DocumentAssertionRecord[],
    { openConflictKeys: new Set(openDocumentConflicts.map((c) => `${c.entity_id}|${c.field_name}`)) },
  );
  return cache;
}
