import Link from "next/link";

export default function LeftSidebar() {
  const sections = [
    { label: "Dashboard", href: "/", icon: "grid" },
    { label: "Institutions", href: "/institutions", icon: "building" },
    { label: "News", href: "/news", icon: "newspaper" },
    { label: "Reports", href: "/reports", icon: "chart" },
    { label: "Jobs", href: "/jobs", icon: "briefcase" },
    { label: "NRB Center", href: "/nrb", icon: "bank" },
    { label: "Research", href: "/research", icon: "magnifying" },
    { label: "Documents", href: "/documents", icon: "file" },
    { label: "Videos", href: "/videos", icon: "play" },
  ];

  return (
    <aside className="lg:col-span-2 hidden lg:block">
      <nav className="sticky top-20 space-y-1">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-mfi-50 hover:text-mfi-700 transition font-medium"
          >
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            {s.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
