import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const DISPUTED = join(ROOT, "data", "master", "disputed-identities.json");
const INSTIT = join(ROOT, "src", "data", "institutions.ts");
const OUT_JSON = join(ROOT, "data", "master", "canonical-slug-aliases.json");

type Row = { old_slug: string; moved_to: string; institution_id: string; was: string };
interface ConflictRow {
  id?: string;
  published?: { slug?: string };
  master?: { slug?: string };
}
const { identity_conflicts = [] } = JSON.parse(readFileSync(DISPUTED, "utf8")) as { identity_conflicts?: ConflictRow[] };
const rows: Row[] = (identity_conflicts as ConflictRow[])
  .filter((c) => Boolean(c.published?.slug && c.master?.slug && c.id))
  .map((c) => ({
    old_slug: c.published.slug,
    moved_to: c.master.slug,
    institution_id: c.id,
    was: c.published.name,
  }));

// Also read from current code (TypeScript export) in case source of truth differs? but institutions.ts has 16.
const m = readFileSync(INSTIT, "utf8").match(/slugAliases[^=]*=\s*(\[[\s\S]*?\]);/m);
if (m) {
  const codeRows = JSON.parse(m[1]);
  // prefer code if present
  for (const r of codeRows) {
    if (!rows.find((x) => x.old_slug === r.old_slug)) rows.push(r);
  }
}

const out = {
  generated_by: "scripts/build-canonical-slug-aliases.ts",
  purpose: "Canonical slug_aliases for renames (old slug -> moved_to)",
  count: rows.length,
  rows: rows.sort((a,b)=>a.old_slug.localeCompare(b.old_slug)),
};
writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`wrote ${rows.length} rows to ${OUT_JSON}`);