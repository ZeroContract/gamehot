/**
 * GameHot 数据抓取 + AI 评分管线
 *
 * 支持三种信源类型:
 *   rss  — RSS/Atom feed 解析
 *   web  — cheerio 静态网页爬虫
 *   api  — REST API 调用 + 响应变换
 *
 * 使用方式:
 *   npx tsx scripts/fetch.ts
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY - AI API 密钥 (MiniMax / DeepSeek 等 OpenAI 兼容接口)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const DATA_DIR = path.join(__dirname, "..", "data");
const SOURCES_FILE = path.join(DATA_DIR, "sources.json");
const ITEMS_FILE = path.join(DATA_DIR, "items.json");

const AI_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const AI_API_BASE = process.env.AI_API_BASE || "https://api.minimax.chat/v1";
const AI_MODEL = process.env.AI_MODEL || "MiniMax-M2.7";

const SCORE_PROMPT = `你是游戏行业的资深编辑。请对以下游戏开发相关新闻进行评估。

内容标题：{title}
内容摘要：{snippet}
来源名称：{sourceName}

1. 翻译标题为中文（简洁，20 字以内）
2. 写一段中文摘要（50-80 字，包含关键信息）
3. 从 1-20 打分（5 个维度，满分 100）。务必拉开差距，充分使用 1-20 全区间：
   评分基准：18-20=顶级/行业标杆，15-17=优秀，12-14=良好，8-11=一般，4-7=较弱，1-3=很差
   - 重要性：对游戏行业从业者（研发、发行、市场、运营等）的参考价值
   - 文章质量：内容深度、论据充分性、信息密度、行文水平
   - 时效性：信息新鲜度、是否紧跟行业动态
   - 独特性：是否独家视角、差异化观点、一手信息
   - 实用度：从业者能否直接应用到实际工作中
4. 计算总分（5 维加总，满分 100），如果总分 >= 60 分则判定为精选
5. 如果精选，写一句话推荐理由（30 字以内，口语化、有信息量）
5b. 如果未精选（总分 < 60），写一句话不推荐理由（30 字以内，口语化，说明为什么不值得推荐，例如"内容较水""信息量不足""与游戏行业关联弱"等）
6. 打标签（从以下选 1-2 个最合适的，标签值严格等于"行业""公司""游戏""干货""展会""AI"这六个词之一）：
   行业（行业趋势、政策法规、市场数据、产业报告）
   公司（公司动态、投融资、人事变动、财报业绩）
   游戏（游戏产品、新游发布、运营数据、品类分析）
   干货（技术分享、开发经验、设计方法论、实用工具）
   展会（游戏展会、行业峰会、电竞赛事、嘉年华、线下活动）
   AI（AI技术、人工智能应用、AI投融资、AI游戏）

请严格以 JSON 格式返回（不要 markdown 代码块包裹）：
{"titleZh":"...","summaryZh":"...","importance":0,"articleQuality":0,"timeliness":0,"uniqueness":0,"usefulness":0,"totalScore":0,"isSelected":false,"reason":"","notReason":"","tags":[]}`;

// ---- Types ----
interface Source {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  type: string;
  tier: number;
  weight: number;
  urls?: string[];
  maxPages?: number;
  daysBack?: number;
  listSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  snippetSelector?: string;
  dateSelector?: string;
  baseUrl?: string;
  endpoint?: string;
  params?: Record<string, string>;
  transformResponse?: string;
  encoding?: string;
  urlToken?: string;
  contentType?: string;
}

interface AiScore {
  importance: number;
  articleQuality: number;
  timeliness: number;
  uniqueness: number;
  usefulness: number;
  totalScore: number;
  finalScore: number;
  reason: string;
  notReason: string;
  tags: string[];
  relatedItems: RelatedItem[];
}

interface Item {
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
  score: AiScore;
}

interface RelatedItem {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  titleZh: string;
  publishedAt: string;
  totalScore: number;
}

interface RawEntry {
  title: string;
  url: string;
  snippet: string;
  author: string | null;
  publishedAt: string;
}

// ---- Helpers ----
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/^www\./, "");
    u.hash = "";
    // 去掉尾部斜杠
    let pathname = u.pathname.replace(/\/$/, "");
    u.pathname = pathname;
    return u.toString();
  } catch {
    return url.replace(/^https?:\/\/www\./, "https://");
  }
}

function isImageUrl(url: string): boolean {
  const imageExts = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?.*)?$/i;
  try {
    const pathname = new URL(url).pathname;
    return imageExts.test(pathname);
  } catch {
    return imageExts.test(url);
  }
}

function deDupeKey(sourceId: string, url: string): string {
  return `${sourceId}::${normalizeUrl(url)}`;
}

function parseDate(text: string): string | null {
  const now = new Date();

  // "X天前"
  const dayAgo = text.match(/(\d+)\s*天前/);
  if (dayAgo) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(dayAgo[1]));
    return d.toISOString();
  }

  // "X小时前"
  const hourAgo = text.match(/(\d+)\s*小时前/);
  if (hourAgo) {
    const d = new Date(now);
    d.setHours(d.getHours() - parseInt(hourAgo[1]));
    return d.toISOString();
  }

  // "X分钟前"
  const minAgo = text.match(/(\d+)\s*分钟前/);
  if (minAgo) {
    const d = new Date(now);
    d.setMinutes(d.getMinutes() - parseInt(minAgo[1]));
    return d.toISOString();
  }

  // "2026年5月9日" 或 "2026年05月09日"
  const zhDate = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (zhDate) {
    const [, y, m, d] = zhDate;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString();
  }

  // "2025.03.20" 点分隔日期
  const dotDate = text.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotDate) {
    const [, y, m, d] = dotDate;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString();
  }

  // "05-26" (MM-DD，游资网)
  const mmdd = text.match(/^(\d{1,2})-(\d{1,2})\b/);
  if (mmdd) {
    const now = new Date();
    const d = new Date(now.getFullYear(), parseInt(mmdd[1]) - 1, parseInt(mmdd[2]));
    if (d > now) d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }

  // "2026-05-15" 或 "2026-05-15 14:30"
  const isoDate = text.match(/(\d{4}-\d{2}-\d{2})(?:[\sT](\d{2}:\d{2}(?::\d{2})?))?/);
  if (isoDate) {
    const d = new Date(isoDate[0].replace(" ", "T"));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 标准 parse
  const d = new Date(text);
  if (!isNaN(d.getTime())) return d.toISOString();

  return null;
}

// 中文字符 bigram Jaccard 相似度（0~1）
function bigramSimilarity(a: string, b: string): number {
  const getBigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  };
  const setA = getBigrams(a);
  const setB = getBigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function normalizeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

let _sourcesCache: Source[] | null = null;
function getSources(): Source[] {
  if (!_sourcesCache) {
    _sourcesCache = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8")) as Source[];
  }
  return _sourcesCache!;
}

function lookupSourceByUrl(url: string): { sourceId: string; sourceName: string } | null {
  const entryHost = normalizeHostname(url);
  if (!entryHost) return null;
  for (const source of getSources()) {
    if (normalizeHostname(source.url) === entryHost) {
      return { sourceId: source.id, sourceName: source.name };
    }
  }
  return null;
}

function isExternalUrl(url: string, sourceUrl: string): boolean {
  const entryHost = normalizeHostname(url);
  const sourceHost = normalizeHostname(sourceUrl);
  if (!entryHost || !sourceHost) return false;
  if (entryHost === sourceHost) return false;

  // 腾讯新闻文章托管在 view.inews.qq.com，当源是 news.qq.com 时不视为外链
  const TENCENT_NEWS_HOSTS = ["view.inews.qq.com", "news.qq.com", "i.news.qq.com"];
  if (TENCENT_NEWS_HOSTS.includes(entryHost) && TENCENT_NEWS_HOSTS.includes(sourceHost)) {
    return false;
  }

  // 知乎文章托管在 zhuanlan.zhihu.com，当源是 www.zhihu.com 时不视为外链
  const ZHIHU_HOSTS = ["zhuanlan.zhihu.com", "www.zhihu.com", "zhihu.com"];
  if (ZHIHU_HOSTS.includes(entryHost) && ZHIHU_HOSTS.includes(sourceHost)) {
    return false;
  }

  return true;
}

function fixupItemSource(item: Item): void {
  const sourceInfo = lookupSourceByUrl(item.url);
  if (sourceInfo && (item.sourceId !== sourceInfo.sourceId || item.sourceName !== sourceInfo.sourceName)) {
    console.log(`  🔧 修正来源: "${item.sourceName}" → "${sourceInfo.sourceName}" (${item.url.slice(0, 60)}...)`);
    item.sourceId = sourceInfo.sourceId;
    item.sourceName = sourceInfo.sourceName;
  }
}

async function resolveFinalUrl(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "GameHot/1.0" },
    });
    return resp.url;
  } catch {
    return url;
  }
}

function buildRelatedItem(item: Item): RelatedItem {
  const sourceInfo = lookupSourceByUrl(item.url);
  return {
    sourceId: sourceInfo?.sourceId || item.sourceId,
    sourceName: sourceInfo?.sourceName || item.sourceName,
    url: item.url,
    title: item.title,
    titleZh: item.titleZh,
    publishedAt: item.publishedAt,
    totalScore: item.score?.totalScore || 0,
  };
}

function deduplicateCrossSource(items: Item[]): void {
  const SIMILARITY_THRESHOLD = 0.4;
  const TIME_WINDOW_MS = 7 * 24 * 3600 * 1000;

  // 按 finalScore 降序排列，让高分文章优先处理
  const sorted = [...items].sort(
    (a, b) => (b.score?.finalScore || 0) - (a.score?.finalScore || 0)
  );

  for (let i = 0; i < sorted.length; i++) {
    const primary = sorted[i];
    if (!primary.isSelected || !primary.score) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const candidate = sorted[j];
      if (!candidate.isSelected || !candidate.score) continue;
      if (primary.sourceId === candidate.sourceId) continue;

      // 时间窗口：7 天内
      const pTime = new Date(primary.publishedAt).getTime();
      const cTime = new Date(candidate.publishedAt).getTime();
      if (Math.abs(pTime - cTime) > TIME_WINDOW_MS) continue;

      // 中文标题 bigram 相似度
      const titleA = primary.titleZh || primary.title;
      const titleB = candidate.titleZh || candidate.title;
      if (bigramSimilarity(titleA, titleB) < SIMILARITY_THRESHOLD) continue;

      // primary 分数更高，candidate 归入其 relatedItems
      if (!primary.score.relatedItems.find((r) => r.url === candidate.url)) {
        primary.score.relatedItems.push(buildRelatedItem(candidate));
      }
      // 把 candidate 已有的 relatedItems 也合并过来
      for (const r of candidate.score.relatedItems) {
        if (!primary.score.relatedItems.find((x) => x.url === r.url)) {
          primary.score.relatedItems.push(r);
        }
      }
      candidate.isSelected = false;
    }
  }
}

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Edge/131.0.0.0 Safari/537.36",
];

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url: string, encoding?: string, referer?: string): Promise<string> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
  };
  if (referer) {
    headers["Referer"] = referer;
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  if (encoding && encoding.toLowerCase() !== "utf-8") {
    return iconv.decode(buf, encoding);
  }

  // 尝试从 meta 标签检测编码
  const head = buf.slice(0, 1024).toString("ascii").toLowerCase();
  const charsetMatch = head.match(/charset[="\s]+([\w-]+)/i);
  if (charsetMatch && charsetMatch[1].toLowerCase() !== "utf-8") {
    return iconv.decode(buf, charsetMatch[1]);
  }

  return buf.toString("utf-8");
}

async function callAI(prompt: string): Promise<any> {
  const res = await fetch(`${AI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "你是一个专业的游戏行业编辑，回复必须是合法 JSON。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    throw new Error(`AI API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content.trim();

  // MiniMax-M2.7 等推理模型会输出 <think>...</think> 标签，先去掉
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const jsonStr = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();

  return JSON.parse(jsonStr);
}

async function scoreItem(
  title: string,
  snippet: string,
  sourceName: string,
  sourceWeight: number
): Promise<{ titleZh: string; summaryZh: string; score: AiScore }> {
  try {
    const prompt = SCORE_PROMPT.replace("{title}", title)
      .replace("{snippet}", snippet || title)
      .replace("{sourceName}", sourceName);

    const result = await callAI(prompt);

    const totalScore = result.totalScore || 0;
    const isSelected = result.isSelected ?? totalScore >= 60;
    const finalScore = totalScore > 0
      ? Math.round(totalScore * 0.8 + (sourceWeight / 100) * 20)
      : 0;

    return {
      titleZh: result.titleZh || title,
      summaryZh: result.summaryZh || "",
      score: {
        importance: result.importance || 0,
        articleQuality: result.articleQuality || 0,
        timeliness: result.timeliness || 0,
        uniqueness: result.uniqueness || 0,
        usefulness: result.usefulness || 0,
        totalScore,
        finalScore,
        reason: isSelected ? result.reason || "" : "",
        notReason: !isSelected ? result.notReason || "" : "",
        tags: result.tags || [],
        relatedItems: [],
      },
    };
  } catch (error) {
    console.error(`  AI scoring failed for "${title.slice(0, 50)}...":`, error);
    return {
      titleZh: title,
      summaryZh: "",
      score: {
        importance: 0,
        articleQuality: 0,
        timeliness: 0,
        uniqueness: 0,
        usefulness: 0,
        totalScore: 0,
        finalScore: 0,
        reason: "",
        notReason: "",
        tags: [],
        relatedItems: [],
      },
    };
  }
}

async function processEntries(
  source: Source,
  entries: RawEntry[],
  existingKeys: Set<string>,
): Promise<Item[]> {
  const items: Item[] = [];

  for (const entry of entries) {
    if (!entry.url) continue;
    if (isImageUrl(entry.url)) {
      console.log(`  ⏭️ 跳过图片链接: ${entry.url}`);
      continue;
    }

    if (isExternalUrl(entry.url, source.url)) {
      console.log(`  ⏭️ 跳过外部链接: ${entry.url}`);
      continue;
    }

    // 解析重定向，过滤跨站跳转（如游资网 /wl?m= 外链跳转）
    const finalUrl = normalizeUrl(await resolveFinalUrl(entry.url));
    if (isImageUrl(finalUrl)) {
      console.log(`  ⏭️ 跳过图片链接(重定向后): ${entry.url} → ${finalUrl}`);
      continue;
    }
    if (isExternalUrl(finalUrl, source.url)) {
      console.log(`  ⏭️ 跳过跨站跳转: ${entry.url} → ${finalUrl}`);
      continue;
    }

    const key = deDupeKey(source.id, finalUrl);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    const title = entry.title || "";
    const snippet = entry.snippet || "";

    console.log(`  🆕 "${title.slice(0, 60)}..." — AI 评分中...`);

    const { titleZh, summaryZh, score } = await scoreItem(
      title,
      snippet.slice(0, 500),
      source.name,
      source.weight
    );

    const isSelected = score.totalScore >= 60;

    items.push({
      id: generateId(),
      sourceId: source.id,
      sourceName: source.name,
      url: finalUrl,
      title,
      titleZh,
      summaryZh,
      author: entry.author,
      publishedAt: entry.publishedAt || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      isSelected,
      score,
    });

    // API 调用限速
    await new Promise((r) => setTimeout(r, 500));
  }

  return items;
}

// ============================================================
//  RSS 抓取
// ============================================================
async function fetchRSS(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const parser = new Parser({ timeout: 15000 });
  const feed = await parser.parseURL(source.feedUrl);
  const entries: RawEntry[] = [];

  for (const entry of feed.items || []) {
    const url = entry.link || entry.guid || "";
    entries.push({
      title: entry.title || "",
      url,
      snippet: entry.contentSnippet || entry.content || "",
      author: entry.creator || null,
      publishedAt: entry.isoDate || entry.pubDate || new Date().toISOString(),
    });
  }

  return processEntries(source, entries, existingKeys);
}

// ============================================================
//  Web 爬虫 - cheerio
// ============================================================
// 从 HTML 中用 cheerio 提取文章列表
function extractEntries(
  html: string,
  source: Source,
  pageUrl: string
): RawEntry[] {
  const $ = cheerio.load(html);

  const listSelector = source.listSelector || "article";
  const titleSelector = source.titleSelector || "h2 a, h3 a";
  const linkSelector = source.linkSelector || "a";
  const snippetSelector = source.snippetSelector || "p";
  const dateSelector = source.dateSelector || "time";
  const baseUrl = source.baseUrl || pageUrl;

  const entries: RawEntry[] = [];

  $(listSelector).each((_i, el) => {
    const $el = $(el);

    const $titleEl = $el.find(titleSelector).first();
    let title = $titleEl.text().trim();

    // 去除标题内嵌的分类标签（如 .status span）
    const $status = $titleEl.find(".status");
    if ($status.length > 0) {
      const statusText = $status.first().text().trim();
      if (title.startsWith(statusText)) {
        title = title.slice(statusText.length).trim();
      }
    }
    let link = $titleEl.attr("href") || "";

    if (!link) {
      link = $el.find(linkSelector).first().attr("href") || "";
    }

    if (!link && $el.is("a") && $el.attr("href")) {
      link = $el.attr("href") || "";
    }

    if (link && !link.startsWith("http")) {
      try {
        link = new URL(link, baseUrl).href;
      } catch {
        link = baseUrl.replace(/\/$/, "") + "/" + link.replace(/^\//, "");
      }
    }

    let snippet = $el.find(snippetSelector).first().text().trim();
    if (!snippet) {
      snippet = $el.text().trim().slice(0, 300);
    }

    let dateStr = $el.find(dateSelector).first().attr("datetime") ||
      $el.find(dateSelector).first().text().trim();
    let publishedAt = new Date().toISOString();

    if (dateStr) {
      publishedAt = parseDate(dateStr) || publishedAt;
    }

    if (title && link) {
      entries.push({
        title,
        url: link,
        snippet: snippet.slice(0, 500),
        author: null,
        publishedAt,
      });
    }
  });

  return entries;
}

// 从分页 HTML 中解析总页数（匹配 "1 / 21" 这类模式）
function parseTotalPages(html: string): number {
  const m = html.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return parseInt(m[2], 10);
  return 1;
}

// 生成翻页 URL（WordPress 标准格式：/page/N）
function buildPageUrl(baseUrl: string, page: number): string {
  const clean = baseUrl.replace(/\/$/, "");
  return `${clean}/page/${page}`;
}

async function fetchWebLegacy(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const urls = (source.urls && source.urls.length > 0) ? source.urls : [source.url];
  const maxPages = source.maxPages || 1;
  const daysBack = source.daysBack ?? 7;
  const cutOff = new Date();
  cutOff.setDate(cutOff.getDate() - daysBack);

  const allEntries: RawEntry[] = [];

  for (const url of urls) {
    console.log(`  🌐 ${url}`);

    // 抓取第 1 页
    const html1 = await fetchHtml(url, source.encoding);
    const entries1 = extractEntries(html1, source, url);
    const recent1 = entries1.filter((e) => new Date(e.publishedAt) >= cutOff);
    const new1 = recent1.filter((e) => !existingKeys.has(deDupeKey(source.id, normalizeUrl(e.url))));

    allEntries.push(...new1);

    const totalPages = Math.min(parseTotalPages(html1), maxPages);
    const dupStop = new1.length < recent1.length;
    const timeStop = recent1.length < entries1.length;
    const stopPagination = dupStop || timeStop;
    const reasons: string[] = [];
    if (dupStop) reasons.push("已有重复");
    if (timeStop) reasons.push("时间边界");
    console.log(`    📄 第 1 页: ${new1.length}/${entries1.length} 条${stopPagination ? ` ⏹️ ${reasons.join(" + ")}` : `，共 ${totalPages} 页待抓`}`);

    if (stopPagination) continue;

    // 抓取后续翻页
    for (let p = 2; p <= totalPages; p++) {
      const prevUrl = buildPageUrl(url, p - 1);
      const pageUrl = buildPageUrl(url, p);

      await randomDelay(1500, 3000);
      const html = await fetchHtml(pageUrl, source.encoding, prevUrl);
      const entries = extractEntries(html, source, pageUrl);
      const recent = entries.filter((e) => new Date(e.publishedAt) >= cutOff);
      const fresh = recent.filter((e) => !existingKeys.has(deDupeKey(source.id, normalizeUrl(e.url))));

      if (entries.length === 0 || recent.length === 0 || fresh.length === 0) {
        const r = recent.length === 0 ? "无近期内容" : "全部重复";
        console.log(`    📄 第 ${p} 页: 0 条有效 (${r}) ⏹️`);
        break;
      }
      allEntries.push(...fresh);

      const hasDup = fresh.length < recent.length;
      const hasOld = recent.length < entries.length;
      if (hasDup || hasOld) {
        const rs: string[] = [];
        if (hasDup) rs.push("已有重复");
        if (hasOld) rs.push("时间边界");
        console.log(`    📄 第 ${p} 页: ${fresh.length}/${entries.length} 条 ⏹️ ${rs.join(" + ")}`);
        break;
      }
      console.log(`    📄 第 ${p} 页: ${fresh.length}/${entries.length} 条`);
    }

    // 不同分类页之间稍长间隔
    await randomDelay(2000, 4000);
  }

  console.log(`  📄 共解析 ${allEntries.length} 条条目 (近 ${daysBack} 天)`);
  return processEntries(source, allEntries, existingKeys);
}

// ============================================================
//  API 抓取 + 响应变换
// ============================================================

interface ApiResponseTransform {
  (data: any, source: Source): RawEntry[];
}

const apiTransforms: Record<string, ApiResponseTransform> = {
  // Hacker News Algolia 搜索 API
  "hn-algolia": (data: any) => {
    return (data.hits || []).map((hit: any) => ({
      title: hit.title || "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: hit.story_text || hit.comment_text || "",
      author: hit.author || null,
      publishedAt: hit.created_at || new Date().toISOString(),
    }));
  },

  // Reddit JSON API
  "reddit-json": (data: any) => {
    const posts = data?.data?.children || [];
    return posts.map((child: any) => {
      const post = child.data || {};
      return {
        title: post.title || "",
        url: `https://www.reddit.com${post.permalink || ""}`,
        snippet: post.selftext || post.title || "",
        author: post.author || null,
        publishedAt: new Date((post.created_utc || 0) * 1000).toISOString(),
      };
    });
  },

  // GitHub Releases API
  "github-releases": (data: any) => {
    const releases = Array.isArray(data) ? data : data.releases || [];
    return releases.map((rel: any) => ({
      title: `${rel.name || rel.tag_name} (${rel.target_commitish || "main"})`,
      url: rel.html_url || "",
      snippet: rel.body || "",
      author: rel.author?.login || null,
      publishedAt: rel.published_at || rel.created_at || new Date().toISOString(),
    }));
  },

  // Dev.to API
  "devto": (data: any) => {
    const articles = Array.isArray(data) ? data : data.articles || [];
    return articles.map((a: any) => ({
      title: a.title || "",
      url: a.url || a.canonical_url || "",
      snippet: a.description || a.summary || "",
      author: a.user?.name || a.user?.username || null,
      publishedAt: a.published_at || a.created_at || new Date().toISOString(),
    }));
  },

  // 游戏陀螺 API: { data: { data: [...], pages: N } }
  "tuoluo": (data: any) => {
    const items = data?.data?.data || [];
    return items.map((item: any) => ({
      title: item.title || "",
      url: `https://www.youxituoluo.com/${item.aid}.html`,
      snippet: item.dis || "",
      publishedAt: item.sendtime
        ? new Date(Math.floor(item.sendtime * 1000)).toISOString()
        : new Date().toISOString(),
    }));
  },

  // 通用 JSON 数组（尝试常见字段名）
  "generic": (data: any) => {
    const items = Array.isArray(data) ? data : data.items || data.results || data.data || [];
    return items.map((item: any) => ({
      title: item.title || item.name || item.headline || "",
      url: item.url || item.link || item.html_url || "",
      snippet: item.description || item.summary || item.snippet || item.body || "",
      author: item.author || item.creator || item.by || null,
      publishedAt: item.publishedAt || item.created_at || item.date || new Date().toISOString(),
    }));
  },
};

async function fetchApi(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const baseUrl = source.endpoint || "";
  if (!baseUrl) throw new Error("API source missing endpoint");

  const maxPages = source.maxPages || 1;
  const limit = source.params?.limit || "15";
  const allEntries: RawEntry[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let url = baseUrl;
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(page));
    searchParams.set("limit", String(limit));
    if (source.params) {
      Object.entries(source.params).forEach(([k, v]) => {
        if (k !== "limit") searchParams.set(k, v);
      });
    }
    url += (url.includes("?") ? "&" : "?") + searchParams.toString();

    const res = await fetch(url, {
      headers: {
        "User-Agent": "GameHot/0.1 (news aggregator bot)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`API HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const strategy = source.transformResponse || "generic";
    const transform = apiTransforms[strategy] || apiTransforms["generic"];
    const entries = transform(data, source);

    if (!entries || entries.length === 0) break;

    // 时间边界：如果当前页最旧的条目已超过 daysBack，停止翻页
    const daysBack = source.daysBack ?? 7;
    const cutOff = new Date();
    cutOff.setDate(cutOff.getDate() - daysBack);
    const recentEntries = entries.filter((e) => new Date(e.publishedAt) >= cutOff);

    allEntries.push(...recentEntries);

    if (recentEntries.length < entries.length) {
      console.log(`    📡 第 ${page} 页: ${entries.length}→${recentEntries.length} 条 ⏹️ 时间边界`);
      break;
    }
    console.log(`    📡 第 ${page} 页: ${entries.length} 条`);

    // 检查是否还有更多页
    const totalPages = data?.data?.pages || data?.pages || 0;
    if (totalPages > 0 && page >= totalPages) break;

    await randomDelay(500, 1000);
  }

  console.log(`  📡 API 共返回 ${allEntries.length} 条条目 (近 ${source.daysBack ?? 7} 天)`);
  return processEntries(source, allEntries, existingKeys);
}

// ============================================================
//  OpenCLI 浏览器抓取 (腾讯新闻作者页等 JS 渲染页面)
// ============================================================

async function fetchOpencliAuthor(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const authorUrl = source.url;
  const daysBack = source.daysBack ?? 7;
  const cutOff = new Date();
  cutOff.setDate(cutOff.getDate() - daysBack);

  console.log(`  🌐 打开浏览器: ${authorUrl}`);
  execSync(`opencli browser open "${authorUrl}"`, { encoding: "utf-8", stdio: "pipe" });

  // 等 React 渲染
  console.log(`  ⏳ 等待页面渲染...`);
  execSync(`opencli browser wait time 5`, { encoding: "utf-8", stdio: "pipe" });

  // 滚动加载足够文章
  for (let i = 0; i < 8; i++) {
    execSync(`opencli browser scroll down`, { encoding: "utf-8", stdio: "pipe" });
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 从 React fiber 提取文章数据
  const extractJs = [
    '(function() {',
    'var items = document.querySelectorAll(".author-article-item");',
    'var results = [];',
    'for (var i = 0; i < items.length; i++) {',
    '  var fiberKey = Object.keys(items[i]).find(function(k) { return k.indexOf("__reactFiber")===0; });',
    '  if (!fiberKey) continue;',
    '  var fiber = items[i][fiberKey];',
    '  for (var d = 0; d < 15 && fiber; d++) {',
    '    var ad = fiber.memoizedProps && fiber.memoizedProps.articleData;',
    '    if (ad && ad.id && ad.title) {',
    '      results.push({id:ad.id,title:ad.title,url:ad.url,time:ad.time,timestamp:ad.timestamp});',
    '      break;',
    '    }',
    '    fiber = fiber.return;',
    '  }',
    '}',
    'return JSON.stringify(results);',
    '})();',
  ].join("");

  fs.writeFileSync("/tmp/opencli_extract.js", extractJs, "utf-8");
  const raw = execSync(`opencli browser eval "$(< /tmp/opencli_extract.js)"`, {
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });

  let articles: any[];
  try {
    articles = JSON.parse(raw.trim());
  } catch {
    console.error(`  ❌ 解析文章数据失败`);
    return [];
  }

  console.log(`  📄 提取到 ${articles.length} 篇文章`);

  const entries: RawEntry[] = [];
  for (const a of articles) {
    const pubDate = new Date(a.time);
    if (isNaN(pubDate.getTime())) continue;
    if (pubDate < cutOff) continue;

    entries.push({
      title: a.title,
      url: a.url,
      snippet: a.title,
      author: null,
      publishedAt: pubDate.toISOString(),
    });
  }

  console.log(`  📄 近 ${daysBack} 天: ${entries.length} 篇`);
  return processEntries(source, entries, existingKeys);
}

// ============================================================
//  知乎用户抓取（opencli 浏览器 + 内部 API）
// ============================================================
async function fetchZhihuUser(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const urlToken = source.urlToken;
  const contentType = source.contentType || "articles";
  const daysBack = source.daysBack ?? 7;
  const cutOff = Math.floor(Date.now() / 1000) - daysBack * 86400;

  if (!urlToken) {
    console.error(`  ❌ 缺少 urlToken 配置`);
    return [];
  }

  // 打开知乎页面确保登录态有效
  console.log(`  🌐 打开知乎: ${source.url}`);
  execSync(`opencli browser open "${source.url}"`, { encoding: "utf-8", stdio: "pipe" });

  // 随机等待，模拟人类浏览行为（8-12s，知乎反爬较严）
  const pageWait = 8 + Math.random() * 4;
  console.log(`  ⏳ 等待页面加载 (${pageWait.toFixed(1)}s)...`);
  execSync(`opencli browser wait time ${Math.round(pageWait)}`, { encoding: "utf-8", stdio: "pipe" });

  // 滚动 3-5 次，模拟浏览行为
  const scrolls = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    execSync(`opencli browser scroll down`, { encoding: "utf-8", stdio: "pipe" });
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  }

  // 额外等待，确保浏览器 cookie 环境就绪
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

  // 通过浏览器内 fetch 调用知乎 API（自动携带 cookies）
  const allArticles: { title: string; url: string; excerpt: string; created: number }[] = [];
  const limit = 20;
  const maxPages = 3; // 7 天内最多 3 页足够

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const apiUrl = `https://www.zhihu.com/api/v4/members/${urlToken}/${contentType}?limit=${limit}&offset=${offset}&include=data%5B%2A%5D.title,url,excerpt,created`;

    const fetchJs = `
      (async function() {
        try {
          var resp = await fetch('${apiUrl}', {
            credentials: 'include',
            headers: {
              'Referer': 'https://www.zhihu.com/people/${urlToken}/${contentType}',
              'x-api-version': '3.0.0',
              'x-requested-with': 'fetch'
            }
          });
          if (!resp.ok) return JSON.stringify({error: 'HTTP ' + resp.status});
          var json = await resp.json();
          if (!json.data) return JSON.stringify({error: 'no data', raw: json});
          var items = json.data.map(function(a) {
            return {title: a.title, url: a.url, excerpt: a.excerpt, created: a.created};
          });
          return JSON.stringify({paging: json.paging, items: items});
        } catch(e) {
          return JSON.stringify({error: e.message});
        }
      })();
    `;

    fs.writeFileSync("/tmp/zhihu_fetch.js", fetchJs, "utf-8");
    const raw = execSync(`opencli browser eval "$(< /tmp/zhihu_fetch.js)"`, {
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    });

    let result: any;
    try {
      result = JSON.parse(raw.trim());
    } catch {
      console.error(`  ❌ 解析 API 响应失败 (page ${page + 1})`);
      break;
    }

    if (result.error) {
      console.error(`  ❌ API 错误: ${result.error}`);
      break;
    }

    const items = result.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (item.created < cutOff) {
        console.log(`  📄 分页 ${page + 1}: 获取 ${items.length} 条，超出时间窗口，停止翻页`);
        return buildZhihuEntries(source, allArticles, existingKeys);
      }
      allArticles.push(item);
    }

    console.log(`  📄 分页 ${page + 1}: ${items.length} 条 (累计 ${allArticles.length})`);

    if (result.paging && result.paging.is_end) break;

    // 页面间随机延迟 1.5-3s
    await randomDelay(1500, 3000);
  }

  return buildZhihuEntries(source, allArticles, existingKeys);
}

function buildZhihuEntries(
  source: Source,
  articles: { title: string; url: string; excerpt: string; created: number }[],
  existingKeys: Set<string>
): Promise<Item[]> {
  const entries: RawEntry[] = articles.map((a) => ({
    title: a.title,
    url: (a.url || "").replace(/^http:\/\//, "https://"),
    snippet: a.excerpt || a.title,
    author: null,
    publishedAt: new Date(a.created * 1000).toISOString(),
  }));

  console.log(`  📄 共 ${entries.length} 条在时间范围内`);
  return processEntries(source, entries, existingKeys);
}

// ============================================================
//  主流程
// ============================================================

async function main() {
  if (!AI_API_KEY) {
    console.error("❌ 请设置 DEEPSEEK_API_KEY 环境变量");
    console.error("   export DEEPSEEK_API_KEY=sk-...");
    process.exit(1);
  }

  console.log("📡 GameHot 数据抓取开始...\n");

  const sources: Source[] = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"));
  const activeSources = sources.filter((s) => {
    if (s.type === "rss") return !!s.feedUrl;
    if (s.type === "web") return !!s.url || (!!s.urls && s.urls.length > 0);
    if (s.type === "api") return !!s.endpoint;
    if (s.type === "opencli-author") return !!s.url;
    if (s.type === "zhihu-user") return !!s.urlToken;
    return false;
  });

  console.log(`📋 活跃信源: ${activeSources.length} 个 (RSS + Web + API)\n`);

  // 读取已有条目，构建去重集合
  const existingItems: Item[] = JSON.parse(fs.readFileSync(ITEMS_FILE, "utf-8"));

  // 修正已有数据中来源与 URL 不匹配的条目
  _sourcesCache = sources; // 预填缓存
  for (const item of existingItems) {
    fixupItemSource(item);
  }

  const existingKeys = new Set<string>(
    existingItems.map((i) => deDupeKey(i.sourceId, i.url))
  );

  // 并行抓取（限制并发数，避免同时开太多浏览器 OOM）
  const CONCURRENCY = 1; // 串行避免同时开多个浏览器 OOM
  const newItems: Item[] = [];

  for (let i = 0; i < activeSources.length; i += CONCURRENCY) {
    const batch = activeSources.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        const typeLabel = { rss: "📡 RSS", web: "🕷️  Web", api: "🔌 API", "opencli-author": "🌐 OpenCLI", "zhihu-user": "🟦 知乎" }[source.type] || "📡";
        const sourceLabel = source.urls ? source.urls.join(", ") : source.url;
console.log(`${typeLabel} 抓取: ${source.name} (${sourceLabel})`);

        const maxRetries = source.type === "web" ? 2 : 1;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            let items: Item[];

            switch (source.type) {
              case "rss":
                items = await fetchRSS(source, existingKeys);
                break;
              case "web":
                items = await fetchWebLegacy(source, existingKeys);
                break;
              case "api":
                items = await fetchApi(source, existingKeys);
                break;
              case "opencli-author":
                items = await fetchOpencliAuthor(source, existingKeys);
                break;
              case "zhihu-user":
                items = await fetchZhihuUser(source, existingKeys);
                break;
              default:
                console.log(`  ⚠️ 未知类型: ${source.type}，跳过`);
                return [];
            }

            console.log(`  ✅ ${source.name}: +${items.length} 条新内容`);
            return items;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
              console.log(`  🔄 ${source.name} 重试 (${attempt}/${maxRetries})...`);
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
        }

        console.error(`  ❌ ${source.name}: ${lastError!.message}`);
        return [];
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        newItems.push(...result.value);
      }
    }
  }

  console.log();

  // 合并新旧数据
  const allItems = [...newItems, ...existingItems]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 3000);

  // 跨信源 AI 打分去重：同话题高分文章作为主条目，低分文章转为 relatedItems
  console.log(`\n🔍 跨信源去重中...`);
  deduplicateCrossSource(allItems);
  const dedupedCount = allItems.filter(
    (i) => !i.isSelected && i.score && i.score.totalScore >= 60
  ).length;

  fs.writeFileSync(ITEMS_FILE, JSON.stringify(allItems, null, 2), "utf-8");

  console.log(`📊 抓取完成:`);
  console.log(`   新增: ${newItems.length} 条`);
  console.log(`   精选: ${allItems.filter((i) => i.isSelected).length} 条`);
  console.log(`   去重隐藏: ${dedupedCount} 条`);
  console.log(`   总计: ${allItems.length} 条`);
}

main().catch((err) => {
  console.error("抓取过程出错:", err);
  process.exit(1);
});
