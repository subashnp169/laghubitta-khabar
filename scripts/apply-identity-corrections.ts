// ============================================================================
// P1 — apply the identity corrections proven by build-disputed-identity-register.ts.
//
// For each of the 16 institutions where src/data/institutions.ts published the
// wrong identity (mfi-036 .. mfi-051), take the canonical record from
// data/master/master.json (the NRB capture) and preserve the superseded
// published identity as an alias so nothing is deleted.
//
// WHY EVERY IDENTITY FIELD IS REPLACED, NOT JUST THE NAME
//
// The wrong binding did not only corrupt the name. Published mfi-036 carried
// operationDate 2017-06-15 and headOffice "Biratnagar, Morang" — those are
// Surya Jyoti's facts. Sampada is 2024-07-13 in Bandipur, Tanahu. Correcting
// only the name would attach the wrong entity's date and address to the right
// name, which is worse than the original error. So name, slug, sourceNameRaw,
// operationDate, headOffice, workingArea, officialWebsite, licenseClass and
// coverageType are all taken from master.json for these 16 rows.
//
// PAID-UP CAPITAL
//
// Set to null. The published figures cited nrb-kfi (NRB Key Financial
// Indicators), a different source from the BFI directory, so they belonged to
// the wrong entity and cannot be re-attributed offline. master.json holds no
// capital column at all. The original claim is preserved in
// data/master/disputed-identities.json rather than discarded.
//
// SLUGS
//
// The 16 old slugs were live URLs. They are emitted as slugAliases and resolved
// by getInstitutionSlugRedirect() so the [slug] route can 301 them.
//
//   npx tsx scripts/apply-identity-corrections.ts            apply (idempotent)
//   npx tsx scripts/apply-identity-corrections.ts --dry-run report only
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const TARGET = join(ROOT, "src", "data", "institutions.ts");
const MASTER = join(ROOT, "data", "master", "master.json");
const DRY = process.argv.includes("--dry-run");

type Row = Record<string, unknown>;
const master = JSON.parse(readFileSync(MASTER, "utf8"));
const masterById = new Map<string, Row>((master.institutions as Row[]).map((i) => [i.id as string, i]));

const src = readFileSync(TARGET, "utf8");
const TOK = "export const institutions: Institution[] = ";
const head = src.indexOf(TOK);
if (head < 0) throw new Error("institutions export not found");
const arrStart = head + TOK.length;
let depth = 0;
let arrEnd = -1;
for (let i = arrStart; i < src.length; i++) {
  if (src[i] === "[") depth++;
  else if (src[i] === "]") {
    depth--;
    if (depth === 0) {
      arrEnd = i + 1;
      break;
    }
  }
}
const rows = new Function(`return ${src.slice(arrStart, arrEnd)}`)() as Row[];

// Preserve the file's exact row style: two-space indent, one JSON object per line.
const fmt = (r: Row) => "  " + JSON.stringify(r);

const conflicts = rows.filter((p) => {
  const m = masterById.get(p.id as string);
  return m && m.name_en !== p.name;
});
console.log(`identity conflicts found: ${conflicts.length}`);

const slugAliases: { old_slug: string; moved_to: string; institution_id: string; was: string }[] = [];
let changed = 0;

for (const p of rows) {
  const id = p.id as string;
  const m = masterById.get(id);
  if (!m || m.name_en === p.name) continue;

  const oldName = p.name as string;
  const oldSlug = p.slug as string;
  const timelineForId = (master.timeline as Row[]).filter((e) => e.institution_id === id);

  // Canonical identity + every identity-bearing field from the NRB capture.
  p.name = m.name_en;
  p.slug = m.slug;
  p.sourceNameRaw = m.name_en;
  p.licenseClass = m.nrb_class ?? p.licenseClass;
  p.operationDate = m.operation_date ?? p.operationDate;
  p.operationDateStatus = m.operation_date ? "source_published" : "not_published";
  if (!m.operation_date) delete p.operationDateNote;
  // A merge/acquisition means the surviving entity's current identity is post-merger.
  p.operationDateIsJointAfterMerger = timelineForId.length > 0;
  p.headOffice = m.head_office_address ?? p.headOffice;
  p.workingArea = m.working_area ?? p.workingArea;
  p.officialWebsite = m.official_website ?? null;
  const link = (master.officialLinks as Row[]).find((l) => l.institution_id === id && l.link_type === "WEBSITE");
  p.websiteStatus = link?.status === "VERIFIED" ? "verified" : "candidate";
  p.coverageType =
    m.institution_type === "NATIONAL" ? "national" : m.institution_type === "PROVINCIAL" ? "province" : (p.coverageType as string);

  // Capital: unverifiable against the corrected identity. Not invented, not kept.
  p.paidUpCapitalCrore = null;
  const ev = p.evidence as Row;
  ev.paidUpCapitalCrore = {
    grade: "UNVERIFIED",
    status: "pending_reverification",
  };

  // Superseded identity preserved, never deleted.
  const aliases = new Set(p.aliases as string[]);
  for (const a of (master.aliases as Row[]).filter((a) => a.institution_id === id)) {
    if (typeof a.alias === "string") aliases.add(a.alias);
  }
  aliases.add(oldName);
  aliases.add(oldName.replace(/ Ltd\.$/, " Limited"));
  aliases.delete(m.name_en as string);
  p.aliases = [...aliases];

  slugAliases.push({ old_slug: oldSlug, moved_to: m.slug as string, institution_id: id, was: oldName });
  changed++;
}

console.log(`rows corrected: ${changed}`);
for (const s of slugAliases) console.log(`  ${s.old_slug}\n    -> ${s.moved_to}   (was "${s.was}")`);

// ---------------------------------------------------------------------------
// Emit: replace the array literal, then append the slug-alias surface.
// ---------------------------------------------------------------------------
const aliasBlock = `

/**
 * Superseded slugs kept alive as permanent redirects.
 *
 * ${slugAliases.length} institutions were published under a name that the NRB capture
 * does not contain. Correcting the identity changes the canonical slug, but the
 * published slug was a live URL, so it must not 404. Each entry maps the old
 * slug to the institution that now answers for it.
 *
 * Generated by scripts/apply-identity-corrections.ts. The superseded name is
 * also retained on the institution as an alias, so a search for the old name
 * still resolves.
 */
export const slugAliases: { old_slug: string; moved_to: string; institution_id: string; was: string }[] = ${JSON.stringify(
  slugAliases,
  null,
  2,
)};

const SLUG_ALIAS_INDEX = new Map(slugAliases.map((a) => [a.old_slug, a.moved_to]));

/** The canonical slug an old slug now redirects to, or undefined if not a rename. */
export function getInstitutionSlugRedirect(slug: string): string | undefined {
  return SLUG_ALIAS_INDEX.get(slug);
}
`;

let out = src.slice(0, arrStart) + "[\n" + rows.map(fmt).join(",\n") + "\n]" + src.slice(arrEnd);

// Replace any previous generated alias block so reruns stay idempotent.
out = out.replace(/\n\/\*\*\n \* Superseded slugs kept alive[\s\S]*$/, "").trimEnd() + aliasBlock;

if (DRY) {
  console.log(`\n--dry-run: ${out.length} bytes would be written to src/data/institutions.ts`);
} else {
  writeFileSync(TARGET, out, "utf8");
  console.log(`\nwrote src/data/institutions.ts (${out.length} bytes)`);
}