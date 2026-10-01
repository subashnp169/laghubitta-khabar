import { openPeopleConflicts, peopleAssertions } from "@/data/people";
import {
  peopleFromAssertionRows,
  type PersonAssertionRecord,
} from "./projection";
import type { PersonDto } from "./types";

/**
 * Every publishable person, projected once per process.
 *
 * The generated evidence snapshot is immutable within a build, so the projection
 * is deterministic and there is no reason to redo it per request. This exists so
 * static route generation (person pages, search indexes) and the API layer read
 * the exact same records — a person page can never disagree with
 * `GET /api/people/{slug}`.
 */
let cache: PersonDto[] | null = null;

export function allPublishedPeople(): PersonDto[] {
  if (cache) return cache;
  const openConflictKeys = new Set(
    openPeopleConflicts.map((c) => `${c.institution_id}|${c.field_name}`),
  );
  cache = peopleFromAssertionRows(
    peopleAssertions as unknown as PersonAssertionRecord[],
    { openConflictKeys },
  );
  return cache;
}
