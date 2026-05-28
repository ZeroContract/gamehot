import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import FeedToolbar from "@/components/FeedToolbar";
import TimelineCard, { formatDate } from "@/components/TimelineCard";
import { getSelectedItems, searchItems, getItemsByTag, getAllItemsByTag, searchAllItems, getItems } from "@/lib/data";
import type { Item } from "@/lib/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; view?: string }>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const tag = params.tag || "";
  const viewAll = params.view === "all";

  let items: Item[];
  if (q) {
    items = viewAll ? searchAllItems(q) : searchItems(q);
  } else if (tag) {
    items = viewAll ? getAllItemsByTag(tag) : getItemsByTag(tag);
  } else {
    items = viewAll ? getItems() : getSelectedItems();
  }

  // 按日期分组
  const grouped: Map<string, Item[]> = new Map();
  items.forEach((item) => {
    const dateKey = formatDate(item.publishedAt);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(item);
  });

  return (
    <div className="app-shell">
      <Suspense fallback={<div className="sidebar" />}>
        <Sidebar />
      </Suspense>
      <main className="app-main">
        <div className="page">
          <section className="page-header">
            <div className="header-row">
              <div>
                <div className="page-title">{viewAll ? "全部" : "精选"}</div>
                <div className="page-subtitle">{viewAll ? "所有抓取的游戏开发内容" : "AI 自动挑选的高价值游戏开发内容"}</div>
              </div>
            </div>
            <div className="divider" />
            <Suspense fallback={<div className="feed-toolbar-row" />}>
              <FeedToolbar />
            </Suspense>
          </section>

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">暂无内容</div>
              <div className="empty-state-sub">
                {q ? `未找到与「${q}」相关的内容` : "数据抓取中，请稍后刷新"}
              </div>
            </div>
          ) : (
            <section className="timeline">
              {Array.from(grouped.entries()).map(([dateLabel, dayItems]) => (
                <div key={dateLabel} className="timeline-day">
                  <div className="timeline-day-head">
                    <span className="timeline-date">{dateLabel}</span>
                  </div>
                  <div className="timeline-day-items">
                    {dayItems.map((item) => (
                      <TimelineCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
