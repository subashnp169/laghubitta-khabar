"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Header search control.
 *
 * The site is built with `output: "export"`, so there is no server to query at
 * runtime and no route handler to hit. The control is therefore a real link to
 * `/search`, which prerenders a compact index and filters it in the browser.
 *
 * That choice is deliberate rather than a limitation worked around: a link works
 * with JavaScript disabled, exposes a shareable URL, and keeps a data index out
 * of every page's payload. The keyboard shortcut below only makes the link
 * faster to reach.
 */

export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  // On /search the page owns its own input; two inputs competing for the same
  // keystrokes would be confusing, so the shortcut is disabled there.
  const onSearchPage = pathname.startsWith("/search");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing || onSearchPage) return;

      const isK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isK && !isSlash) return;

      event.preventDefault();
      router.push("/search");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, onSearchPage]);

  return (
    <Link
      href="/search"
      aria-current={onSearchPage ? "page" : undefined}
      className="group inline-flex h-9 items-center gap-2 rounded-md border border-mfi-200 bg-white pl-2.5 pr-2 text-sm text-mfi-500 transition-colors hover:border-mfi-300 hover:bg-mfi-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mfi-700"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 text-mfi-400" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3 3" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-mfi-200 bg-mfi-50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-mfi-500 md:inline">
        /
      </kbd>
      <span className="sr-only">
        Search institutions, people, documents and vacancies. Keyboard shortcut: slash or Control K.
      </span>
    </Link>
  );
}
