// Regenerates schema/schema.sql from migrations/*.sql (canonical source).
// Usage: node scripts/build-schema.cjs
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');
const outFile = path.join(root, 'schema', 'schema.sql');

const files = fs.readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const header = `-- =============================================================================
-- Laghubitta Khabar — schema.sql (GENERATED — do not edit)
-- Regenerate with: node scripts/build-schema.cjs
-- Canonical source: docs/DATABASE-SPEC.md + migrations/*.sql
-- Frozen 2026-09-24 · Portable SQLite / D1
-- =============================================================================

PRAGMA foreign_keys = ON;

`;

let body = '';
for (const f of files) {
  const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8').trim();
  // strip per-file pragma, it is emitted once above
  const stripped = content.replace(/^PRAGMA foreign_keys\s*=\s*ON;\s*/i, '');
  body += `-- >>> migration: ${f}\n${stripped}\n\n`;
}

fs.mkdirSync(path.join(root, 'schema'), { recursive: true });
fs.writeFileSync(outFile, header + body, 'utf8');
console.log(`Generated ${outFile} from ${files.length} migrations (${(header + body).length} bytes)`);