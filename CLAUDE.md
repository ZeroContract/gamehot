# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project overview

GameHot is a Chinese game industry news aggregator. It scrapes Chinese game news sites, uses AI (MiniMax-M2.7) to score/translate/summarize articles, and displays a curated timeline on a Next.js frontend.

4 active sources: 游戏葡萄 (opencli browser), 游戏茶馆 (cheerio), 游资网 (cheerio), 游戏陀螺 (cheerio). 2 sources in config but skipped at runtime (empty url, pending cheerio migration).

## Architecture

```
scripts/fetch.ts          →  Scraping + AI scoring pipeline (the data engine)
  ├── cheerio             →  HTTP fetch + CSS selector scraping (web type sources)
  ├── opencli browser     →  Real Chrome browser scraping for JS-rendered pages
  ├── REST API            →  JSON API with pagination + custom response transforms
  └── callAI (MiniMax)    →  Scoring, translation, summarization (MiniMax-M2.7)

data/
  ├── items.json          →  All articles with AI scores
  └── sources.json        →  Source configs (selectors, URLs, weights, endpoint)

src/                      →  Next.js 16 frontend (React 19, App Router)
  app/page.tsx            →  Timeline view, ?view=all (全量) or default (精选), ?q= & ?tag=
  app/dashboard/page.tsx  →  Visitor stats dashboard (password-protected, hidden from nav)
  app/api/track/route.ts  →  POST endpoint for pageview tracking
  app/api/auth/route.ts   →  POST endpoint for dashboard password auth
  components/FeedToolbar  →  Category filter bar (行业/公司/游戏/干货/展会/AI)
  components/Sidebar      →  Nav: 精选 / 全部 / 关于 (dashboard link intentionally hidden)
  components/TimelineCard →  Article card with score, tags, AI reason, related items
  components/Tracker      →  Client component, fires /api/track on page navigation
  components/LoginForm    →  Password form for dashboard access
  lib/data.ts             →  Read/filter items.json and sources.json
  lib/kv.ts               →  Upstash Redis client (visitor stats storage)
```

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run fetch        # Run scraping + AI scoring pipeline
npx tsx scripts/rescore.ts  # Re-score existing items.json with current prompt
```

`npm run fetch` requires `DEEPSEEK_API_KEY` in environment (MiniMax API key, historical naming). Load from `.env.local`:
```bash
export $(grep -v '^#' .env.local | grep DEEPSEEK_API_KEY | head -1) && npm run fetch
```

## Fetch pipeline

### Source types

| Type | Method | Use case |
|------|--------|----------|
| `web` | cheerio (HTTP + CSS selectors) | Static/server-rendered pages, optional pagination |
| `api` | REST API + response transform | JSON APIs with pagination support |
| `opencli-author` | opencli Chrome browser + React fiber extraction | Client-rendered QQ News author pages |
| `rss` | RSS/Atom feed parser | Standard feeds |

### Web sources (cheerio)

Each web source in `data/sources.json` supports:
- **`url`** — Primary page URL (also used for `isExternalUrl()` hostname checks).
- **`urls`** — Array of entry-point URLs (e.g. category pages). Falls back to single `url`.
- **`maxPages`** — Max pagination pages per URL. Pagination uses WordPress `/page/N` format. Stops early on duplicate or old articles.
- **`daysBack`** — Time window in days (default 7).
- **`listSelector` / `titleSelector` / `linkSelector` / `snippetSelector` / `dateSelector`** — CSS selectors.
- **`baseUrl`** — Resolves relative links. Falls back to page URL.

Anti-crawl: UA pool (6 UAs), `Referer` header, random delays (1.5–3s between pages, 2–4s between categories), `zh-CN` Accept-Language.

`extractEntries()` auto-strips `.status` category labels embedded inside title elements (游戏陀螺 quirk).

### API sources

API sources use `endpoint`, optional `params` (query string), `maxPages` (pagination), `daysBack` (time cutoff), and `transformResponse` (maps to an `apiTransforms` entry in fetch.ts).

Pagination: loops `page=1` to `maxPages`, sets `page` + `limit` query params. Stops early if a page's oldest entry exceeds `daysBack`. Custom transforms in `apiTransforms` dict (currently: `hn-algolia`, `reddit-json`, `github-releases`, `devto`, `tuoluo`, `generic`).

### OpenCLI author sources

For QQ News author pages (`news.qq.com/omn/author/{id}`) which are pure client-side React SPAs.

`fetchOpencliAuthor()` flow:
1. `opencli browser open <url>` → opens Chrome automation window
2. Wait 5s for React render
3. Scroll 8 times (2s intervals) to load articles back ~20 days
4. `opencli browser eval <js>` → walks React fiber tree to extract `articleData` props
5. Filter by `daysBack`, convert to `RawEntry[]`, feed to `processEntries()`

Articles are on `view.inews.qq.com`; `isExternalUrl()` treats `view.inews.qq.com` / `news.qq.com` / `i.news.qq.com` as same-family.

Requires: opencli daemon running + Chrome extension connected. Not available on GitHub Actions CI.

### Date parsing

`parseDate()` supports: relative times (X天前/X小时前/X分钟前), Chinese dates (2026年5月9日), dot-separated (2025.03.20), ISO (2026-05-15), MM-DD (05-26, with year inference + cross-year rollback), and JS `new Date()` fallback.

### Scoring

MiniMax-M2.7 via OpenAI-compatible API at `https://api.minimax.chat/v1`. Env vars: `DEEPSEEK_API_KEY` (required), `AI_MODEL` / `AI_API_BASE` (optional overrides).

5 dimensions each scored 1-20 (满分 100), calibrated benchmarks in prompt.
- `totalScore >= 60` → `isSelected: true` (精选/上榜)
- `finalScore = totalScore * 0.8 + (sourceWeight / 100) * 20`
- Cross-source dedup: Chinese bigram Jaccard similarity (threshold 0.4, 7-day window)
- Lower-scored duplicates become `relatedItems` of the higher-scored one
- 6 tags: 行业, 公司, 游戏, 干货, 展会, AI
- Frontend score colors: >= 90 red, >= 80 green, >= 60 orange, < 60 gray

MiniMax wraps responses in `<think>...</think>` tags; `callAI()` strips them. Occasional JSON parse failures caught and logged; `scoreItem()` catch block returns zero scores. Run `npx tsx scripts/rescore.ts` to repair.

### Source status

| Source | Status | Type | Weight |
|--------|--------|------|--------|
| 游戏葡萄 | Active — QQ News author page, opencli rendering | `opencli-author` | 85 |
| 游戏茶馆 | Active — 5 category URLs, 3 maxPages, 7 daysBack | `web` | 60 |
| 游资网 | Active — /list/4 推荐聚合页, MM-DD date parsing | `web` | 60 |
| 游戏陀螺 | Active — 首页 + /news 双 URL, cheerio; API seed for 7-day backfill | `web` | 65 |
| 腾讯游戏学堂 | Disabled — pending cheerio migration | `web` | 50 |
| 游戏日报 | Disabled — pending cheerio migration | `web` | 60 |

### Data flow

1. `main()` reads `sources.json`, filters active sources: web needs `!!url \|\| urls.length`, api needs `endpoint`, opencli-author needs `url`, rss needs `feedUrl`
2. Serial processing (concurrency=1), 2 retries for web sources
3. Extraction: web → `fetchWebLegacy()`, api → `fetchApi()`, opencli-author → `fetchOpencliAuthor()`
4. `processEntries()`: resolve redirects, skip external/images, dedup by URL, call `scoreItem()` per entry, 500ms rate limit
5. All items merged into `items.json` (max 3000), cross-source dedup, write to disk

## Frontend

Single-page app at `/`. Two views:
- **精选** (`/`) — only `isSelected: true` items (score >= 60)
- **全部** (`/?view=all`) — all items including low scores

Both views share the same `FeedToolbar` category filter (行业/公司/游戏/干货/展会/AI) and search. Sidebar nav: 精选 / 全部 / 关于.

## Visitor tracking

Pages are tracked via the `Tracker` client component (included in root layout). On each navigation, it POSTs `{ path }` to `/api/track`, which stores data in Upstash Redis:

- **PV**: `INCR pv:2026-05-29` per day, plus `INCR pv:2026-05-29:/path` per page
- **UV**: `PFADD uv:2026-05-29 <ip>` using HyperLogLog for approximate unique counts
- All keys auto-expire after 30 days (within Upstash free tier)

## Dashboard

`/dashboard` shows 7-day PV/UV stats with a bar chart. Protected by `DASHBOARD_PASSWORD` env var — first visit shows a password form, correct password sets an httpOnly cookie (7-day TTL). The dashboard link is intentionally hidden from the sidebar nav.

## Deployment

**Vercel** with GitHub auto-deploy on push to `main`. Upstash Redis integration provides `KV_REST_API_URL` + `KV_REST_API_TOKEN` (auto-injected by Vercel). Env vars set in Vercel dashboard:
- `DEEPSEEK_API_KEY` — MiniMax API key (required for fetch pipeline)
- `DASHBOARD_PASSWORD` — Dashboard access password

## Scheduling

**Primary**: A detached `screen` session runs a fetch loop on the local Mac mini every 30 minutes.

```bash
screen -ls                    # Check if daemon is running (look for "gamehot")
screen -r gamehot             # Attach to see live output (Ctrl+A D to detach)
tail -f data/cron.log         # View fetch logs
```

If the Mac reboots, restart:
```bash
screen -dmS gamehot zsh -c 'while true; do sleep 1800; /bin/bash ~/Desktop/GameHot/scripts/run-fetch.sh >> ~/Desktop/GameHot/data/cron.log 2>&1; done'
```

`scripts/run-fetch.sh` does: git pull → `npm run fetch` → if changed, git commit + push. API key loaded from `.env.local`.

**Backup**: GitHub Actions `workflow_dispatch` (manual trigger only). Cheerio mode only; opencli not available on CI runners.

## Data model

- `data/sources.json` — Source configs. Types in `scripts/fetch.ts` (`Source` interface).
- `data/items.json` — All articles. Key fields: `isSelected` (curated, threshold 60), `score.totalScore`, `score.finalScore`, `score.relatedItems[]`. Types in `src/lib/types.ts`.
