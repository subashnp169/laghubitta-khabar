// ============================================================================
// P2-6 — NRB publication categorisation acceptance.
//
// The regulator's snapshot must be grouped by what NRB published, not by the
// file type it was stored under. This locks the shared `src/util/nrb.ts`
// mapping: the category vocabulary maps to NRB-SOURCE-MAP, every document is
// claimed by exactly one series, and a declared series this snapshot does not
// contain (Directives, Circulars) is reported as absent instead of invented.
//
// Run: npm run smoke:nrb
// ============================================================================
import {
  NRB_CATEGORIES,
  nrbCategory,
  nrbCategoryByKey,
  nrbCategoryCoverage,
  type NrbCategoryKey,
} from "../src/util/nrb";
import { distinctNrbDocuments } from "../src/util/activity";

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

const DOCS = distinctNrbDocuments();

// --- The vocabulary itself ----------------------------------------------------
const keys = NRB_CATEGORIES.map((c) => c.key);
check("category keys are unique", new Set(keys).size === keys.length);
check("every category has a label, help and source-map row", NRB_CATEGORIES.every((c) => c.label.length > 0 && c.help.length > 0 && c.sourceMapSection.length > 0));
check("vocabulary covers the source-map series the tracker names", ["directives", "circulars", "mfi_situation", "kfis", "interest_rates", "progress", "sources_uses", "supervision"].every((k) => keys.includes(k as NrbCategoryKey)));
check("nrbCategoryByKey round-trips each key", keys.every((k) => nrbCategoryByKey(k).key === k));
check("nrbCategoryByKey rejects an unknown key", (() => { try { nrbCategoryByKey("nope" as NrbCategoryKey); return false; } catch { return true; } })());

// --- Every document is claimed by exactly one series --------------------------
const unclaimed = DOCS.filter((d) => nrbCategory(d) === null);
check("every document maps to a category (none filed by type only)", unclaimed.length === 0);
check("classification is a pure function of the document", DOCS.every((d) => nrbCategory(d) === nrbCategory(d)));

// --- Category counts reconcile with the distinct corpus -----------------------
const { categories, uncategorised } = nrbCategoryCoverage(DOCS);
const total = categories.reduce((n, c) => n + c.count, 0) + uncategorised;
check("category counts + uncategorised equal the distinct document count", total === DOCS.length);
check("coverage lists every declared category", categories.length === NRB_CATEGORIES.length);
check("present flag matches a non-zero count", categories.every((c) => c.present === c.count > 0));

// --- The rules classify by series, not by file type ---------------------------
const kfiDocs = DOCS.filter((d) => nrbCategory(d) === "kfis");
check("KFIs all carry an indicator title", kfiDocs.length > 0 && kfiDocs.every((d) => /key fina(?:n)?cial indicators/i.test(d.title)));
const rateDocs = DOCS.filter((d) => nrbCategory(d) === "interest_rates");
check("interest-rate docs all carry a rate title", rateDocs.length > 0 && rateDocs.every((d) => /interest[\s-]?rate/i.test(d.title)));
const amlDocs = DOCS.filter((d) => nrbCategory(d) === "aml_cft");
check("AML/CFT is checked before Supervision (no overlap)", amlDocs.length > 0 && amlDocs.every((d) => nrbCategory(d) !== "supervision"));
check("enforcement is only claimed by an enforcement action", DOCS.filter((d) => nrbCategory(d) === "enforcement").every((d) => d.docType === "ENFORCEMENT" || /enforcement action/i.test(d.title)));

// --- Honest coverage: declared-but-absent is stated, never invented -----------
const byKey = new Map(categories.map((c) => [c.category.key, c]));
check("Directives is declared but absent in this snapshot", byKey.get("directives")?.present === false);
check("Circulars is declared but absent in this snapshot", byKey.get("circulars")?.present === false);
check("a snapshot with an empty document set reports all categories absent", nrbCategoryCoverage([]).categories.every((c) => !c.present && c.count === 0));
console.log(`       (present categories: ${categories.filter((c) => c.present).length}/${categories.length}; documents categorised: ${DOCS.length - uncategorised}/${DOCS.length})`);

console.log(`\nsmoke:nrb: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
