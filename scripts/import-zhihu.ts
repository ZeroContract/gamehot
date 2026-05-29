/**
 * 导入知乎文章到 items.json（临时脚本，后续改为 opencli 常规信源）
 *
 * 使用方式:
 *   export $(grep -v '^#' .env.local | grep DEEPSEEK_API_KEY | head -1) && npx tsx scripts/import-zhihu.ts
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const ITEMS_FILE = path.join(DATA_DIR, "items.json");
const INPUT_FILE = path.join(DATA_DIR, "zhihu-hreo-articles.json");

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
6. 打标签（从以下选 1-2 个最合适的，标签值严格等于"行业""公司""游戏""干货""展会""AI"这六个词之一）：
   行业（行业趋势、政策法规、市场数据、产业报告）
   公司（公司动态、投融资、人事变动、财报业绩）
   游戏（游戏产品、新游发布、运营数据、品类分析）
   干货（技术分享、开发经验、设计方法论、实用工具）
   展会（游戏展会、行业峰会、电竞赛事、嘉年华、线下活动）
   AI（AI技术、人工智能应用、AI投融资、AI游戏）

请严格以 JSON 格式返回（不要 markdown 代码块包裹）：
{"titleZh":"...","summaryZh":"...","importance":0,"articleQuality":0,"timeliness":0,"uniqueness":0,"usefulness":0,"totalScore":0,"isSelected":false,"reason":"","tags":[]}`;

// ---- Types ----
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
  relatedItems: any[];
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

interface ZhihuArticle {
  title: string;
  url: string;
  excerpt: string;
  created: number;
  date: string;
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
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const jsonStr = cleaned.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();

  return JSON.parse(jsonStr);
}

async function scoreItem(title: string, snippet: string, sourceName: string): Promise<{
  titleZh: string;
  summaryZh: string;
  score: AiScore;
}> {
  try {
    const prompt = SCORE_PROMPT.replace("{title}", title)
      .replace("{snippet}", snippet || title)
      .replace("{sourceName}", sourceName);

    const result = await callAI(prompt);
    const totalScore = result.totalScore || 0;
    const isSelected = result.isSelected ?? totalScore >= 60;
    const finalScore = totalScore > 0
      ? Math.round(totalScore * 0.8 + (60 / 100) * 20)
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
    console.error(`  AI scoring failed for "${title.slice(0, 60)}...":`, error);
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

async function main() {
  if (!AI_API_KEY) {
    console.error("❌ 请设置 DEEPSEEK_API_KEY 环境变量");
    process.exit(1);
  }

  const articles: ZhihuArticle[] = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const existingItems: Item[] = JSON.parse(fs.readFileSync(ITEMS_FILE, "utf-8"));

  const sourceId = "zhihu-hreo";
  const sourceName = "罗斯基（知乎）";
  const existingUrls = new Set(existingItems.map((i) => i.url));

  console.log(`📥 导入知乎文章: ${articles.length} 篇\n`);

  const newItems: Item[] = [];

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const url = a.url.replace(/^http:\/\//, "https://");

    if (existingUrls.has(url)) {
      console.log(`  ⏭️ 已存在: "${a.title.slice(0, 50)}..."`);
      continue;
    }

    console.log(`  🆕 [${i + 1}/${articles.length}] "${a.title.slice(0, 50)}..." — AI 评分中...`);

    const { titleZh, summaryZh, score } = await scoreItem(a.title, a.excerpt, sourceName);

    newItems.push({
      id: generateId(),
      sourceId,
      sourceName,
      url,
      title: a.title,
      titleZh,
      summaryZh,
      author: "罗斯基",
      publishedAt: new Date(a.created * 1000).toISOString(),
      fetchedAt: new Date().toISOString(),
      isSelected: score.totalScore >= 60,
      score,
    });

    if (score.totalScore >= 60) {
      console.log(`    ✅ 精选 | 总分: ${score.totalScore} | ${score.reason}`);
    } else {
      console.log(`    ⬜ 未入选 | 总分: ${score.totalScore}`);
    }

    // 限速
    await new Promise((r) => setTimeout(r, 500));
  }

  // 合并：新文章在前
  const allItems = [...newItems, ...existingItems]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 3000);

  fs.writeFileSync(ITEMS_FILE, JSON.stringify(allItems, null, 2), "utf-8");

  console.log(`\n📊 导入完成:`);
  console.log(`   新增: ${newItems.length} 条`);
  console.log(`   精选: ${newItems.filter((i) => i.isSelected).length} 条`);
  console.log(`   总计: ${allItems.length} 条`);
}

main().catch((err) => {
  console.error("导入出错:", err);
  process.exit(1);
});
