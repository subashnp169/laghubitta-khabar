// GENERATED FILE - do not edit. Run `npm run build:jobs` to rebuild.
//
// no vacancy published yet as of 2026-09-30: the M3.5 discovery pass parsed real pages and is recorded in data/pilot/career-source-registry.json, but it asserts no vacancy
//
// Every entry is a projection of a current, non-rejected VACANCY assertion row in
// data/pilot/evidence/pilot-careers-2026-09-29.db, and such a row exists only if
// evidence was fetched from an institution's own site and then published. No code
// path in this project can invent one. Do not add a row by hand: nothing downstream
// would be able to tell it from a real one.
//
// An empty list here has more than one possible reason, and the note above says
// which one applies. It is not the same as "nothing was found": the M3.5 discovery
// pass does parse real pages and records every candidate it sees, including the
// titles and counts, in data/pilot/career-source-registry.json. What it has never
// done is publish one. So read "no assertions" as "nothing published yet".

export interface Job {
  id: string;
  title: string;
  institution: string;
  location: string;
  type: string;
  deadline: string | null;
  description: string;
  slug: string;
  status: string;
  sourceName: string | null;
  lastSeenAt: string;
}

/** What this build was based on, shown by the page so the empty case is legible. */
export const jobsProvenance: string = "no vacancy published yet as of 2026-09-30: the M3.5 discovery pass parsed real pages and is recorded in data/pilot/career-source-registry.json, but it asserts no vacancy";

export const jobs: Job[] = [];
