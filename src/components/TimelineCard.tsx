import type { Item } from "@/lib/types";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const dayMs = 86400000;

  if (diff < dayMs && d.getDate() === now.getDate()) return "今天";
  if (diff < dayMs * 2 && d.getDate() === now.getDate() - 1) return "昨天";

  return d.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function getScoreClass(score: number): string {
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  return "low";
}

export default function TimelineCard({ item }: { item: Item }) {
  const { score } = item;
  const scoreClass = score ? getScoreClass(score.finalScore) : "low";

  return (
    <div className="timeline-item">
      <div className="timeline-time">{formatTime(item.publishedAt)}</div>
      <div className="timeline-rail" aria-hidden="true" />

      <article className="timeline-card">
        <div className="timeline-card-head">
          <div className="timeline-head-left">
            <span className="timeline-source-name">{item.sourceName}</span>
          </div>
          <div className="timeline-head-right">
            {score && (
              <span className={`timeline-score ${scoreClass}`} title="AI 质量评分">
                ★ {score.finalScore}
              </span>
            )}
          </div>
        </div>

        <div className="timeline-card-title">
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.titleZh || item.title}
          </a>
        </div>

        {item.summaryZh && <div className="timeline-card-summary">{item.summaryZh}</div>}

        {score && score.tags.length > 0 && (
          <div className="timeline-tags">
            {score.tags.map((tag) => (
              <span key={tag} className="timeline-tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        {score && score.reason && <div className="timeline-reason">{score.reason}</div>}

        {score && score.relatedItems.length > 0 && (
          <div className="timeline-related">
            <div className="timeline-related-label">同话题文章</div>
            {score.relatedItems.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="timeline-related-link"
                title={r.title}
              >
                <span className="timeline-related-source">{r.sourceName}</span>
                <span className="timeline-related-title">{r.titleZh || r.title}</span>
              </a>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

export { formatDate };
