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
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { spawn } from "node:child_process";

const DATA_DIR = path.join(__dirname, "..", "data");
const SOURCES_FILE = path.join(DATA_DIR, "sources.json");
const ITEMS_FILE = path.join(DATA_DIR, "items.json");

const AI_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const AI_API_BASE = process.env.AI_API_BASE || "https://api.minimax.chat/v1";
const AI_MODEL = process.env.AI_MODEL || "MiniMax-M2.7";

// ---- 抓取模式: 环境变量 USE_HERMES 控制，默认自动检测 ----
// (常量定义见下方 HERMES_BIN 之后)

const SCORE_PROMPT = `你是游戏行业的资深编辑。请对以下游戏开发相关新闻进行评估。

内容标题：{title}
内容摘要：{snippet}
来源名称：{sourceName}

1. 翻译标题为中文（简洁，20 字以内）
2. 写一段中文摘要（50-80 字，包含关键信息）
3. 从 1-10 打分（5 个维度）：
   - 重要性：对游戏行业从业者（研发、发行、市场、运营等）的参考价值
   - 文章质量：内容深度、论据充分性、信息密度、行文水平
   - 时效性：信息新鲜度、是否紧跟行业动态
   - 独特性：是否独家视角、差异化观点、一手信息
   - 实用度：从业者能否直接应用到实际工作中
4. 计算总分（5 维加总，满分 50），如果总分 >= 25 分则判定为精选
5. 如果精选，写一句话推荐理由（30 字以内，口语化、有信息量）
6. 打标签（从以下选 1-2 个最合适的，标签值严格等于"行业""公司""游戏""干货"这四个词之一）：
   行业（行业趋势、政策法规、市场数据、产业报告）
   公司（公司动态、投融资、人事变动、财报业绩）
   游戏（游戏产品、新游发布、运营数据、品类分析）
   干货（技术分享、开发经验、设计方法论、实用工具）

请严格以 JSON 格式返回（不要 markdown 代码块包裹）：
{"titleZh":"...","summaryZh":"...","importance":0,"articleQuality":0,"timeliness":0,"uniqueness":0,"usefulness":0,"totalScore":0,"isSelected":false,"reason":"","tags":[]}`;

// ---- Types ----
interface Source {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  type: string;
  tier: number;
  weight: number;
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

function deDupeKey(sourceId: string, url: string): string {
  return `${sourceId}::${url}`;
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

function buildRelatedItem(item: Item): RelatedItem {
  return {
    sourceId: item.sourceId,
    sourceName: item.sourceName,
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

async function fetchHtml(url: string, encoding?: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
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
    const isSelected = result.isSelected ?? totalScore >= 25;
    const finalScore = totalScore > 0
      ? Math.round(totalScore * 0.6 + (sourceWeight / 100) * 20)
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

    const key = deDupeKey(source.id, entry.url);
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

    const isSelected = score.totalScore >= 25;

    items.push({
      id: generateId(),
      sourceId: source.id,
      sourceName: source.name,
      url: entry.url,
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
//  Web 爬虫 - Hermes AI 版本 (智能解析页面)
// ============================================================

const HERMES_BIN = "/Users/zhima/.local/bin/hermes";

// 自动检测：Hermes 二进制存在则启用，也可通过环境变量 USE_HERMES=true/false 强制
const USE_HERMES = process.env.USE_HERMES === "true" ||
  (process.env.USE_HERMES !== "false" && fs.existsSync(HERMES_BIN));

function callHermes(prompt: string, timeoutMs: number = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(HERMES_BIN, [
      "chat", "-q", prompt,
      "--quiet",
      "--toolsets", "browser",
      "--model", "MiniMax-M2.7",
      "--accept-hooks",
      "--max-turns", "12",
    ], {
      timeout: timeoutMs,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`hermes exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", (err: Error) => {
      reject(new Error(`hermes spawn failed: ${err.message}`));
    });
  });
}

function parseHermesOutput(stdout: string): RawEntry[] {
  const text = stdout.trim();

  // 提取 JSON 数组
  const patterns = [
    /```json\s*([\s\S]*?)\s*```/,
    /```\s*([\s\S]*?)\s*```/,
    /\[\s*\{[\s\S]*\}\s*\]/,
  ];

  let jsonStr = "";
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      jsonStr = (match[1] || match[0]).trim();
      break;
    }
  }

  if (!jsonStr) {
    throw new Error(`No JSON array found in Hermes output: ${text.slice(0, 300)}`);
  }

  // 尝试直接解析
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeEntry);
    }
  } catch {
    // JSON 有格式问题，尝试逐对象修复解析
  }

  // 逐对象提取：用 },{ 分割，分别解析每个对象
  const innerMatch = jsonStr.match(/^\s*\[\s*([\s\S]*?)\s*\]\s*$/);
  const inner = innerMatch ? innerMatch[1] : jsonStr.replace(/^\[|\]$/g, "");
  const entries: RawEntry[] = [];

  // 按 },{ 或 }\n{ 分割
  const chunks = inner.split(/},\s*\{/);
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (i === 0 && !chunk.startsWith("{")) chunk = "{" + chunk;
    if (i === chunks.length - 1 && !chunk.endsWith("}")) chunk = chunk + "}";
    if (i > 0 && i < chunks.length - 1) chunk = "{" + chunk + "}";

    // 尝试修复未转义的双引号
    try {
      entries.push(normalizeEntry(JSON.parse(chunk)));
    } catch {
      try {
        const repaired = repairJsonString(chunk);
        entries.push(normalizeEntry(JSON.parse(repaired)));
      } catch {
        // 跳过解析失败的单条
      }
    }
  }

  if (entries.length === 0) {
    throw new Error(`Failed to parse any JSON objects from Hermes output`);
  }

  return entries;
}

function normalizeEntry(item: any): RawEntry {
  return {
    title: String(item.title || ""),
    url: String(item.url || item.link || ""),
    snippet: String(item.snippet || item.summary || item.description || "").slice(0, 500),
    author: item.author || null,
    publishedAt: item.publishedAt || item.date || new Date().toISOString(),
  };
}

function repairJsonString(str: string): string {
  // 修复字符串值中未转义的双引号：
  // 匹配 "key":"value" 中的 value 部分，转义其中的裸双引号
  return str.replace(/(":\s*")(.*?)(")/g, (_match, prefix: string, value: string, suffix: string) => {
    // 将 value 中的未转义双引号替换为转义双引号
    const escaped = value.replace(/(?<!\\)"/g, '\\"');
    return prefix + escaped + suffix;
  });
}

const HERMES_EXTRACT_PROMPT = `打开以下网址，用浏览器实际访问页面，提取最新的游戏行业新闻列表。

网址：{url}

提取字段：
- title: 新闻标题（原文）
- url: 完整新闻链接（相对路径需拼接 base URL）
- snippet: 摘要（50字内）
- publishedAt: 发布日期（ISO 8601 或 null）
最多 15 条，跳过广告和非新闻内容。

严格输出 JSON 数组（title/snippet 中的双引号必须反斜杠转义）：
[{"title":"标题","url":"https://...","snippet":"摘要","publishedAt":"2026-05-27T00:00:00Z"}]`;

async function fetchWebWithHermes(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const prompt = HERMES_EXTRACT_PROMPT.replace("{url}", source.url);

  console.log("  🤖 Hermes AI 解析页面...");
  const stdout = await callHermes(prompt, 180000);

  const entries = parseHermesOutput(stdout);
  console.log(`  📄 解析到 ${entries.length} 条条目`);

  return processEntries(source, entries, existingKeys);
}

// ============================================================
//  Web 爬虫 - cheerio 版本 (CSS 选择器，保留作为 fallback)
// ============================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchWebLegacy(source: Source, existingKeys: Set<string>): Promise<Item[]> {
  const html = await fetchHtml(source.url, source.encoding);
  const $ = cheerio.load(html);

  const listSelector = source.listSelector || "article";
  const titleSelector = source.titleSelector || "h2 a, h3 a";
  const linkSelector = source.linkSelector || "a";
  const snippetSelector = source.snippetSelector || "p";
  const dateSelector = source.dateSelector || "time";
  const baseUrl = source.baseUrl || source.url;

  const entries: RawEntry[] = [];

  $(listSelector).each((_i, el) => {
    const $el = $(el);

    // 标题 + 链接：优先从标题选择器内部找 a 标签
    const $titleEl = $el.find(titleSelector).first();
    const title = $titleEl.text().trim();
    let link = $titleEl.attr("href") || "";

    // 如果标题选择器没找到链接，用 linkSelector
    if (!link) {
      link = $el.find(linkSelector).first().attr("href") || "";
    }

    // 兜底：item 元素自身就是 <a> 标签（如腾讯游戏学堂的 .news__item）
    if (!link && $el.is("a") && $el.attr("href")) {
      link = $el.attr("href") || "";
    }

    // 处理相对路径
    if (link && !link.startsWith("http")) {
      try {
        link = new URL(link, baseUrl).href;
      } catch {
        link = baseUrl.replace(/\/$/, "") + "/" + link.replace(/^\//, "");
      }
    }

    // 摘要
    let snippet = $el.find(snippetSelector).first().text().trim();
    if (!snippet) {
      snippet = $el.text().trim().slice(0, 300);
    }

    // 日期
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

  console.log(`  📄 解析到 ${entries.length} 条条目`);
  return processEntries(source, entries, existingKeys);
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
  let url = source.endpoint || "";
  if (!url) throw new Error("API source missing endpoint");

  // 拼接查询参数
  if (source.params) {
    const searchParams = new URLSearchParams(source.params);
    url += (url.includes("?") ? "&" : "?") + searchParams.toString();
  }

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

  console.log(`  📡 API 返回 ${entries.length} 条条目`);
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
    if (s.type === "web") return !!s.url;
    if (s.type === "api") return !!s.endpoint;
    return false;
  });

  console.log(`📋 活跃信源: ${activeSources.length} 个 (RSS + Web + API)\n`);

  // 读取已有条目，构建去重集合
  const existingItems: Item[] = JSON.parse(fs.readFileSync(ITEMS_FILE, "utf-8"));
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
        const typeLabel = { rss: "📡 RSS", web: "🕷️  Web", api: "🔌 API" }[source.type] || "📡";
        console.log(`${typeLabel} 抓取: ${source.name} (${source.url})`);

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
                if (USE_HERMES) {
                  try {
                    items = await fetchWebWithHermes(source, existingKeys);
                  } catch (hermesErr) {
                    // Hermes 失败降级到 cheerio（MiniMax 不支持 vision，browser 模式偶发崩溃）
                    console.log(`  ⚠️ Hermes 失败，降级 cheerio: ${String(hermesErr).slice(0, 80)}`);
                    items = await fetchWebLegacy(source, existingKeys);
                  }
                } else {
                  items = await fetchWebLegacy(source, existingKeys);
                }
                break;
              case "api":
                items = await fetchApi(source, existingKeys);
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
    (i) => !i.isSelected && i.score && i.score.totalScore >= 25
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
