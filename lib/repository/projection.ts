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

import type { DocumentDto, PersonDto, SourceMeta, VerificationStatus } from "./types";

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
  /** Title-only observations recorded against the institution entity (P2-D). */
  vacancy_title: "title",
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
    const agreedTitle = publishable("title");
    const rawTitle = String(published.get("title")?.value ?? "");
    // Withhold a title that is a bare call to action or the institution's own
    // registered name (the P2-D title plausibility gate): such a label names
    // nothing a job seeker could act on, and publishing it would credit the
    // source with a title it never gave. The raw value stays in the evidence
    // rows; it is simply not published — the record falls back to its notice
    // filename when there is a document URL, and is not published at all when
    // there is not.
    const gateHeldTitle = rawTitle !== "" && titleGateReason(rawTitle, first.institution_name) !== null;
    const title = gateHeldTitle ? "" : agreedTitle ?? rawTitle;
    const sourceDocument = publishable("source_document");
    // A PDF notice is a vacancy-shaped entity whose text was never read. It has no
    // asserted title, so the display title is the document's own filename. That is
    // a fact about the file, not a claim about what is inside it, and the read
    // model marks it `kind: "DOCUMENT"` so no caller can mistake it for a posting
    // with extracted fields. A record whose title was withheld by the gate lands
    // in the same place for the same reason: nothing readable was observed.
    const kind: VacancyKind = sourceDocument !== null && (gateHeldTitle || !agreedTitle) ? "DOCUMENT" : "POSTING";
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

// ============================================================================
// Financial document projection (P2-C) — pure, provider-agnostic read model.
//
// A financial record is a DOCUMENT and no more. The evidence states a URL and
// the source's own naming (a title, a report type, or a rate kind); the document
// body was never fetched and never parsed, so no metric and no numeric rate is
// ever derived here. That is the whole content of the public layer, and this
// projector is the single place that decides it.
//
// The pre-P2-C module was projected inside its builder and the API re-derived the
// owning institution from an `entity_id` prefix regex. Both facts made identity
// drift: the store's `institutions` copy uses pilot `mfi-0NN` numbering that does
// NOT match the public registry, so a document whose publisher was Mahila could
// be published under another company's name. Here identity is a plain column
// (`institution_slug`) written by the builder from the publisher -> registry
// resolution, so a consumer never re-parses an id to find the owner.
//
//   - A record is one `entity_id` group (the canonical `financial-<inst>|<url>`).
//   - A REJECTED claim and a retired observation (`valid_to` set) are excluded,
//     exactly as every other source-owned projection does.
//   - A generic link label ("Download", "Read more", "PDF") is not a title. It
//     is dropped and the document's own filename is shown instead — a fact about
//     the file, not a claim about its contents.
//   - An OPEN cross-source conflict on any field marks the record CONFLICT; it is
//     still shown (a document nobody can name is less useful than a flagged one)
//     but never quoted as agreed.
// ============================================================================

import type { FinancialDocumentDto, FinancialKind } from "./types";

/** Raw financial document evidence row, as the adapters hand to the projection. */
export interface FinancialAssertionRecord {
  entity_id: string;
  institution_id: string;
  institution_slug: string;
  institution_name: string;
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
 * Financial field name -> DocumentDto property. Uppercase names are the assertion
 * vocabulary written by lib/ingestion/financial-evidence.ts; the lowercase names
 * are accepted so an older JSON fixture reaches the same read model.
 */
const FINANCIAL_FIELD_ALIASES: Readonly<Record<string, "sourceDocument" | "title" | "reportType" | "rateKind">> = {
  SOURCE_DOCUMENT: "sourceDocument",
  source_document: "sourceDocument",
  DOCUMENT_TITLE: "title",
  document_title: "title",
  DOCUMENT_TYPE: "reportType",
  document_type: "reportType",
  RATE_KIND: "rateKind",
  rate_kind: "rateKind",
};

/**
 * A link's visible text is frequently its own call-to-action, not the document's
 * name. Publishing "Read more" as a document title would be a claim the source
 * never made, so the gate withholds it and the filename is used instead.
 */
const GENERIC_DOCUMENT_TITLE =
  /^(download|downloads?|read\s*more|readmore|view(\s*more)?|more|click(\s*here)?|here|details?|see\s*more|open|link|pdf|file|document|notice|english|nepali)$/i;

function urlFromEntityId(entityId: string): string | null {
  const tail = entityId.split("|").slice(1).join("|");
  return /^https?:\/\//i.test(tail) ? tail : null;
}

/** Deterministic slug for a financial document route. */
export function financialSlug(institutionSlug: string, url: string | null, entityId: string): string {
  const tail = url ? documentFileName(url) : entityId.split("|").slice(1).join("-") || entityId;
  const slug = `${institutionSlug || "unresolved"}-${tail}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.slice(0, 120);
}

export interface FinancialProjectionOptions {
  /** Open financial conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
}

/**
 * Project current financial document evidence into FinancialDocumentDto[].
 * Deterministic sort by institution then id.
 */
export function financialsFromAssertionRows(
  rows: FinancialAssertionRecord[],
  opts: FinancialProjectionOptions = {},
): FinancialDocumentDto[] {
  const open = opts.openConflictKeys ?? new Set<string>();
  const byEntity = new Map<string, FinancialAssertionRecord[]>();

  for (const r of rows) {
    if (!Object.prototype.hasOwnProperty.call(FINANCIAL_FIELD_ALIASES, String(r.field_name))) continue;
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) continue;
    const bucket = byEntity.get(r.entity_id);
    if (bucket) bucket.push(r);
    else byEntity.set(r.entity_id, [r]);
  }

  const out: FinancialDocumentDto[] = [];
  for (const [entityId, bucket] of byEntity) {
    const first = bucket[0];
    const pick = (target: "sourceDocument" | "title" | "reportType" | "rateKind"): string | null => {
      const hit = bucket.find((r) => FINANCIAL_FIELD_ALIASES[String(r.field_name)] === target);
      const v = hit?.value;
      return v !== undefined && String(v).trim().length > 0 ? String(v).trim() : null;
    };

    const sourceDocument = pick("sourceDocument") ?? urlFromEntityId(entityId);
    const institutionId = first.institution_id;
    const institutionSlug = first.institution_slug;
    const url = sourceDocument;
    const id = url ? `financial-${institutionId}|${url}` : entityId;

    let title = pick("title");
    if (title && GENERIC_DOCUMENT_TITLE.test(title)) title = null;
    const displayTitle = title ?? (url ? documentFileName(url) : entityId);

    const rateKind = pick("rateKind");
    const kind: FinancialKind = rateKind ? "RATE" : "REPORT";
    const conflict = bucket.some((r) => open.has(`${entityId}|${String(r.field_name)}`));
    const lastSeenAt = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");

    out.push({
      id,
      slug: financialSlug(institutionSlug, url, entityId),
      institution: first.institution_name || "(institution name not observed)",
      institution_id: institutionId,
      institution_slug: institutionSlug,
      title: displayTitle,
      kind,
      reportType: pick("reportType"),
      rateKind,
      sourceDocument: url,
      sourceName: first.source_url ?? null,
      lastSeenAt,
      status: conflict ? "CONFLICT" : "ACTIVE",
    });
  }

  out.sort((a, b) =>
    a.institution_slug !== b.institution_slug
      ? a.institution_slug < b.institution_slug
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  return out;
}

// ============================================================================
// General document projection (P2-D) — pure, provider-agnostic read model.
//
// These are the OTHER documents: not the financial layer (P2-C, keyed by URL)
// but every document an institution's own site linked and whose link text was
// asserted as evidence — `document_title` and `notice_title` rows. The evidence
// is title-only. No URL for the target was recorded, no publication date, no
// document type beyond the capability the row arrived under. So a published
// record carries (institution, exact title, owning source, observed_at) and
// nothing else: `official_url`, `go_slug` and `period` are null because nothing
// in evidence fills them, and a fabricated one would be a claim no source made.
//
//   - Identity is `document-<institution>|<title>`, established by the adapter
//     from the publisher -> registry resolution (helpers below), never parsed
//     back out of a pilot-numbered id by a consumer. One record per
//     (institution, exact title); sources asserting the same title corroborate
//     one record through the row set, not through absence of rows.
//   - REJECTED claims and retired observations are excluded, as everywhere.
//   - The title plausibility gate withholds a bare call to action ("Download",
//     "Read more") or the institution's own registered name — the same rule the
//     financial builder applies to DOCUMENT_TITLE, exercised here directly so
//     the D1 adapter and injected tests get it without going through a build.
//   - `doc_type` is an evidence fact: NOTICE when every row arrived under
//     `notice_title`, DOCUMENT otherwise. It is not a guessed document category.
//   - An OPEN cross-source dispute on the record's own title marks it CONFLICT.
//   - Unresolved owners never publish: a row whose institution could not be
//     resolved from its source publisher is evidence, not a public record.
// ============================================================================

/** Raw general document evidence row, as the adapters hand to the projection. */
export interface DocumentAssertionRecord {
  entity_id: string;
  institution_id: string;
  institution_slug: string;
  institution_name: string;
  /** `document_title` or `notice_title` — the capability the row arrived under. */
  field_name: string;
  /** The observed link text: the document's title, exactly as the source gave it. */
  value: string;
  source_id: string;
  /** Raw URL of the source page this observation came from, when one is known. */
  source_url?: string | null;
  observed_at: string;
  valid_to: string | null;
  verification_status: string;
  confidence: number | null;
}

/**
 * One whitespace-normalized observed title. The ONLY normalization applied to
 * an asserted title: link text arrives wrapped across lines or padded with
 * runs of spaces by the HTML it was read from, and two observations of one
 * title must collapse to one record. Case, punctuation and wording are the
 * source's own and are never touched.
 */
export function normalizeObservedTitle(v: string): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Institution-only identity key, the same normalization P2-A/P2-B/P2-C use to
 * match a source's publisher (or a title) against the public registry.
 */
function institutionIdentityKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\b(ltd|co|company|pvt|private)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical general document record identity: `document-<institution>|<title>`.
 * Constructed by every adapter (builder, D1) through this one function so the
 * static module and the runtime query can never disagree about what a record IS.
 */
export function documentEntityId(institutionId: string, title: string): string {
  return `document-${institutionId}|${normalizeObservedTitle(title)}`;
}

/**
 * Canonical vacancy record identity from whatever shape the evidence row has.
 * Two shapes exist and both are handled here so no adapter re-invents this:
 *
 *   - `vacancy-<rawInst>|<tail>` — an entity-keyed row (a parsed posting or an
 *     unread notice link). Only the institution segment is re-keyed to the
 *     canonical registry id; the tail (URL or title) is preserved byte-for-byte,
 *     because rebuilding it from a field value would split one record into two
 *     whenever the two differ in case or encoding.
 *   - an institution-keyed title-only observation (`vacancy_title` rows, P2-D):
 *     the record's identity IS (institution, title), so it is synthesized as
 *     `vacancy-<institution>|<normalized title>` here, at the one place every
 *     caller goes through.
 *
 * Returns the raw id unchanged when no canonical institution is known — the
 * caller withholds such rows from publication rather than publishing a pilot
 * number or inventing an owner.
 */
export function canonicalVacancyEntityId(
  rawEntityId: string,
  fieldName: string,
  value: string,
  institutionId: string,
): string {
  const raw = String(rawEntityId);
  if (raw.startsWith("vacancy-")) {
    if (!institutionId) return raw;
    const tail = raw.split("|").slice(1).join("|");
    return tail ? `vacancy-${institutionId}|${tail}` : raw;
  }
  if (institutionId && VACANCY_FIELD_ALIASES[String(fieldName)] === "title") {
    const title = normalizeObservedTitle(value);
    if (title) return `vacancy-${institutionId}|${title}`;
  }
  return raw;
}

/**
 * The title plausibility gate, shared by the document and vacancy layers.
 *
 * A title the source never actually gave — a call-to-action label ("Download",
 * "Read more") or the institution's own registered name standing in for a
 * document or vacancy — is withheld from publication. The reason is returned
 * rather than a boolean so a caller can report WHY something was held, and it
 * is a pure function so a test can exercise both branches without evidence.
 */
export function titleGateReason(
  title: string,
  institutionName: string,
): "GENERIC" | "OWN_NAME" | null {
  const t = normalizeObservedTitle(title);
  if (!t) return "GENERIC";
  // A period a scraper leaves on a link label - "Ltd." in the institution's
  // name, or after "Download" - is punctuation, not identity or meaning, so
  // the gate tests a dot-free form. The published title keeps its dots.
  const gateKey = (s: string): string =>
    normalizeObservedTitle(institutionIdentityKey(s).replace(/\./g, " "));
  const g = gateKey(t);
  if (!g) return "GENERIC";
  if (GENERIC_DOCUMENT_TITLE.test(g)) return "GENERIC";
  const own = gateKey(institutionName);
  if (own && g === own) return "OWN_NAME";
  return null;
}

/** Open dispute rows an adapter has resolved to canonical institution identity. */
export interface EvidenceConflictRow {
  entity_id: string;
  field_name: string;
  value_a?: string | null;
  value_b?: string | null;
  /** The canonical registry institution id this conflict belongs to, when resolved. */
  institution_id?: string | null;
}

/**
 * Turn raw OPEN cross-source conflicts into canonical document conflict records
 * (`{entity_id, field_name}` — the same shape every generated module stores).
 * The adapter resolves the conflict's institution (the same publisher/join
 * authority it uses for assertion rows); everything after that is deterministic
 * here so the builder and the D1 adapter cannot drift on what counts as a
 * disputed document.
 *
 * Conflicts are keyed at institution level in the store (`mfi-00X`,
 * `document_title`, two disputed values), so each disputed VALUE becomes the
 * document record it disputes. A conflict already keyed on a canonical
 * `document-` entity is passed through. A conflict whose institution could not
 * be resolved is skipped: an unowned dispute cannot be matched to a record, and
 * guessing an owner is exactly the drift this layer exists to prevent.
 */
export function documentConflictRows(
  conflicts: readonly EvidenceConflictRow[],
): Array<{ entity_id: string; field_name: string }> {
  const out: Array<{ entity_id: string; field_name: string }> = [];
  const seen = new Set<string>();
  const push = (entity_id: string, field_name: string): void => {
    const key = `${entity_id}|${field_name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entity_id, field_name });
  };
  for (const c of conflicts) {
    const field = String(c.field_name);
    const raw = String(c.entity_id);
    if (raw.startsWith("document-")) {
      push(raw, field);
      continue;
    }
    const inst = String(c.institution_id ?? "");
    if (!inst) continue;
    for (const v of [c.value_a, c.value_b]) {
      const title = normalizeObservedTitle(v ?? "");
      if (title) push(documentEntityId(inst, title), field);
    }
  }
  return out;
}

/**
 * The vacancy counterpart of documentConflictRows: entity-keyed conflicts
 * re-key their institution segment, institution-keyed `vacancy_title` disputes
 * synthesize one record per disputed title value.
 */
export function vacancyConflictRows(
  conflicts: readonly EvidenceConflictRow[],
): Array<{ entity_id: string; field_name: string }> {
  const out: Array<{ entity_id: string; field_name: string }> = [];
  const seen = new Set<string>();
  const push = (entity_id: string, field_name: string): void => {
    const key = `${entity_id}|${field_name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entity_id, field_name });
  };
  for (const c of conflicts) {
    const field = String(c.field_name);
    const raw = String(c.entity_id);
    const inst = String(c.institution_id ?? "");
    if (!inst) continue;
    if (raw.startsWith("vacancy-")) {
      push(canonicalVacancyEntityId(raw, field, "", inst), field);
      continue;
    }
    for (const v of [c.value_a, c.value_b]) {
      const value = String(v ?? "");
      if (value) push(canonicalVacancyEntityId(raw, field, value, inst), field);
    }
  }
  return out;
}

export interface DocumentProjectionOptions {
  /** Open document conflicts as `<entity_id>|<field_name>` keys. */
  openConflictKeys?: ReadonlySet<string>;
}

/**
 * Project current general document evidence into DocumentDto[].
 * Deterministic sort by institution slug, then record id.
 *
 * Rows are expected to carry canonical entity ids (built through
 * documentEntityId); a caller that feeds raw institution-keyed rows would
 * merge a whole institution's documents into one bucket, which is why both
 * adapters go through the helper instead of shaping ids themselves.
 */
export function documentsFromAssertionRows(
  rows: DocumentAssertionRecord[],
  opts: DocumentProjectionOptions = {},
): DocumentDto[] {
  const open = opts.openConflictKeys ?? new Set<string>();

  const byEntity = new Map<string, DocumentAssertionRecord[]>();
  for (const r of rows) {
    if (r.field_name !== "document_title" && r.field_name !== "notice_title") continue;
    if (String(r.verification_status) === "REJECTED") continue;
    if (r.valid_to !== null && r.valid_to !== undefined) continue;
    const bucket = byEntity.get(r.entity_id);
    if (bucket) bucket.push(r);
    else byEntity.set(r.entity_id, [r]);
  }

  const out: DocumentDto[] = [];
  for (const [entityId, bucket] of byEntity) {
    const first = bucket[0];
    // An owner that was never resolved is evidence, not a public record.
    if (!first.institution_id) continue;

    const title = normalizeObservedTitle(first.value);
    // The gate withholds the label; with no URL to fall back to (there is
    // never one in this layer), the record itself is not published.
    if (titleGateReason(title, first.institution_name)) continue;

    const conflict = [...open].some((key) => key.startsWith(`${entityId}|`));
    const lastSeenAt = bucket.reduce((max, r) => (r.observed_at > max ? r.observed_at : max), "");
    const statuses = bucket.map((r) => String(r.verification_status));
    // NOTICE is a claim about the capability the evidence arrived under, made
    // only when every row for this title used it; mixed evidence publishes the
    // general DOCUMENT rather than picking the narrower word.
    const doc_type = bucket.every((r) => r.field_name === "notice_title") ? "NOTICE" : "DOCUMENT";

    out.push({
      id: entityId,
      doc_type,
      title,
      // Never filled from a guess: this layer has no URL, no date, no period.
      official_url: null,
      go_slug: null,
      period: null,
      source_id: first.source_id,
      meta: {
        source: first.source_id,
        sources: distinctSources(bucket),
        source_url: first.source_url ?? null,
        last_verified_at: lastSeenAt || null,
        verification_status: effectiveStatus(statuses, conflict),
      },
      institution_id: first.institution_id,
      institution_slug: first.institution_slug,
      institution: first.institution_name || "(institution name not observed)",
      status: conflict ? "CONFLICT" : "ACTIVE",
    });
  }

  out.sort((a, b) =>
    a.institution_slug !== b.institution_slug
      ? a.institution_slug < b.institution_slug
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  return out;
}