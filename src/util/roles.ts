import type { PersonDto } from "../../lib/repository/types";

/**
 * Role titles for one person, pluralised where a source lists several names.
 *
 * Some notices name every officer of a committee in one row, so a source can
 * legitimately carry one title with several people behind it. Where that
 * happened the title is pluralised rather than printing a single role for a
 * shared post, and the pages that render it mark the row as multi-listed.
 *
 * This lived in two page files verbatim; it is here so both read the same.
 */
export function roleLabels(person: PersonDto): string {
  return person.positions
    .map((pos) =>
      pos.shared_by > 1 && pos.title.endsWith("Officer")
        ? pos.title.replace(/Officer$/, "Officers")
        : pos.title,
    )
    .join(", ");
}

/** True when any of this person's roles is held by more than one named person. */
export function hasSharedRole(person: PersonDto): boolean {
  return person.positions.some((pos) => pos.shared_by > 1);
}

/** The largest number of people any single role on this record is shared by. */
export function maxSharedBy(person: PersonDto): number {
  return Math.max(...person.positions.map((pos) => pos.shared_by));
}