// ============================================================================
// People evidence projection (M3.3) — pure, provider-agnostic read model.
// Turns raw data_assertions rows (field_name = people_*) into PersonDto[]
// records with provenance metadata. Shared by BOTH the D1/local repository
// adapters (lib/repository/d1.ts) and the static B2B API (lib/api/repository.ts
// over the generated src/data/people.ts module) so the projection is defined
// exactly once and has exactly one meaning everywhere.
//
// Rules (deterministic, no AI):
//   - A person is a distinct (institution_id, asserted name) group.
//   - Positions = distinct role families (people_chair/ceo/director/board).
//   - REJECTED assertions are excluded entirely (the claim was judged invalid);
//     a person with zero non-rejected assertions does not appear.
//   - meta.verification_status: CONFLICT when the person's institution+field
//     has an OPEN data_conflicts row → else HUMAN_VERIFIED → AUTO_VERIFIED →
//     UNVERIFIED. Nuance: a review decision on one field of a multi-role
//     person marks the person overall (with every position still enumerating
//     its own evidence) — never an invented claim.
//   - last_verified_at = latest observation; source = first source that
//     asserted the person (provenance, not a guess).
// ============================================================================

import type { PersonDto, SourceMeta, VerificationStatus } from "./types";

/** Raw person evidence row as the adapters/generators hand to the projection. */
export interface PersonAssertionRecord {
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  field_name: string;
  value: string;
  source_id: string;
  observed_at: string;
  verification_status: string;
  confidence: number | null;
}

/** Deterministic slug for people routes: <institution-slug>-<name-slug>. */
export function personSlug(institutionSlug: string, name: string): string {
  const nameSlug = name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${institutionSlug}-${nameSlug}`.slice(0, 120);
}

const ROLE_TITLES: Record<string, string> = {
  people_chair: "Chairperson",
  people_ceo: "Chief Executive Officer",
  people_director: "Director",
  people_board: "Board Member",
};

export function peopleRoleFieldTitle(field: string): string {
  const key = field.toLowerCase();
  return ROLE_TITLES[key] ?? field;
}

function effectiveStatus(statuses: string[], conflict: boolean): VerificationStatus {
  if (conflict) return "CONFLICT";
  if (statuses.includes("HUMAN_VERIFIED")) return "HUMAN_VERIFIED";
  if (statuses.includes("AUTO_VERIFIED")) return "AUTO_VERIFIED";
  return "UNVERIFIED";
}

export interface PeopleProjectionOptions {
  /** Open people conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
}

/**
 * Project raw evidence rows into PersonDto[]. Sorting is deterministic:
 * by institution name then person name. Rejects nothing except REJECTED
 * assertions and non-person fields (field_name not starting people_).
 */
export function peopleFromAssertionRows(
  rows: PersonAssertionRecord[],
  opts: PeopleProjectionOptions = {},
): PersonDto[] {
  const open = opts.openConflictKeys ?? new Set<string>();
  const people = new Map<string, PersonAssertionRecord[]>();

  for (const r of rows) {
    if (!String(r.field_name).toLowerCase().startsWith("people_")) continue;
    if (String(r.verification_status) === "REJECTED") continue;
    const key = `${r.institution_id}|${String(r.value).trim()}`;
    const bucket = people.get(key);
    if (bucket) bucket.push(r);
    else people.set(key, [r]);
  }

  const out: PersonDto[] = [];
  for (const [key, bucket] of people) {
    const [institutionId, name] = key.split("|");
    const first = bucket[0];
    const statuses = bucket.map((r) => String(r.verification_status));
    const roleFields = [...new Set(bucket.map((r) => String(r.field_name).toLowerCase()))];
    const conflict = roleFields.some((f) => open.has(`${institutionId}|${f}`));
    const lastVerified = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");
    const source = first.source_id;
    const meta: SourceMeta = {
      source,
      last_verified_at: lastVerified || null,
      verification_status: effectiveStatus(statuses, conflict),
    };

    const positions: PersonDto["positions"] = roleFields
      .sort()
      .map((field) => {
        const sinceRows = bucket.filter((r) => String(r.field_name).toLowerCase() === field);
        const since = sinceRows.reduce((min, r) => (r.observed_at < min ? r.observed_at : min), sinceRows[0]?.observed_at ?? "");
        return { title: peopleRoleFieldTitle(field), committee: null, is_current: true, since: since || null };
      });

    out.push({
      id: `person-${institutionId}-${personSlug(first.institution_slug, name)}`,
      slug: personSlug(first.institution_slug, name),
      name,
      institution_id: institutionId,
      institution_slug: first.institution_slug,
      positions,
      meta,
    });
  }

  out.sort((a, b) => (a.institution_slug < b.institution_slug ? -1 : a.institution_slug > b.institution_slug ? 1 : a.name.localeCompare(b.name)));
  return out;
}