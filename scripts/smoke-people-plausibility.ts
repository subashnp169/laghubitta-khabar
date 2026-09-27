// ============================================================================
// M3.3-EXT-C1 — deterministic fixtures for People plausibility. No network, no
// DB, no AI/OCR/browser, no institution, domain, URL or selector named here.
//
// The rule under test: a candidate must be a person-LIKE name AND carry a role
// that was actually read from the page. `nameLike()` is a necessary shape test,
// never sufficient proof, so:
//
//   1  organisation + role        -> not a person
//   2  company + role             -> not a person
//   3  department + role          -> not a person
//   4  section heading + role     -> not a person
//   5  notice / document title    -> not a person
//   6  real name + Chairman       -> person
//   7  real name + Director       -> person
//   8  real name + Independent Director -> person
//   9  multi-word legitimate name -> person
//  10  mixed Nepali/English name  -> person
//  11  page-builder person card   -> person
//  12  navigation text            -> never a person
//  13  footer text                -> never a person
//  14  heading alone / role alone -> never a person
//  15  general staff directory    -> no leadership assertion, kept as evidence
//  16  large governance roster    -> still asserted (no over-suppression)
// ============================================================================

import { peopleExtractor, peopleValidators, PEOPLE_STAFF_DIRECTORY_FIELD, nameLike, classifyPeoplePage } from "../lib/ingestion/people";
import type { ExtractedEvidence } from "../lib/ingestion/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const URL_UNDER_TEST = "https://institution.example/board-of-directors";

async function extract(body: string, url = URL_UNDER_TEST): Promise<ExtractedEvidence[]> {
  return peopleExtractor.extract({
    sourceId: "fixture-source",
    institutionId: "inst-fixture",
    sourceType: "MFB_WEBSITE",
    capability: "PEOPLE",
    url,
    parserId: "fixture",
    contentHash: "fixture-hash",
    body: new TextEncoder().encode(body),
  });
}

/** Names that became people assertions (FIELD evidence). */
function asserted(ev: ExtractedEvidence[]): string[] {
  return ev.filter((e) => e.kind === "FIELD").map((e) => String(e.text));
}
/** Entries held back as staff-directory evidence (never asserted). */
function heldBack(ev: ExtractedEvidence[]): string[] {
  return ev.filter((e) => e.kind === "TEXT" && e.field === PEOPLE_STAFF_DIRECTORY_FIELD).map((e) => String(e.text));
}

/** A board section wrapping whatever rows it is given. */
function boardSection(rows: string): string {
  return `<html><body><h1>Board of Directors</h1><table><tbody>${rows}</tbody></table></body></html>`;
}
const row = (a: string, b: string): string => `<tr><td>${a}</td><td>${b}</td></tr>`;

async function main(): Promise<void> {
  console.log("EXT-C1 people plausibility fixtures\n");

  // --- 1..6: non-person classes paired with a real role ---------------------
  const nonPerson: Array<[string, string]> = [
    ["1  organisation + role", row("Nepal Rastra Bank", "Director")],
    ["2  company + role", row("Lopho Tech Pvt. Ltd.", "Director")],
    ["3  department + role", row("Credit Department Head", "Director")],
    ["4  section heading + role", row("Board of Directors", "Director")],
    ["5  notice title + role", row("Press Release", "Director")],
  ];
  for (const [label, html] of nonPerson) {
    const ev = await extract(boardSection(html));
    check(`${label} produces no person`, asserted(ev).length === 0, `got ${JSON.stringify(asserted(ev))}`);
  }

  // --- 6..11: real people must survive --------------------------------------
  const people: Array<[string, string, string]> = [
    ["6  real name + Chairman", "Satya Narayan Jha", "Chairman"],
    ["7  real name + Director", "Dr. Pramod Kumar Jha", "Director"],
    ["8  real name + Independent Director", "Binodanand Jha", "Independent Director"],
    ["9  multi-word legitimate name", "Ram Bahadur Yadav", "Chief Executive Officer"],
    ["10 mixed Nepali/English name", "Satya Narayan झा", "Board Member"],
  ];
  for (const [label, name, role] of people) {
    const ev = await extract(boardSection(row(name, role)));
    const got = asserted(ev);
    check(`${label} yields the person`, got.length === 1 && got[0] === name, `got ${JSON.stringify(got)}`);
  }

  // --- 11: page-builder person card ----------------------------------------
  const cardPage = `<html><body><h2>Management Team</h2>
    <div class="card-team"><h3>Ram Bahadur Yadav</h3><p>Chief Executive Officer</p></div>
    <div class="card-team"><h3>Binod Pandey</h3><p>Monitoring Officer</p></div>
    </body></html>`;
  const cardEv = await extract(cardPage, "https://institution.example/management-team");
  check("11 page-builder person card yields the person", asserted(cardEv).includes("Ram Bahadur Yadav"), JSON.stringify(asserted(cardEv)));

  // --- 12/13: navigation and footer can never contribute a person ----------
  const navPage = `<html><body>
    <nav><ul><li>Board of Directors</li><li>Contact Us</li><li>Ram Bahadur Yadav</li></ul></nav>
    <h2>Board of Directors</h2><table><tbody>${row("Satya Narayan Jha", "Chairman")}</tbody></table>
    <footer><p>Satya Narayan Jha, Chairman</p><p>All Rights Reserved</p></footer>
    </body></html>`;
  const navEv = await extract(navPage);
  check("12 navigation text never becomes a person", asserted(navEv).length === 1 && asserted(navEv)[0] === "Satya Narayan Jha", JSON.stringify(asserted(navEv)));
  const footerOnly = `<html><body><h2>Board of Directors</h2><table><tbody>${row("Satya Narayan Jha", "Chairman")}</tbody></table><footer><p>Ram Bahadur Yadav, Chief Executive Officer</p></footer></body></html>`;
  check("13 footer text never becomes a person", asserted(await extract(footerOnly)).length === 1);

  // --- 14: a heading alone, or a role alone, is never a person --------------
  const headingOnly = `<html><body><h2>Board of Directors</h2><h3>Ram Bahadur Yadav</h3></body></html>`;
  check("14a heading alone is not a person", asserted(await extract(headingOnly)).length === 0, JSON.stringify(asserted(await extract(headingOnly))));
  const roleOnly = `<html><body><h2>Board of Directors</h2><p>Chairman</p><p>Independent Director</p></body></html>`;
  check("14b role alone is not a person", asserted(await extract(roleOnly)).length === 0);

  // --- 15: general staff directory -> evidence, never an assertion ---------
  // Real person NAMES (no role vocabulary inside them) with non-leadership
  // staff designations, which is the shape a staff listing actually has.
  const staffNames = [
    "Anil Kumar Thapa", "Bikash Shrestha", "Chandra Bahadur Gurung", "Deepak Raj Poudel",
    "Eshwar Prasad Joshi", "Farman Ali", "Gopal Bahadur Magar", "Hari Gopal Chettri",
    "Ishwar Lal Bhattarai", "Janak Bahadur Karki", "Kiran Bhandari", "Laxman Tamang",
    "Mohan Krishna Adhikari", "Nabin Kumar Rai", "Om Prakash Neupane", "Prakash Basnet",
    "Rajan BK", "Suresh Kumar Yadav", "Tulsi Ram Bhatt", "Upendra Bahadur Khadka",
    "Vikas Kumar Jha", "Yogeshwar Sharan Shah", "Zabindra Bikram Bista", "Ashok Kumar Rai",
  ];
  const staffRows = staffNames.map((n, i) => row(n, i % 2 === 0 ? "Monitoring Officer" : "Field Officer")).join("");
  const staffEv = await extract(boardSection(staffRows), "https://institution.example/staff-directory");
  check("15a staff directory asserts no leadership people", asserted(staffEv).length === 0, `${asserted(staffEv).length} asserted: ${JSON.stringify(asserted(staffEv).slice(0, 4))}`);
  check("15b staff directory keeps entries as evidence", heldBack(staffEv).length === staffNames.length, `${heldBack(staffEv).length} held`);
  const staffRule = await peopleValidators.find((v) => v.ruleId === "r-people-staff-directory")!.validate({ evidence: staffEv } as never);
  check("15c staff directory is reported as a future candidate", staffRule.status === "PENDING" && /staff directory/i.test(staffRule.message ?? ""), staffRule.message ?? "");

  // --- 16: a large GOVERNANCE roster must still be asserted ----------------
  const boardNames = [
    "Satya Narayan Jha", "Pramod Kumar Jha", "Binodanand Jha", "Anil Kumar Thapa",
    "Bikash Shrestha", "Chandra Bahadur Gurung", "Deepak Raj Poudel", "Eshwar Prasad Joshi",
    "Farman Ali", "Gopal Bahadur Magar", "Hari Gopal Chettri", "Ishwar Lal Bhattarai",
    "Janak Bahadur Karki", "Kiran Bhandari", "Laxman Tamang", "Mohan Krishna Adhikari",
    "Nabin Kumar Rai", "Om Prakash Neupane", "Prakash Basnet", "Suresh Kumar Yadav",
  ];
  const boardRows = boardNames.map((n, i) => row(n, i % 4 === 0 ? "Chairman" : i % 4 === 1 ? "Independent Director" : "Director")).join("");
  const boardEv = await extract(boardSection(boardRows));
  check("16 large governance roster is still asserted", asserted(boardEv).length === boardNames.length, `${asserted(boardEv).length} asserted`);
  check("16b governance roster holds nothing back", heldBack(boardEv).length === 0);
  const boardRule = await peopleValidators.find((v) => v.ruleId === "r-people-staff-directory")!.validate({ evidence: boardEv } as never);
  check("16c governance roster is not flagged as a directory", boardRule.status === "PASS", boardRule.message);

  // --- unit level: the vocabulary is generic, not a blacklist of the page ---
  check("u1 nameLike rejects an organisation", !nameLike("Nepal Rastra Bank"));
  check("u2 nameLike rejects a legal form", !nameLike("Lopho Tech Pvt. Ltd."));
  check("u3 nameLike rejects a plural staff title", !nameLike("VIEW PROVINCE WISE GRIEVANCE OFFICERS"));
  check("u4 nameLike accepts a Nepali department word", !nameLike("सहकारी विभाग"));
  check("u5 nameLike accepts a real Nepali name", nameLike("सत्यनारायण झा"));
  check("u6 nameLike still accepts honorific + surname", nameLike("Padam Bdr. Ghimire"));
  check("u7 classifyPeoplePage is population based", classifyPeoplePage(
    Array.from({ length: 20 }, () => ({ role: "PEOPLE_BOARD" as const, roleText: "Monitoring Officer" })),
  ) === "STAFF_DIRECTORY");
  check("u8 classifyPeoplePage keeps a leadership roster", classifyPeoplePage(
    Array.from({ length: 20 }, () => ({ role: "PEOPLE_DIRECTOR" as const, roleText: "Director" })),
  ) === "LEADERSHIP");
  check("u9 classifyPeoplePage leaves a small page alone", classifyPeoplePage(
    Array.from({ length: 3 }, () => ({ role: "PEOPLE_BOARD" as const, roleText: "Monitoring Officer" })),
  ) === "LEADERSHIP");

  console.log(`\nEXT-C1 people plausibility: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
