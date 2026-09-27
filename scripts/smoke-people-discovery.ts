// ============================================================================
// M3.3-GENERIC-EXT-B — deterministic discovery fixtures.
//
// Proves the generic People/leadership link probe: what it accepts, what it
// refuses, how it deduplicates, how it stays inside the host/budget boundary.
// No network, no production D1, no AI/OCR/browser, no institution-specific data.
//
//   A  explicit "Board of Directors"                     → accepted
//   B  explicit "Leadership"                            → accepted
//   C  "Management Team"                                → accepted
//   D  "About Us"                                       → rejected
//   E  "Company Profile"                                → rejected
//   F  navigation noise (branch/notices/contact/…)     → rejected
//   G  same-host people-looking URL                     → accepted
//   H  external-domain people-looking URL               → never a candidate
//   I  duplicate links                                  → one deterministic candidate
//   J  query/fragment variants                          → deduped by the shared normalizer
//   K  candidate cap                                    → bounded, deterministic order
//   L  extraction safety is untouched                   → 47 EXT-A fixtures still pass
// ============================================================================

import { scorePeopleLink, extractPeopleCandidates, MAX_PEOPLE_CANDIDATES } from "../lib/ingestion/people-discovery";
import { normalizeDiscoveredUrl, extractSameHostLinks } from "../lib/ingestion/discovery";
import { stripNavigation } from "../lib/ingestion/people";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name, detail ?? ""); }
}

const BASE = "https://institution.test/";

function score(anchorText: string, path: string, sectionHeading = "") {
  return scorePeopleLink({ anchorText, path, sectionHeading });
}

// ============================================================================
console.log("EXT-B — A/B/C. explicit leadership vocabulary is accepted");
{
  const a = score("Board of Directors", "/board-of-directors");
  check("A  Board of Directors + /board-of-directors accepted", a.accepted, a.reason);
  check("A  anchor+path scores highest", a.score === 100, String(a.score));

  const b = score("Our Leadership", "/about/leadership");
  check("B  Our Leadership accepted", b.accepted, b.reason);

  const c = score("Management Team", "/management-team");
  check("C  Management Team accepted", c.accepted, c.reason);

  const chair = score("Chairman", "/chairman");
  check("A  Chairman anchor accepted", chair.accepted, chair.reason);
  const board = score("Our Board", "/board");
  check("A  Our Board accepted", board.accepted, board.reason);
  const gov = score("Corporate Governance", "/governance");
  check("A  governance accepted", gov.accepted, gov.reason);
  const team = score("Our Team", "/our-team");
  check("A  Our Team accepted", team.accepted, team.reason);
}

console.log("EXT-B — D/E. generic company pages are never people pages");
{
  const d = score("About Us", "/about-us");
  check("D  About Us rejected", !d.accepted, d.reason);
  const d2 = score("About Us", "/about-us", "Chairman CEO Director");
  check("D  About Us rejected even with leadership context nearby", !d2.accepted, d2.reason);
  const e = score("Company Profile", "/company-profile");
  check("E  Company Profile rejected", !e.accepted, e.reason);
  const org = score("Our Organization", "/organization");
  check("D  organization rejected", !org.accepted, org.reason);
  const who = score("Who We Are", "/who-we-are");
  check("D  who-we-are rejected", !who.accepted, who.reason);
  const contact = score("Contact Us", "/contact-us");
  check("F  Contact Us rejected", !contact.accepted, contact.reason);
  const branch = score("Branch Network", "/branch-network");
  check("F  Branch Network rejected", !branch.accepted, branch.reason);
  const notice = score("Notices", "/notice");
  check("F  Notices rejected", !notice.accepted, notice.reason);
  const nrb = score("NRB Complaint", "/complaint");
  check("F  NRB Complaint rejected", !nrb.accepted, nrb.reason);
}

console.log("EXT-B — weak term requires leadership context");
{
  const bare = score("Team", "/team");
  check("F  bare 'Team' rejected (no context)", !bare.accepted, bare.reason);
  const withCtx = score("Team", "/team", "Board of Directors Chairman");
  check("C  'Team' + leadership heading accepted", withCtx.accepted, withCtx.reason);
  check("C  weak+context scores below an explicit phrase", withCtx.score < 100, String(withCtx.score));
}

console.log("EXT-B — G. same-host candidates are extracted from a real page");
{
  const html = `<html><body>
    <h1>Institution</h1>
    <h2>Board of Directors</h2>
    <ul>
      <li><a href="/board-of-directors">Board of Directors</a></li>
      <li><a href="/about-us">About Us</a></li>
      <li><a href="/branch-network">Branch Network</a></li>
      <li><a href="/notice">Notices</a></li>
      <li><a href="/contact-us">Contact Us</a></li>
      <li><a href="/management-team">Management Team</a></li>
      <li><a href="mailto:info@institution.test">Email</a></li>
      <li><a href="javascript:void(0)">Menu</a></li>
    </ul>
  </body></html>`;
  const cands = extractPeopleCandidates(html, BASE);
  const urls = cands.map((c) => c.url);
  check("G  board page accepted", urls.includes("https://institution.test/board-of-directors"), urls.join("|"));
  check("G  management page accepted", urls.includes("https://institution.test/management-team"), urls.join("|"));
  check("D  about-us not a candidate", !urls.includes("https://institution.test/about-us"), urls.join("|"));
  check("F  branch/notice/contact not candidates", !urls.some((u) => /branch|notice|contact/.test(u)), urls.join("|"));
  check("G  javascript:/mailto: never candidates", !urls.some((u) => !u.startsWith("https://")), urls.join("|"));
  check("G  candidate carries an auditable reason", cands.every((c) => c.score.reason.length > 0 && c.score.signals.length > 0), JSON.stringify(cands.map((c) => c.score)));
  check("G  ranked strongest first", cands.length >= 2 && cands[0].score.score >= cands[cands.length - 1].score.score, JSON.stringify(cands.map((c) => c.score.score)));
}

console.log("EXT-B — H. external domain never becomes a candidate");
{
  const html = `<html><body>
    <a href="https://other-bank.test/board-of-directors">Board of Directors</a>
    <a href="http://third-party.test/management-team">Management Team</a>
    <a href="https://evil-institution.test.attacker.net/board">Board of Directors</a>
  </body></html>`;
  const cands = extractPeopleCandidates(html, BASE);
  check("H  zero candidates from foreign hosts", cands.length === 0, JSON.stringify(cands.map((c) => c.url)));
}

console.log("EXT-B — H2. the existing host rule is unchanged, not widened");
{
  // The probe reuses the SAME host rule as the LINK pass: the source host and
  // its subdomains. It never widens the boundary, and the fetcher's allow-list
  // stays the authority on what may actually be fetched.
  const own = extractPeopleCandidates(`<a href="//cdn.institution.test/board">Board of Directors</a>`, BASE);
  check("H2 own subdomain accepted (pre-existing LINK host rule)", own.length === 1, JSON.stringify(own.map((c) => c.url)));
  const sibling = extractPeopleCandidates(`<a href="//institution.test.attacker.net/board">Board of Directors</a>`, BASE);
  check("H2 look-alike domain rejected", sibling.length === 0, JSON.stringify(sibling.map((c) => c.url)));
  const links = extractSameHostLinks(`<a href="//cdn.institution.test/x">x</a>`, "institution.test");
  check("H2 probe agrees with the LINK pass on subdomains", links.includes("https://cdn.institution.test/x"), links.join("|"));
}

console.log("EXT-B — I/J. duplicates and query/fragment variants collapse");
{
  const html = `<html><body>
    <a href="/board-of-directors">Board of Directors</a>
    <a href="/board-of-directors/">Board of Directors</a>
    <a href="/board-of-directors#board">Board of Directors</a>
    <a href="/board-of-directors?lang=en">Board of Directors</a>
    <a href="/board-of-directors?lang=en#x">Board of Directors</a>
  </body></html>`;
  const cands = extractPeopleCandidates(html, BASE);
  check("I  five variants → one candidate", cands.length === 1, JSON.stringify(cands.map((c) => c.url)));
  check("J  normalized (no query, no fragment, no trailing slash)", cands[0]?.url === "https://institution.test/board-of-directors", String(cands[0]?.url));
  const a = extractPeopleCandidates(html, BASE).map((c) => c.url);
  const b = extractPeopleCandidates(html, BASE).map((c) => c.url);
  check("I  deterministic across runs", JSON.stringify(a) === JSON.stringify(b), `${a.join("|")} vs ${b.join("|")}`);
  check("J  shared normalizer agrees", normalizeDiscoveredUrl("https://institution.test/board-of-directors/?a=1#z") === "https://institution.test/board-of-directors", normalizeDiscoveredUrl("https://institution.test/board-of-directors/?a=1#z"));
}

console.log("EXT-B — F. navigation/footer regions cannot create candidates");
{
  const html = `<html><body>
    <h2>Board of Directors</h2>
    <a href="/board-of-directors">Board of Directors</a>
    <nav><ul>
      <li><a href="/about-us">About Us</a></li>
      <li><a href="/management-team">Management Team</a></li>
      <li><a href="/board">Board</a></li>
    </ul></nav>
    <footer><a href="/chairman">Chairman</a><a href="/leadership">Leadership</a></footer>
    <div role="navigation"><a href="/governance">Governance</a></div>
  </body></html>`;
  const urls = extractPeopleCandidates(html, BASE).map((c) => c.url);
  check("F  only the body link is a candidate", urls.length === 1, urls.join("|"));
  check("F  nav 'Management Team' ignored", !urls.some((u) => u.includes("management-team")), urls.join("|"));
  check("F  nav 'Board' ignored", !urls.some((u) => /\/board$/.test(u)), urls.join("|"));
  check("F  footer 'Chairman' ignored", !urls.some((u) => u.includes("chairman")), urls.join("|"));
  check("F  role=navigation ignored", !urls.some((u) => u.includes("governance")), urls.join("|"));
  check("F  boundary helper still removes nav/footer", stripNavigation(html).indexOf("<nav") < 0 && stripNavigation(html).indexOf("Chairman") < 0);
}

console.log("EXT-B — K. candidate cap is bounded and deterministic");
{
  const links = ["board", "board-of-directors", "leadership", "management", "management-team", "directors", "chairman", "governance", "our-team", "board-members"]
    .map((p) => `<a href="/${p}">${p.replace(/-/g, " ")}</a>`)
    .join("\n");
  const html = `<html><body>${links}</body></html>`;
  const cands = extractPeopleCandidates(html, BASE);
  check("K  capped at the per-source maximum", cands.length === MAX_PEOPLE_CANDIDATES, String(cands.length));
  const capped2 = extractPeopleCandidates(html, BASE, 1);
  check("K  explicit cap honoured", capped2.length === 1, String(capped2.length));
  const again = extractPeopleCandidates(html, BASE).map((c) => c.url);
  check("K  ordering deterministic", JSON.stringify(cands.map((c) => c.url)) === JSON.stringify(again));
  check("K  ranking prefers the strongest signal", cands[0].score.score === 100, String(cands[0].score.score));
}

console.log(`\nEXT-B people discovery: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
