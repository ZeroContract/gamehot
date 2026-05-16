export interface Source {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  type: 'rss' | 'web' | 'api';
  tier: number; // 1=顶级 2=常规 3=实验
  weight: number; // 0-100
  // web 类型用 —— cheerio 选择器
  listSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  snippetSelector?: string;
  dateSelector?: string;
  baseUrl?: string;
  // api 类型用
  endpoint?: string;
  params?: Record<string, string>;
  transformResponse?: string;
  // 通用可选
  encoding?: string; // 非 UTF-8 站点指定编码，如 'gbk'
}

export interface RelatedItem {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  titleZh: string;
  publishedAt: string;
  totalScore: number;
}

export interface AiScore {
  importance: number; // 重要性：对游戏行业从业者的参考价值
  articleQuality: number; // 文章质量
  timeliness: number; // 时效性
  uniqueness: number; // 独特性
  usefulness: number; // 实用度
  totalScore: number; // 总分 (5维加总)
  finalScore: number; // 最终分 (AI评分 + 来源权重)
  reason: string; // 推荐理由
  tags: string[]; // 标签
  relatedItems: RelatedItem[]; // 其他信源的同话题文章
}

export interface Item {
  id: string;
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  titleZh: string;
  summaryZh: string;
  author: string | null;
  publishedAt: string;
  fetchedAt: string;
  isSelected: boolean;
  score: AiScore | null;
}

export interface FeedFilter {
  tag: string;
  query: string;
}

export type Theme = 'light' | 'dark';
