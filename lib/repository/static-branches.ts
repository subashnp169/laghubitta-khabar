import { openBranchConflicts, branchAssertions } from "@/data/branches";
import {
  branchesFromAssertionRows,
  type BranchAssertionRecord,
} from "./projection";
import type { BranchDto } from "./types";

/**
 * Every publishable branch, projected once per process.
 *
 * Same contract as allPublishedPeople(): the generated evidence snapshot is
 * immutable within a build, the projection is deterministic, and static pages
 * and the API layer must read the exact same records.
 */
let cache: BranchDto[] | null = null;

export function allPublishedBranches(): BranchDto[] {
  if (cache) return cache;
  const openConflictKeys = new Set(
    openBranchConflicts.map((c) => `${c.entity_id}|${c.field_name}`),
  );
  cache = branchesFromAssertionRows(
    branchAssertions as unknown as BranchAssertionRecord[],
    { openConflictKeys },
  );
  return cache;
}