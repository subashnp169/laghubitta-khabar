// ============================================================================
// P3-2 — Institution profile section-navigation contract.
//
// The profile is the site's longest page, so its in-page navigation has to work
// from 320px up. That is a set of invariants about the markup, not a pixel test,
// and this locks them so a later edit cannot quietly break one:
//   * the mobile bar scrolls horizontally instead of wrapping or clipping
//     (`lk-scroll-x` + `min-w-max`);
//   * every mobile nav target is a 44px tap target (`min-h-11`);
//   * exactly one of the mobile bar / desktop rail is visible per breakpoint
//     (`lg:hidden` vs `hidden lg:block`), fed by the same list, so links are
//     never duplicated for assistive technology;
//   * the sticky offset matches the header height (`top-14`/`h-14`,
//     `sm:top-16`/`sm:h-16`) so the bar does not float over the header;
//   * every `#anchor` the nav offers resolves to a section id on the page, and
//     every section is reachable.
//
// Run: npm run smoke:profile-nav
// ============================================================================
import { readFileSync } from "node:fs";
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

const panel = read("src/components/ui/Panel.tsx");
const profile = read("src/app/institutions/[slug]/page.tsx");
const header = read("src/components/layout/Header.tsx");

// --- SectionNav (mobile presentation) ----------------------------------------
const navStart = panel.indexOf("export function SectionNav");
const sidebarStart = panel.indexOf("export function SectionSidebar");
const sectionNav = panel.slice(navStart, sidebarStart);
check("SectionNav is found in Panel.tsx", navStart !== -1 && sidebarStart > navStart);
check("mobile bar scrolls horizontally (lk-scroll-x)", sectionNav.includes("lk-scroll-x"));
check("mobile bar does not wrap (min-w-max)", sectionNav.includes("min-w-max"));
check("mobile nav targets are 44px tap targets (min-h-11)", sectionNav.includes("min-h-11"));
check("mobile nav targets are not the old 36px size (no bare min-h-9)", !/min-h-9\b/.test(sectionNav));

// --- Profile wiring: one presentation per breakpoint, one shared list --------
check("desktop rail is hidden below lg (hidden lg:block) in the profile", /hidden lg:block/.test(profile));
check("mobile bar is hidden at lg (lg:hidden) in the profile", /lg:hidden/.test(profile));
const itemsRefs = profile.match(/items=\{navItems\}/g) ?? [];
check("both navs are fed the same list (items={navItems} twice)", itemsRefs.length === 2);

// --- Sticky offset matches the header height ---------------------------------
check("profile sticky offset is top-14 (mobile)", /top-14\b/.test(profile));
check("header height is h-14 (mobile)", /h-14\b/.test(header));
check("profile sticky offset is sm:top-16 (desktop)", /sm:top-16\b/.test(profile));
check("header height is sm:h-16 (desktop)", /sm:h-16\b/.test(header));

// --- Anchors resolve: nav hrefs == section ids -------------------------------
const navTargets = [...profile.matchAll(/href:\s*"#([a-z0-9-]+)"/g)].map((m) => m[1]);
const sectionIds = [...profile.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]);
check("nav offers at least two sections (so the nav renders)", navTargets.length >= 2);
check("nav targets are unique", new Set(navTargets).size === navTargets.length);
const missing = navTargets.filter((t) => !sectionIds.includes(t));
const unreachable = sectionIds.filter((id) => !navTargets.includes(id));
check(`every nav target resolves to a section id${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`, missing.length === 0);
check(`every section id is reachable from the nav${unreachable.length ? ` (unreachable: ${unreachable.join(", ")})` : ""}`, unreachable.length === 0);
console.log(`       (sections: ${navTargets.length}; nav targets == section ids: ${missing.length === 0 && unreachable.length === 0})`);

console.log(`\nsmoke:profile-nav: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
