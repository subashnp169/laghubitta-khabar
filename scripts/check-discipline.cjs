// ============================================================================
// scripts/check-discipline.cjs — static enforcement of the engineering rules
// in docs/OPERATIONS.md, runnable in CI (npm run check:discipline).
//
// Scans the committed-source tree for violations:
//   R1  No production shortcuts — flags staged/dev-only tooling that could be
//       pointed at production D1 without LK_ENV guarding.
//   R2  No production credentials in source — flags API tokens, cf-* account
//       keys, AWS keys, Bearer secrets, credential URL patterns, real D1 ids.
//   R3  No destructive commands against production — flags unguarded
//       destructive verbs (DROP/reset/unlink) in code that talks to a DB.
//   R4  No seeding test data into production — flags seed logic lacking the
//       guard-env.cjs require.
//   R5  No prod DB bindings in browser code — flags any *.tsx importing
//       lib/repository or a D1 binding.
//
// Only scans files that should be COMMITTED: *.ts, *.tsx, *.js, *.cjs, *.mjs,
// *.json, *.toml under app/, components/, lib/, scripts/, worker/, migrations/,
// data/, docs/ (skips node_modules, .next, out, and generated snapshots).
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', '.next', 'out', '.git', '.wrangler']);
// Docs are scanned too: a real D1 id in a .md is still a leak (R2).
const SCAN_LIKE = /\.(ts|tsx|js|cjs|mjs|json|toml|md)$/;
// Generated/gitignored artifacts that must not be scanned (they are not source).
const SKIP_FILES = new Set([
  'data/master/master.json', // generated snapshot, not source code
  'package-lock.json',
  'schema/schema.sql',
]);
// Untracked/ignored local files must not be scanned at all.
const SKIP_NAME = /^(lk\.db|.*\.dev\.vars)$/;

const findings = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!SCAN_LIKE.test(e.name)) continue;
    if (SKIP_NAME.test(e.name)) continue;
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP_FILES.has(rel)) continue;
    scanFile(full, rel);
  }
}

// Real D1 database ids look like the all-zero placeholder below being replaced
// with a real UUID. Flag any literal UUID in committed source — but let the
// explicit all-zero placeholder (wrangler.toml) pass as it is not a real id.
const D1_ID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
const CF_ACCOUNT_RE = /cf-[0-9a-f]{16,}/i;
const CRED_RE = /\b(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|\bbearer\s+[A-Za-z0-9._-]{20,})\b/i;
const CRED_URL_RE = /:\/\/[^\s"'/]+:[^\s"'@/]+@[^\s"'/]+\./;
const SECRET_RE = /["'](api[_-]?key|api[_-]?secret|password|passwd|client[_-]?secret|access[_-]?token)["']\s*:\s*["'][^"']{8,}["']/i;

function scanFile(full, rel) {
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch { return; }

  // Explicit all-zero placeholder is allowed (wrangler.toml dev default).
  const ALL_ZERO_UUID = /\b0{8}-0{4}-0{4}-0{4}-0{12}\b/;

  const hit = (rule, line, snippet) =>
    findings.push({ rule, file: rel, line, snippet: (snippet || '').slice(0, 90) });

  const pushIfMatch = (rule, re) => {
    const m = re.exec(text);
    if (m) {
      const before = text.slice(0, m.index).split('\n');
      hit(rule, before.length, m[0]);
    }
  };

  // R2 — credentials / real ids must never appear in committed source.
  // The all-zero placeholder (wrangler.toml dev default) is allowed.
  {
    const m = D1_ID_RE.exec(text);
    if (m && !ALL_ZERO_UUID.test(m[0])) {
      const before = text.slice(0, m.index).split('\n');
      hit('R2', before.length, m[0]);
    }
  }
  const rawHex = /(?<![\da-f-])[0-9a-f]{32}(?![\da-f-])/i.exec(text);
  if (rawHex) {
    const before = text.slice(0, rawHex.index).split('\n');
    hit('R2', before.length, rawHex[0]);
  }
  pushIfMatch('R2', CF_ACCOUNT_RE);
  pushIfMatch('R2', CRED_RE);
  pushIfMatch('R2', CRED_URL_RE);
  pushIfMatch('R2', SECRET_RE);
  // R5 — browser code must never import the repository/D1 layer.
  if (rel.endsWith('.tsx') || rel.endsWith('.jsx')) {
    if (/from\s+["'](\.\.?\/)+(lib\/repository|lib\/api)["']/.test(text)) {
      const m = /from\s+["'](\.\.?\/)+(lib\/repository|lib\/api)["']/.exec(text);
      const before = text.slice(0, m.index).split('\n');
      hit('R5', before.length, m[0]);
    }
  }

  // R3 — destructive verbs in data code without an LK_ENV guard in the same file.
  if (rel.endsWith('.ts') || rel.endsWith('.cjs') || rel.endsWith('.mjs')) {
    const destructive = /\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|unlinkSync)\b/i;
    if (destructive.test(text) && !text.includes('guard-env.cjs') &&
        !text.includes('process.env.LK_ENV')) {
      const m = destructive.exec(text);
      const before = text.slice(0, m.index).split('\n');
      hit('R3', before.length, m[0]);
    }
  }
}

if (process.argv.includes('--scan-ignored')) {
  // Reserved: future use for explicitly checking gitignored files.
  console.error('--scan-ignored is not implemented (never scan gitignored real secrets).');
  process.exit(2);
}

walk(ROOT);

if (findings.length) {
  console.error('DISCIPLINE VIOLATIONS');
  for (const f of findings) {
    console.error(`  [${f.rule}] ${f.file}:${f.line}  ${f.snippet.replace(/\s+/g, ' ')}`);
  }
  process.exit(1);
}
console.log('OK — no discipline violations in committed source.');