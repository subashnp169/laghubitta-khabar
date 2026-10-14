// ============================================================================
// P3-4 — Empty / partial / conflict state standardisation.
//
// The "this is only partial" line used to be hand-written on each page, with the
// padding, size and colour drifting between them. It now comes from StateNote,
// next to EmptyState. This locks that:
//   * the primitive exists and maps the attention/conflict tones to the amber /
//     red palette used everywhere else;
//   * the pages that show a partial state use it instead of a raw callout;
//   * no page reintroduces an ad-hoc amber callout.
//
// Run: npm run smoke:ui-states
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const emptyState = read("src/components/ui/EmptyState.tsx");
check("EmptyState exports EmptyState", /export function EmptyState\b/.test(emptyState));
check("EmptyState exports StateNote", /export function StateNote\b/.test(emptyState));
check("StateNote renders a note role", /role="note"/.test(emptyState));
check("attention tone uses the amber (flag) palette", /attention:\s*"[^"]*border-flag-200[^"]*bg-flag-50/.test(emptyState));
check("conflict tone uses the red (alert) palette", /conflict:\s*"[^"]*border-alert-200[^"]*bg-alert-50/.test(emptyState));

// Pages that show a partial/attention state must go through StateNote.
const expected = [
  "src/app/people/page.tsx",
  "src/app/interest-rates/page.tsx",
  "src/app/financials/page.tsx",
  "src/app/news/[slug]/page.tsx",
  "src/app/institutions/[slug]/page.tsx",
];
for (const rel of expected) {
  check(`${rel} imports StateNote`, /from\s+"@\/components\/ui\/EmptyState"/.test(read(rel)) && /\bStateNote\b/.test(read(rel)));
  check(`${rel} uses <StateNote`, /<StateNote\b/.test(read(rel)));
}

// No file may reintroduce a hand-rolled amber callout (border + background).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}
// A solid amber background paired with an amber border is the callout pattern;
// `hover:bg-flag-50` on a chip is a hover state, not a callout, and is allowed.
const CALLOUT = /border-flag-200[^"'`\n]*(?<!:)bg-flag-50|(?<!:)bg-flag-50[^"'`\n]*border-flag-200/;
const offenders = walk(join(root, "src"))
  .filter((full) => !full.endsWith(join("ui", "EmptyState.tsx")))
  .filter((full) => CALLOUT.test(readFileSync(full, "utf8")))
  .map((full) => full.slice(root.length + 1).replace(/\\/g, "/"));
check(`no page hand-rolls an amber callout${offenders.length ? ` (offenders: ${offenders.join(", ")})` : ""}`, offenders.length === 0);

// The ingestion room's "Open conflicts" figure is an unverified pipeline count
// read from the last generation, not a measurement of the evidence layer. A zero
// must never render as a positive/green health signal — absence of measurement is
// not absence of problems (docs/data/CONFLICT-VISIBILITY-CHAIN.md).
const ingestion = read("src/app/ingestion/page.tsx");
check("ingestion page does not render a zero conflict count as positive", !/conflictsOpen === 0 \? "positive"/.test(ingestion));
check("ingestion page renders a zero conflict count as neutral", /conflictsOpen > 0 \? "conflict" : "neutral"/.test(ingestion));
check("ingestion page says a zero conflict count is not a verified all-clear", /a zero is not a verified\s+all-clear/.test(ingestion));

console.log(`\nsmoke:ui-states: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
