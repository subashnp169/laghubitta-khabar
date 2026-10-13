// ============================================================================
// P2-1 — research statement vocabulary acceptance.
//
// `/research` labels every section by what it is (fact / calculation / analysis
// / external). Those labels must come from one place so a kind cannot read
// differently on two sections, and `external` must stay declared-but-unused
// (this project cites no third-party research). This asserts the shared
// `src/util/research.ts` mapping.
//
// Run: npm run smoke:research
// ============================================================================
import {
  RESEARCH_KIND_ORDER,
  RESEARCH_KINDS,
  researchKind,
  type ResearchStatementKind,
} from "../src/util/research";

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

const TONES = new Set(["positive", "attention", "conflict", "info", "neutral"]);
const EXPECTED: ResearchStatementKind[] = ["fact", "calculation", "analysis", "external"];

check("order is exactly the four kinds", RESEARCH_KIND_ORDER.length === EXPECTED.length && EXPECTED.every((k) => RESEARCH_KIND_ORDER.includes(k)));
check("no kind is defined beyond the four", Object.keys(RESEARCH_KINDS).length === EXPECTED.length);

for (const kind of EXPECTED) {
  const p = RESEARCH_KINDS[kind];
  check(`${kind}: present`, Boolean(p));
  check(`${kind}: label non-empty and not the raw token`, p.label.length > 0 && p.label !== kind);
  check(`${kind}: help is a sentence`, p.help.length > 20);
  check(`${kind}: tone is valid`, TONES.has(p.tone));
  check(`${kind}: kind field matches key`, p.kind === kind);
}

const labels = EXPECTED.map((k) => RESEARCH_KINDS[k].label);
check("labels are unique", new Set(labels).size === labels.length);

// The resolver is total and never silently upgrades unknown input to a fact.
check("researchKind resolves a known kind", researchKind("fact").kind === "fact");
check("researchKind is case-insensitive", researchKind("FACT").kind === "fact");
check("researchKind falls back to analysis (never fact)", researchKind("opinion").kind === "analysis" && researchKind(null).kind === "analysis");

// `external` is defined but declared unused: its help must say so.
check("external is declared unused", /none/i.test(RESEARCH_KINDS.external.help));

console.log(`\nsmoke:research: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
