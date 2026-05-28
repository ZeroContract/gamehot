"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

const ALL_TAGS = [
  { key: "", label: "全部" },
  { key: "行业", label: "行业" },
  { key: "公司", label: "公司" },
  { key: "游戏", label: "游戏" },
  { key: "干货", label: "干货" },
  { key: "展会", label: "展会" },
  { key: "AI", label: "AI" },
];

export default function FeedToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTag = searchParams.get("tag") || "";

  const handleTagChange = useCallback(
    (tag: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tag) {
        params.set("tag", tag);
      } else {
        params.delete("tag");
      }
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="feed-toolbar-row">
      <div className="segmented" role="tablist" aria-label="分类筛选">
        {ALL_TAGS.map((t) => (
          <button
            key={t.key}
            role="tab"
            className={`segmented-item ${activeTag === t.key ? "active" : ""}`}
            onClick={() => handleTagChange(t.key)}
            aria-selected={activeTag === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form className="feed-filter-search-row" method="get" action={pathname}>
        {activeTag && <input type="hidden" name="tag" value={activeTag} />}
        <input
          name="q"
          defaultValue={searchParams.get("q") || ""}
          placeholder="搜索标题/摘要…"
          className="feed-filter-search-input"
        />
        <button className="btn btn-primary btn-sm" type="submit">
          搜索
        </button>
      </form>
    </div>
  );
}
