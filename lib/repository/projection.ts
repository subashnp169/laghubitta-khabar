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
//   - Retired observations (valid_to set) are excluded entirely: a source that
//     stopped publishing a claim must not keep it on the page. Absent
//     valid_to means current, so the static generated module is unaffected.
//   - meta.verification_status: CONFLICT when the person's institution+field
//     has an OPEN data_conflicts row → else HUMAN_VERIFIED → AUTO_VERIFIED →
//     UNVERIFIED. Nuance: a review decision on one field of a multi-role
//     person marks the person overall (with every position still enumerating
//     its own evidence) — never an invented claim.
//   - last_verified_at = latest observation; source = first source that
//     asserted the person (provenance, not a guess); sources = EVERY source
//     that currently asserts this person, which is where corroboration comes
//     from under the source-owned observation model.
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
    /** Raw URL of the page this observation came from, when one is known. */
    source_url?: string | null;
    observed_at: string;
    /**
     * Set when the owning source retired this observation. Optional because the
     * static generated module carries no lifecycle; undefined reads as current.
     */
    valid_to?: string | null;
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

/**
 * Every distinct source that owns an observation backing one projected record,
 * sorted so the derived set is deterministic regardless of row order.
 *
 * This is the corroboration primitive for the canonical source-owned
 * observation model: because each source owns its own row, "these independent
 * sources assert this same normalized claim" is computed from the owning-source
 * set rather than inferred from the absence of duplicate rows. One entry means
 * a single source; two or more means corroborated by that many sources.
 *
 * Rows that a source has since retracted (superseded/stale) are filtered by the
 * caller, so a source that stopped reporting a claim is not counted as
 * corroborating it.
 */
function distinctSources(rows: readonly { source_id: string }[]): string[] {
  return [...new Set(rows.map((r) => String(r.source_id)))].sort();
}

export interface PeopleProjectionOptions {
  /** Open people conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
}

/**
 * Project raw evidence rows into PersonDto[]. Sorting is deterministic:
 * by institution name then person name. Rejects nothing except REJECTED
 * assertions, retired observations and non-person fields (field_name not
 * starting people_).
 *
 * Currency is enforced HERE, not at the call site, exactly as the branch
 * projector does it: a caller that forgets to filter still gets a correct read
 * model, and a claim its source has withdrawn can never surface as somebody's
 * current role by accident.
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
    // A retired observation is history: readable from the evidence layer with
    // valid_to surfaced, never published as a current claim.
    if (r.valid_to !== null && r.valid_to !== undefined) continue;
    const key = `${r.institution_id}|${String(r.value).trim()}`;
    const bucket = people.get(key);
    if (bucket) bucket.push(r);
    else people.set(key, [r]);
  }

  // How many distinct people this institution currently lists in each role
  // field. A role slot is not single-occupancy: an institution can list several
  // directors or a joint chief executive, and the read model must show that
  // honestly rather than implying only one of the names is real.
  const roleHolders = new Map<string, Set<string>>();
  for (const [key, bucket] of people) {
    const [institutionId, name] = key.split("|");
    for (const field of new Set(bucket.map((r) => String(r.field_name).toLowerCase()))) {
      const slot = `${institutionId}|${field}`;
      const names = roleHolders.get(slot);
      if (names) names.add(name);
      else roleHolders.set(slot, new Set([name]));
    }
  }

  const out: PersonDto[] = [];
  for (const [key, bucket] of people) {
    const [institutionId, name] = key.split("|");
    const first = bucket[0];
    const statuses = bucket.map((r) => String(r.verification_status));
    const roleFields = [...new Set(bucket.map((r) => String(r.field_name).toLowerCase()))];
    // Only an OPEN CONFLICT — a genuine disagreement between two independent
    // sources over the same field — degrades a record to CONFLICT. Several
    // names from ONE source under one heading is a multi-holder role, not a
    // contradiction, and must not make the record look less trustworthy than
    // the evidence actually is. The caller decides which keys are real
    // conflicts; the key set is trusted here by design.
    const conflict = roleFields.some((f) => open.has(`${institutionId}|${f}`));
    const lastVerified = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");
    const source = first.source_id;
    const meta: SourceMeta = {
      source,
      sources: distinctSources(bucket),
      source_url: first.source_url ?? null,
      last_verified_at: lastVerified || null,
      verification_status: effectiveStatus(statuses, conflict),
    };

    const positions: PersonDto["positions"] = roleFields
      .sort()
      .map((field) => {
        const sinceRows = bucket.filter((r) => String(r.field_name).toLowerCase() === field);
        const since = sinceRows.reduce((min, r) => (r.observed_at < min ? r.observed_at : min), sinceRows[0]?.observed_at ?? "");
        return {
          title: peopleRoleFieldTitle(field),
          committee: null,
          is_current: true,
          since: since || null,
          shared_by: roleHolders.get(`${institutionId}|${field}`)?.size ?? 1,
        };
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
// This is where supersession becomes VISIBLE. Branch assertions are retired when
// the same source revises an address, a district or a name, so
// branchesFromAssertionRows must exclude anything with valid_to set. People
// assertions are retired the same way since M3.6A, and the people projector
// applies the identical currency rule — one rule for every source-owned
// observation, no module-specific exception. A revised or withdrawn claim
// produces a STALE row that is still in the table and still carries its value,
// its source and its snapshot.
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
  /** Raw URL of the page this observation came from, when one is known. */
  source_url?: string | null;
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
          sources: distinctSources(bucket),
          source_url: first.source_url ?? null,
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

// ============================================================================
// Vacancy evidence projection (M3.5) — pure, provider-agnostic read model.
//
// The rules, and the reasons they are stricter than the branch projection:
//
//   - A vacancy is a distinct `entity_id` group. Identity is
//     `<institution>|<normalized title>|<normalized location>` and the URL,
//     the source and the dates are deliberately NOT part of it. A notice that
//     moves to a new URL, or gets reposted with a new date, is the same vacancy
//     with a changed field; a notice that changes its title or location is a
//     different one. That is a design decision, and the fixtures test it rather
//     than this function asserting it is right.
//   - A field is published only at confidence >= 0.5. A deadline recovered from
//     prose is stored at 0.45 and is deliberately NOT published as `deadline`; it
//     surfaces as `deadline_evidence` with its raw text, so a reader can see that
//     a deadline exists without the system claiming to know the date.
//   - A document (a PDF notice) is a vacancy-shaped entity with no fields. It
//     appears with `kind: "document"` and its link, never with invented contents.
//   - Lifecycle is derived, never asserted:
//       ACTIVE            a supported deadline is in the future, or none is known
//       EXPIRED           a supported deadline is in the past
//       CLOSED            an explicit closure marker was asserted
//       NOT_LISTED        previously seen, absent from the latest listing
//       SOURCE_UNAVAILABLE  the source itself could not be read
//     A failed fetch is SOURCE_UNAVAILABLE, never CLOSED, and a vacancy missing
//     from one listing is NOT_LISTED, never CLOSED.
// ============================================================================

import type { JobDto } from "./types";

/** Raw vacancy evidence row, as the repository adapters hand to the projection. */
export interface VacancyAssertionRecord {
  entity_id: string;
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  field_name: string;
  value: string;
  source_id: string;
  source_name?: string | null;
  /** Raw URL of the page this observation came from, when one is known. */
  source_url?: string | null;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
  confidence: number | null;
}

/**
 * Vacancy field name -> JobDto property. The uppercase names are the assertion
 * vocabulary written by lib/ingestion/career-evidence.ts; the lowercase names
 * are the same fields as the pre-M3.5 JSON API path wrote them, so both a new
 * careers run and an older fixture reach the same read model.
 */
const VACANCY_FIELD_ALIASES: Readonly<Record<string, string>> = {
  JOB_TITLE: "title",
  VACANCY_TITLE: "title",
  job_title: "title",
  title: "title",
  LOCATION: "location",
  VACANCY_LOCATION: "location",
  location: "location",
  EMPLOYMENT_TYPE: "type",
  VACANCY_EMPLOYMENT_TYPE: "type",
  employment_type: "type",
  job_type: "type",
  PUBLISHED_DATE: "posted_at",
  VACANCY_PUBLISHED_DATE: "posted_at",
  published_date: "posted_at",
  posted_at: "posted_at",
  DEADLINE: "deadline",
  VACANCY_DEADLINE: "deadline",
  deadline: "deadline",
  APPLICATION_URL: "application_url",
  VACANCY_APPLICATION_URL: "application_url",
  application_url: "application_url",
  CONTACT_EMAIL: "contact_email",
  VACANCY_CONTACT_EMAIL: "contact_email",
  contact_email: "contact_email",
  DEPARTMENT: "department",
  VACANCY_DEPARTMENT: "department",
  department: "department",
  REQUIREMENTS: "requirements",
  VACANCY_REQUIREMENTS: "requirements",
  requirements: "requirements",
  EDUCATION: "education",
  VACANCY_EDUCATION: "education",
  education: "education",
  EXPERIENCE: "experience",
  VACANCY_EXPERIENCE: "experience",
  experience: "experience",
  APPLICATION_METHOD: "application_method",
  VACANCY_APPLICATION_METHOD: "application_method",
  application_method: "application_method",
  SOURCE_DOCUMENT: "source_document",
  VACANCY_SOURCE_DOCUMENT: "source_document",
  source_document: "source_document",
  /** An explicit closure marker, when a source publishes one. Never inferred. */
  VACANCY_STATUS_CLOSED: "closed_marker",
};

/** The confidence at or above which a stored value is published as a fact. */
const VACANCY_PUBLISHABLE = 0.5;

/**
 * Lifecycle, as a read model. Deliberately separate from `JobDto.is_active`,
 * which collapses every non-active state into one boolean and therefore cannot
 * distinguish "the deadline passed" from "the source is down" from "we stopped
 * seeing it". Callers that need to explain themselves use this.
 */
export type VacancyStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "CLOSED"
  | "NOT_LISTED"
  | "UNKNOWN"
  | "CONFLICT"
  | "SOURCE_UNAVAILABLE";

/** How a vacancy was evidenced, which changes what may be said about it. */
export type VacancyKind = "POSTING" | "DOCUMENT";

/**
 * A vacancy as the read model exposes it. Extends JobDto additively: `JobDto`
 * stays frozen and every existing consumer keeps working, while the careers
 * detail a reader needs lives in the extra fields.
 */
export interface VacancyDto extends JobDto {
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  status: VacancyStatus;
  kind: VacancyKind;
  department: string | null;
  requirements: string | null;
  education: string | null;
  experience: string | null;
  application_method: string | null;
  application_url: string | null;
  contact_email: string | null;
  source_document: string | null;
  /**
   * A deadline that was read from page text at 0.45 and is therefore not
   * published as `deadline`. Present so a reader can see that the notice
   * mentions one, with the raw text and no claimed date.
   */
  deadline_evidence: string | null;
  /** Set when two sources disagree on a published field of this vacancy. */
  conflicts: string[];
  last_seen_at: string;
  source_name: string | null;
}

function isVacancyRow(r: VacancyAssertionRecord): boolean {
  return Object.prototype.hasOwnProperty.call(VACANCY_FIELD_ALIASES, String(r.field_name));
}

function vacancyRetired(r: VacancyAssertionRecord): boolean {
  return r.valid_to !== null && r.valid_to !== undefined;
}

function vacancyEffectiveStatus(statuses: string[], conflict: boolean): VerificationStatus {
  if (conflict) return "CONFLICT";
  if (statuses.includes("HUMAN_VERIFIED")) return "HUMAN_VERIFIED";
  if (statuses.includes("AUTO_VERIFIED")) return "AUTO_VERIFIED";
  return "UNVERIFIED";
}

export interface VacancyProjectionOptions {
  /** Open vacancy conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
  /**
   * `now` for lifecycle evaluation. Injected rather than read from the clock so
   * a test can place a deadline on either side of it and get a stable answer.
   */
  now?: string;
  /**
   * Entity ids observed in the most recent listing. A vacancy that was seen in an
   * earlier run but is absent here is NOT_LISTED — distinct from a vacancy that
   * was never seen, and never CLOSED.
   */
  listedEntityIds?: ReadonlySet<string>;
  /**
   * Sources whose most recent fetch failed. A vacancy whose only source is in
   * here is SOURCE_UNAVAILABLE, because nothing was learned about it, which is
   * not the same as it being closed.
   */
  unavailableSourceIds?: ReadonlySet<string>;
}

/**
 * Project ACTIVE vacancy evidence into VacancyDto[].
 *
 * Deterministic order: institution, then deadline (soonest first, undated
 * last), then title, then id.
 */
export function jobsFromAssertionRows(
  rows: VacancyAssertionRecord[],
  opts: VacancyProjectionOptions = {},
): VacancyDto[] {
  const open = opts.openConflictKeys ?? new Set<string>();
  const listed = opts.listedEntityIds;
  const unavailable = opts.unavailableSourceIds ?? new Set<string>();
  const now = opts.now ?? new Date(0).toISOString().slice(0, 10);

  const byEntity = new Map<string, VacancyAssertionRecord[]>();
  for (const r of rows) {
    if (!isVacancyRow(r)) continue;
    if (String(r.verification_status) === "REJECTED") continue;
    if (vacancyRetired(r)) continue;
    const bucket = byEntity.get(r.entity_id);
    if (bucket) bucket.push(r);
    else byEntity.set(r.entity_id, [r]);
  }

  const out: VacancyDto[] = [];
  for (const [entityId, bucket] of byEntity) {
    const first = bucket[0];

    // A field with several current values from one source is ambiguous. When the
    // values differ, none of them is published and the ambiguity is reported.
    const published = new Map<string, { value: string; confidence: number }>();
    const conflictedFields = new Set<string>();
    // A closure marker is not a field value, so it is tracked beside `published`
    // rather than inside it. Reading it back out of `published` cannot work:
    // the loop below deliberately skips it, so `published` never holds one.
    let closedMarker = false;

    for (const r of bucket) {
      const prop = VACANCY_FIELD_ALIASES[String(r.field_name)];
      const value = String(r.value).trim();
      if (!value) continue;
      if (prop === "closed_marker") {
        closedMarker = true;
        continue;
      }

      const known = published.get(prop);
      if (known && known.value !== value) {
        conflictedFields.add(prop);
        continue;
      }
      if (!known) published.set(prop, { value, confidence: r.confidence ?? 0 });
    }

    // The disputes this record is carrying, which are two different things and must
    // not be collapsed into one:
    //   - a field where sources currently disagree, found in the rows above;
    //   - a field with an open conflict row the caller has read out of
    //     data_conflicts, which is a dispute a human has not resolved yet and which
    //     may still be recorded after the sources have since converged.
    // Neither is invented here: both are read from something that exists. A caller
    // that knows nothing about conflict rows still gets the disagreements it can see.
    const conflicts: string[] = [...conflictedFields];
    for (const key of open) {
      if (!key.startsWith(`${entityId}|`)) continue;
      const fieldName = key.slice(entityId.length + 1);
      const prop = VACANCY_FIELD_ALIASES[fieldName];
      if (prop && prop !== "closed_marker" && !conflicts.includes(prop)) conflicts.push(prop);
    }

    const publishable = (prop: string): string | null => {
      if (conflictedFields.has(prop)) return null;
      const held = published.get(prop);
      if (!held) return null;
      return held.confidence >= VACANCY_PUBLISHABLE ? held.value : null;
    };

    // A title that two sources disagree about is still shown, because the read
    // model has no way to identify a vacancy without one and a record nobody can
    // name is less useful than a flagged one. It is never presented as agreed:
    // the disagreement puts `title` in `conflicts` and the row in CONFLICT, so a
    // consumer may not quote the wording as fact. Fields that can be omitted -
    // deadline, location, and the rest - are genuinely suppressed instead.
    const title = publishable("title") ?? String(published.get("title")?.value ?? "");
    const sourceDocument = publishable("source_document");
    // A PDF notice is a vacancy-shaped entity whose text was never read. It has no
    // asserted title, so the display title is the document's own filename. That is
    // a fact about the file, not a claim about what is inside it, and the read
    // model marks it `kind: "DOCUMENT"` so no caller can mistake it for a posting
    // with extracted fields.
    const kind: VacancyKind = sourceDocument !== null && !publishable("title") ? "DOCUMENT" : "POSTING";
    const displayTitle = title || (sourceDocument ? documentFileName(sourceDocument) : "");
    // Nothing to show and no document: there is no vacancy here.
    if (!displayTitle) continue;

    const deadline = publishable("deadline");
    const deadlineRaw = published.get("deadline");
    const deadlineEvidence =
      deadline === null && deadlineRaw && deadlineRaw.confidence < VACANCY_PUBLISHABLE
        ? deadlineRaw.value
        : null;

    const lastSeenAt = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");
    const sourceIds = [...new Set(bucket.map((r) => r.source_id))];
    const statuses = bucket.map((r) => String(r.verification_status));
    const conflict = conflictedFields.size > 0 || conflicts.length > 0;

    const status = resolveVacancyStatus({
      deadline,
      closed: closedMarker,
      listed: listed === undefined ? true : listed.has(entityId),
      // Only a live disagreement makes the record contradictory. A conflict row that
      // is still open after the sources converged is reported in `conflicts` and must
      // not keep the vacancy permanently out of the active set.
      conflicted: conflictedFields.size > 0,
      sources: sourceIds,
      unavailable,
      now,
    });

      const meta: SourceMeta = {
        source: first.source_id,
        sources: distinctSources(bucket),
        source_url: first.source_url ?? null,
        last_verified_at: lastSeenAt || null,
        verification_status: vacancyEffectiveStatus(statuses, conflict),
      };

    out.push({
      id: entityId,
      title: displayTitle,
      location: publishable("location"),
      type: publishable("type"),
      posted_at: publishable("posted_at"),
      deadline,
      // is_active is JobDto's coarse boolean: anything still open. A caller that
      // needs to say WHY uses `status`.
      is_active: status === "ACTIVE",
      meta,
      institution_id: first.institution_id,
      institution_slug: first.institution_slug,
      institution_name: first.institution_name,
      status,
      kind,
      department: publishable("department"),
      requirements: publishable("requirements"),
      education: publishable("education"),
      experience: publishable("experience"),
      application_method: publishable("application_method"),
      application_url: publishable("application_url"),
      contact_email: publishable("contact_email"),
      source_document: sourceDocument,
      deadline_evidence: deadlineEvidence,
      conflicts: [...new Set([...conflicts, ...conflictedFields])].sort(),
      last_seen_at: lastSeenAt,
      source_name: first.source_name ?? null,
    });
  }

  out.sort((a, b) => {
    if (a.institution_name !== b.institution_name) return a.institution_name < b.institution_name ? -1 : 1;
    // Undated vacancies sort after dated ones, then soonest deadline first.
    if (a.deadline !== b.deadline) {
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    }
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * The lifecycle rule, isolated so it can be tested on its own and so the reason
 * for a status is never lost.
 *
 * Precedence matters. An explicit closure marker outranks a date, because a
 * source that says "closed" knows more than a date we inferred. Unavailability
 * outranks everything else, because a source we could not read told us nothing
 * this run and its absence is not information about the vacancy. NOT_LISTED is
 * only reachable when a listing was actually observed, so an entity that was
 * never listed cannot be reported as having been removed.
 */
function resolveVacancyStatus(input: {
  deadline: string | null;
  closed: boolean;
  listed: boolean;
  conflicted: boolean;
  sources: string[];
  unavailable: ReadonlySet<string>;
  now: string;
}): VacancyStatus {
  if (input.closed) return "CLOSED";
  const anyReadable = input.sources.some((s) => !input.unavailable.has(s));
  if (!anyReadable) return "SOURCE_UNAVAILABLE";
  if (!input.listed) return "NOT_LISTED";
  // Two sources currently disagree on a published field of this vacancy. The record
  // contradicts itself, so it cannot be presented as a healthy open vacancy, and no
  // disputed value is published for it. It is not CLOSED either: a dispute about a
  // field says nothing about whether the vacancy is still advertised.
  if (input.conflicted) return "CONFLICT";
  // No known deadline means we cannot say it is over, so it stays open.
  if (input.deadline === null) return "ACTIVE";
  // ISO dates compare correctly as strings; both sides are YYYY-MM-DD.
  return input.deadline < input.now ? "EXPIRED" : "ACTIVE";
}

/** The file name of a document URL, or the URL itself when it has none. */
function documentFileName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

/** Slug for vacancy routes, derived from the identity key. */
export function vacancySlug(institutionSlug: string, entityId: string): string {
  const tail = entityId.split("|").slice(1).join("-");
  const slug = `${institutionSlug}-${tail}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.slice(0, 120);
}