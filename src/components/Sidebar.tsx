"use client";

import { useState, useEffect } from "react";

export default function Sidebar() {
  const [themeDark, setThemeDark] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setThemeDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setThemeDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const navItems = [
    { icon: "✦", label: "精选", href: "/", active: true },
    // { icon: "☰", label: "全部动态", href: "/all" },
    // { icon: "⊞", label: "信源管理", href: "/sources" },
  ];

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
              className={`side-nav-item ${item.active ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="side-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="theme-toggle">
            <span style={{ fontSize: 14 }}>{themeDark ? "🌙" : "☀️"}</span>
            <span>{themeDark ? "深色" : "浅色"}</span>
          </div>
          <div>数据来源: 20+ 游戏开发信源</div>
          <div>AI 翻译评分: DeepSeek</div>
        </div>
      </aside>
    </>
  );
}
