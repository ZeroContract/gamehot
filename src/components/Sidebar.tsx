"use client";

import { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [themeDark, setThemeDark] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setThemeDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setThemeDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const view = searchParams.get("view") || "";

  const navItems = [
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
      label: "精选",
      href: "/",
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      ),
      label: "全部",
      href: "/?view=all",
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      ),
      label: "关于",
      href: "/about",
    },
  ];

  function isActive(item: typeof navItems[number]) {
    if (item.href === "/about") return pathname === "/about";
    if (item.href === "/?view=all") return pathname === "/" && view === "all";
    return pathname === "/" && view !== "all";
  }

  return (
    <>
      <div className={`sidebar-overlay ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} />

      <div className="app-mobile-bar">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="打开菜单">
          ☰
        </button>
        <span className="mobile-brand">GameHot</span>
        <span className="mobile-brand-sub">芝麻的游戏圈</span>
      </div>

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="主导航">
        <div className="sidebar-brand">
          <span className="sidebar-brand-dot" />
          GameHot
        </div>
        <div className="sidebar-subtitle">游戏开发热点精选</div>

        <nav className="side-nav">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className={`side-nav-item ${isActive(item) ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="side-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          公众号：芝麻的游戏圈
        </div>
      </aside>
    </>
  );
}
