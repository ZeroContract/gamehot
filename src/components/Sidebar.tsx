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
    { icon: "✦", label: "精选", href: "/" },
    { icon: "◈", label: "全部", href: "/?view=all" },
    { icon: "ℹ", label: "关于", href: "/about" },
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
