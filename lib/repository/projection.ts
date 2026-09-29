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

// ============================================================================
// Branch evidence projection (M3.4) — pure, provider-agnostic read model.
// ============================================================================
//
// This is where supersession becomes VISIBLE. M3.3 people assertions are never
// superseded, so peopleFromAssertionRows could ignore currency entirely. Branch
// assertions are: an address that is revised, a district that is corrected, a
// branch that is renamed all produce a STALE row that is still in the table and
// still carries its value, its source and its snapshot.
//
// So the read model and the evidence layer deliberately read the SAME rows and
// answer DIFFERENT questions:
//
//   branchesFromAssertionRows()        the current truth. Excludes anything with
//                                      valid_to set. This is what a public page,
//                                      a search index and a count must use.
//   branchAssertionHistory()           the full trail, ordered oldest first, for
//                                      review, audit and "when did this change?".
//
// Neither reads a table the other cannot. History is not deleted to make the read
// model clean; the read model simply declines to look at it. That is the whole
// point of writing valid_to instead of updating in place.
// ============================================================================

import type { BranchDto } from "./types";

/** Raw branch evidence row, as the repository adapters hand to the projection. */
export interface BranchAssertionRecord {
  entity_id: string;
  institution_id: string;
  institution_slug: string;
  field_name: string;
  value: string;
  source_id: string;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
  confidence: number | null;
}

/**
 * Both the official parser (BRANCH_NAME) and the external table path
 * (branch_name) write branch facts, under different field names. The read model
 * accepts either rather than making every caller normalise first.
 */
const BRANCH_FIELD_ALIASES: Readonly<Record<string, keyof Omit<BranchDto, "id" | "slug" | "meta">>> = {
  branch_name: "name",
  BRANCH_NAME: "name",
  branch_district: "district",
  BRANCH_DISTRICT: "district",
  district: "district",
  branch_municipality: "municipality",
  BRANCH_PLACE: "municipality",
  municipality: "municipality",
  branch_address: "address",
  BRANCH_ADDRESS: "address",
  address: "address",
  branch_phone: "phone",
  BRANCH_PHONE: "phone",
  phone: "phone",
  BRANCH_MOBILE: "phone",
  established_on: "established_on",
  BRANCH_ESTABLISHED_ON: "established_on",
  open_date: "established_on",
};

/** Slug for branch routes, derived from the identity key so it is stable. */
export function branchSlug(institutionSlug: string, entityId: string): string {
  const tail = entityId.split("|").slice(1).join("-");
  const slug = `${institutionSlug}-${tail}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.slice(0, 120);
}

export interface BranchProjectionOptions {
  /** Open branch conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
}

/** true when the row is a claim about a branch at all. */
function isBranchRow(r: BranchAssertionRecord): boolean {
  const f = String(r.field_name);
  return Object.prototype.hasOwnProperty.call(BRANCH_FIELD_ALIASES, f);
}

/** true when the row is no longer current and must not reach the read model. */
function isRetired(r: BranchAssertionRecord): boolean {
  return r.valid_to !== null && r.valid_to !== undefined;
}

/**
 * Project ACTIVE branch evidence into BranchDto[]. Deterministic sort by
 * institution then branch name then id.
 *
 * Currency is enforced here, not at the call site: a caller that forgets to
 * filter still gets a correct read model, and a superseded address can never
 * surface as a branch's current address by accident.
 */
export function branchesFromAssertionRows(
  rows: BranchAssertionRecord[],
  opts: BranchProjectionOptions = {},
): BranchDto[] {
  const open = opts.openConflictKeys ?? new Set<string>();
  const byEntity = new Map<string, BranchAssertionRecord[]>();

  for (const r of rows) {
    if (!isBranchRow(r)) continue;
    // A rejected claim was judged invalid; it is not history, it is noise.
    if (String(r.verification_status) === "REJECTED") continue;
    if (isRetired(r)) continue;
    const bucket = byEntity.get(r.entity_id);
    if (bucket) bucket.push(r);
    else byEntity.set(r.entity_id, [r]);
  }

  const out: BranchDto[] = [];
  for (const [entityId, bucket] of byEntity) {
    const first = bucket[0];
    const pick = (target: string): string | null => {
      const hit = bucket.find((r) => {
        const key = BRANCH_FIELD_ALIASES[String(r.field_name)];
        return key === target;
      });
      const v = hit?.value;
      return v !== undefined && String(v).trim().length > 0 ? String(v).trim() : null;
    };

    const name = pick("name");
    // A branch with no assertable name is not a branch. It must not appear as a
    // nameless row, and it certainly must not become a count.
    if (!name) continue;

    const statuses = bucket.map((r) => String(r.verification_status));
    const conflict = bucket.some((r) => open.has(`${entityId}|${String(r.field_name)}`));
    const lastVerified = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");

    out.push({
      id: `branch-${entityId}`,
      slug: branchSlug(first.institution_slug, entityId),
      name,
      // BranchDto types these as string; an unstated location is an empty string
      // here and stays null in the evidence layer, so a projection consumer
      // cannot mistake "not published" for a value that was published.
      district: pick("district") ?? "",
      municipality: pick("municipality") ?? "",
      address: pick("address"),
      phone: pick("phone"),
      established_on: pick("established_on"),
      meta: {
        source: first.source_id,
        last_verified_at: lastVerified || null,
        verification_status: effectiveStatus(statuses, conflict),
      },
    });
  }

  // entity_id is `<institution>|<normalized name>|<geo>` (branchIdentityKey), so
  // ordering by it is already institution, then name, then geography. No extra
  // sort field is needed, and BranchDto stays frozen.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * One historical claim, as the evidence/review layer needs it. Kept separate
 * from BranchDto on purpose: the public read model has no use for a superseded
 * value, and putting one in a shape the public layer already consumes is how a
 * stale address eventually ships to a page.
 */
export interface BranchHistoryEntry {
  entity_id: string;
  field_name: string;
  value: string;
  source_id: string;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
  is_current: boolean;
}

/**
 * The full assertion trail for branch entities, oldest observation first.
 * Superseded rows are included and flagged, never dropped — this is what makes
 * "this address changed on the 14th" answerable after the fact.
 */
export function branchAssertionHistory(
  rows: BranchAssertionRecord[],
  entityIds?: ReadonlySet<string>,
): BranchHistoryEntry[] {
  return rows
    .filter((r) => isBranchRow(r))
    .filter((r) => (entityIds ? entityIds.has(r.entity_id) : true))
    .map((r) => ({
      entity_id: r.entity_id,
      field_name: String(r.field_name),
      value: String(r.value),
      source_id: r.source_id,
      observed_at: r.observed_at,
      valid_to: r.valid_to ?? null,
      verification_status: String(r.verification_status),
      is_current: !isRetired(r),
    }))
    .sort((a, b) =>
      a.entity_id !== b.entity_id
        ? a.entity_id < b.entity_id
          ? -1
          : 1
        : a.observed_at !== b.observed_at
          ? a.observed_at < b.observed_at
            ? -1
            : 1
          : a.field_name < b.field_name
            ? -1
            : 1,
    );
}