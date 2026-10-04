"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { HeaderSearch } from "@/components/search/HeaderSearch";

/**
 * Primary navigation.
 *
 * Two rules shaped this. First, the header is the product's table of contents,
 * so it carries only the sections a reader actually looks for — the operational
 * screens (ingestion, alerts, compare) are reachable from the footer, where they
 * belong, instead of crowding the main bar. Second, the header is a client
 * component only because it needs the current path and the mobile drawer; it
 * deliberately imports no data layer, so the repository stays server-side.
 */

interface NavItem {
  href: string;
  label: string;
}

/**
 * Primary navigation.
 *
 * Grouped by user intent rather than by data source: Institutions and People are
 * the directory, News and Jobs are activity, Financials and Interest Rates are
 * figures, Documents is what we hold. Operational screens (alerts, compare,
 * ingestion) stay in the footer and drawer deliberately — they describe how this
 * site is built rather than what it knows.
 *
 * The bar is space-constrained at the `lg` breakpoint, so it carries the seven
 * concepts a returning reader reaches for most. Everything else remains one click
 * away in the drawer and footer.
 */
const NAV: NavItem[] = [
  { href: "/institutions", label: "Institutions" },
  { href: "/people", label: "People" },
  { href: "/news", label: "News" },
  { href: "/documents", label: "Documents" },
  { href: "/jobs", label: "Jobs" },
  { href: "/financials", label: "Financials" },
  { href: "/interest-rates", label: "Rates" },
];

/**
 * Secondary destinations. The drawer shows these under the primary list so every
 * route is reachable on a small screen, including the two that are deliberately
 * absent from the desktop bar: the regulator's record and our own analysis.
 */
const EXTRA_NAV: NavItem[] = [
  { href: "/research", label: "Research" },
  { href: "/nrb", label: "NRB & regulatory" },
  { href: "/reports", label: "Reports" },
  { href: "/compare", label: "Compare" },
  { href: "/alerts", label: "Alerts" },
];

/** A nav item is active on its own route and on anything nested beneath it. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Any navigation closes the drawer. Adjusted during render rather than in an
  // effect: an effect would fire one render later, leaving the new page visible
  // behind an open drawer for a frame, and React flags synchronous setState in an
  // effect for exactly this reason.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock the page behind the open drawer, and close it on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className={`sticky top-0 z-50 border-b bg-white/95 backdrop-blur-sm transition-shadow ${
        scrolled ? "border-mfi-200 shadow-[0_1px_12px_-6px_rgb(22_35_60/0.25)]" : "border-mfi-100"
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-mfi-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-3 px-4 sm:h-16 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Laghubitta Khabar — home">
          <Logo />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-mfi-900">Laghubitta Khabar</span>
            <span className="mt-0.5 hidden text-[10px] font-medium uppercase tracking-[0.14em] text-mfi-400 sm:block">
              MFI intelligence
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden flex-1 items-center gap-5 lg:flex xl:gap-7">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="lk-nav-link text-sm"
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <HeaderSearch />
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-mfi-200 text-mfi-700 transition-colors hover:bg-mfi-50 lg:hidden"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {menuOpen ? (
                <>
                  <path d="m5 5 10 10" />
                  <path d="m15 5-10 10" />
                </>
              ) : (
                <>
                  <path d="M3 6h14" />
                  <path d="M3 10h14" />
                  <path d="M3 14h14" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <>
          <div
            className="fixed inset-0 top-14 z-40 bg-mfi-950/30 sm:top-16 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="lk-drawer-in fixed right-0 top-14 z-50 h-[calc(100dvh-3.5rem)] w-[min(20rem,85vw)] overflow-y-auto border-l border-mfi-200 bg-white px-4 py-4 sm:top-16 lg:hidden"
          >
            <ul className="lk-divide">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center justify-between py-2.5 text-[15px] text-mfi-800"
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  >
                    {item.label}
                    {isActive(pathname, item.href) ? (
                      <span className="size-1.5 rounded-full bg-mfi-700" aria-hidden="true" />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-mfi-100 pt-4">
              <p className="lk-eyebrow px-1 pb-1 text-mfi-400">Also</p>
              {EXTRA_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-11 items-center justify-between py-2.5 text-[15px] text-mfi-600"
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                >
                  {item.label}
                  {isActive(pathname, item.href) ? (
                    <span className="size-1.5 rounded-full bg-mfi-700" aria-hidden="true" />
                  ) : null}
                </Link>
              ))}
            </div>
          </nav>
        </>
      ) : null}
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-mfi-900 text-[13px] font-bold tracking-tight text-white"
    >
      LK
    </span>
  );
}
