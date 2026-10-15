/**
 * Rebuild `src/data/former-names.ts` from the canonical FORMER-alias register (P8).
 *
 * The register (`data/master/canonical-former-aliases.json`, built by P1-B) closes
 * the identity lineage: it lists the predecessor names a currently licensed
 * institution absorbed through a merger, acquisition or rename, each with the
 * event type the NRB lineage recorded and the source it came from. The generated
 * module the public profile reads is derived from that register and is never
 * hand-edited, so a former name on the page always traces to the same closed
 * lineage the identity checks use.
 *
 * Nothing is inferred here. A name reaches this module only because the master
 * register already carries it; the builder copies the event type and source
 * verbatim and does not invent a date, because the register does not record one.
 *
 * Run: npm run build:former-names
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const IN_PATH = join(ROOT, "data", "master", "canonical-former-aliases.json");
const OUT_PATH = join(ROOT, "src", "data", "former-names.ts");

type FormerEventType = "MERGED" | "ACQUIRED" | "RENAMED";

interface RegisterRow {
  institution_id: string;
  alias: string;
  alias_type: string;
  source_id: string;
  event_type: string;
}

const EVENT_TYPES: readonly FormerEventType[] = ["MERGED", "ACQUIRED", "RENAMED"];

function asEventType(value: string): FormerEventType | null {
  const up = String(value ?? "").toUpperCase();
  return (EVENT_TYPES as readonly string[]).includes(up) ? (up as FormerEventType) : null;
}

function main(): void {
  if (!existsSync(IN_PATH)) {
    writeFileSync(
      OUT_PATH,
      header({}, "the canonical FORMER-alias register was not present (run npm run identity:verify)"),
      "utf8",
    );
    console.log("build:former-names — no canonical-former-aliases.json present, wrote an empty module");
    return;
  }

  const parsed = JSON.parse(readFileSync(IN_PATH, "utf8")) as { rows?: RegisterRow[] };
  const rows = parsed.rows ?? [];

  const byInstitution = new Map<string, { alias: string; eventType: FormerEventType; sourceId: string }[]>();
  let droppedNonFormer = 0;
  let droppedUnknownEvent = 0;

  for (const row of rows) {
    if (String(row.alias_type ?? "").toUpperCase() !== "FORMER") {
      droppedNonFormer += 1;
      continue;
    }
    const eventType = asEventType(row.event_type);
    if (!eventType) {
      droppedUnknownEvent += 1;
      continue;
    }
    const institutionId = String(row.institution_id ?? "").trim();
    const alias = String(row.alias ?? "").trim();
    if (!institutionId || !alias) continue;
    const list = byInstitution.get(institutionId) ?? [];
    list.push({ alias, eventType, sourceId: String(row.source_id ?? "") });
    byInstitution.set(institutionId, list);
  }

  // Deterministic output: institutions in id order, names in event-then-alias order.
  const ordered: Record<string, { alias: string; eventType: FormerEventType; sourceId: string }[]> = {};
  for (const id of [...byInstitution.keys()].sort()) {
    const list = byInstitution.get(id)!;
    list.sort((a, b) => a.eventType.localeCompare(b.eventType) || a.alias.localeCompare(b.alias));
    // De-duplicate identical (alias, eventType) pairs that may appear twice.
    const seen = new Set<string>();
    ordered[id] = list.filter((r) => {
      const k = `${r.alias}|${r.eventType}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const total = Object.values(ordered).reduce((n, l) => n + l.length, 0);
  const institutions = Object.keys(ordered).length;
  const note =
    total === 0
      ? "no FORMER (predecessor) names are recorded in the canonical lineage register"
      : `${total} former name(s) across ${institutions} institution(s), from the canonical FORMER-alias register (P1-B); event types are the NRB lineage's own, and no event date is recorded`;

  writeFileSync(OUT_PATH, header(ordered, note), "utf8");
  if (droppedNonFormer > 0) console.log(`  DROPPED (non-FORMER alias_type): ${droppedNonFormer} row(s)`);
  if (droppedUnknownEvent > 0) console.log(`  DROPPED (unrecognised event_type): ${droppedUnknownEvent} row(s)`);
  console.log(`build:former-names — ${note}`);
}

function header(
  names: Record<string, { alias: string; eventType: FormerEventType; sourceId: string }[]>,
  note: string,
): string {
  const body =
    Object.keys(names).length === 0
      ? ""
      : `\n${Object.entries(names)
          .map(([id, list]) => {
            const rows = list
              .map(
                (r) =>
                  `    { alias: ${JSON.stringify(r.alias)}, eventType: ${JSON.stringify(
                    r.eventType,
                  )}, sourceId: ${JSON.stringify(r.sourceId)} },`,
              )
              .join("\n");
            return `  ${JSON.stringify(id)}: [\n${rows}\n  ],`;
          })
          .join("\n")}\n`;

  return `// GENERATED FILE - do not edit. Run \`npm run build:former-names\` to rebuild.
//
// ${note}
//
// A former name is a predecessor identity this institution absorbed through a
// merger, acquisition or rename, taken verbatim from the canonical FORMER-alias
// register (data/master/canonical-former-aliases.json, P1-B). The register is the
// same lineage the identity checks close against, so a name on the public profile
// always traces to a closed record. No event date is stored, so none is emitted.
//
// Keyed by canonical institution id (\`mfi-0NN\`), NOT by slug or name. Read it
// through the site-data facade: \`formerNames[institution.id]\` is [] when the
// institution absorbed nothing.

export type FormerEventType = "MERGED" | "ACQUIRED" | "RENAMED";

export interface FormerName {
  /** The predecessor name, exactly as the regulator's lineage recorded it. */
  alias: string;
  /** What the lineage records happened: a merger, an acquisition, or a rename. */
  eventType: FormerEventType;
  /** The source the register attributes the name to. */
  sourceId: string;
}

/** What this build was based on, so an empty result is legible. */
export const formerNamesProvenance: string = ${JSON.stringify(note)};

export const formerNames: Record<string, FormerName[]> = {${body}};
`;
}

main();
