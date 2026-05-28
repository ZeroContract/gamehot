# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project overview

GameHot is a Chinese game industry news aggregator. It scrapes Chinese game news sites, uses AI (MiniMax-M2.7) to score/translate/summarize articles, and displays a curated timeline on a Next.js frontend.

Two active sources: 游戏葡萄 (opencli browser) and 游戏茶馆 (cheerio). Four sources disabled pending migration.

## Architecture

```
scripts/fetch.ts          →  Scraping + AI scoring pipeline (the data engine)
  ├── cheerio             →  HTTP fetch + CSS selector scraping (web type sources)
  ├── opencli browser     →  Real Chrome browser scraping for JS-rendered pages
  └── callAI (MiniMax)    →  Scoring, translation, summarization (MiniMax-M2.7)

data/
  ├── items.json          →  All articles with AI scores
  └── sources.json        →  Source configs (selectors, URLs, weights)

src/                      →  Next.js 16 frontend (React 19, App Router)
  app/page.tsx            →  Single-page timeline view, filters via ?q= & ?tag=
  components/TimelineCard →  Article card with score, tags, AI reason, related items
  lib/data.ts             →  Read/filter items.json and sources.json
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
| `web` | cheerio (HTTP + CSS selectors) | Static/server-rendered pages with pagination |
| `opencli-author` | opencli Chrome browser + React fiber extraction | Client-rendered QQ News author pages |
| `rss` | RSS/Atom feed parser | Standard feeds |
| `api` | REST API + response transform | JSON APIs |

### Web sources (cheerio)

Each web source in `data/sources.json` supports:
- **`urls`** — Array of entry-point URLs (e.g. category pages). Falls back to single `url`.
- **`maxPages`** — Max pagination pages per URL. Stops early on duplicate or old articles.
- **`daysBack`** — Time window in days (default 7).
- **`listSelector` / `titleSelector` / `linkSelector` / `snippetSelector` / `dateSelector`** — CSS selectors.

Pagination format is WordPress-standard (`/page/N`). Anti-crawl: UA pool (6 UAs), `Referer` header, random delays (1.5–3s between pages, 2–4s between categories), `zh-CN` Accept-Language.

### OpenCLI author sources

Used for QQ News author pages (`news.qq.com/omn/author/{id}`) which are pure client-side React SPAs with no SSR content.

`fetchOpencliAuthor()` flow:
1. `opencli browser open <url>` → opens Chrome automation window
2. Wait 5s for React render
3. Scroll 8 times (2s intervals) to load articles back ~20 days
4. `opencli browser eval <js>` → walks React fiber tree to extract `articleData` props (id, title, url, time, timestamp)
5. Filter by `daysBack`, convert to `RawEntry[]`, feed to `processEntries()`

Articles are on `view.inews.qq.com`; `isExternalUrl()` treats `view.inews.qq.com` / `news.qq.com` / `i.news.qq.com` as same-family.

Requires: opencli daemon running + Chrome extension connected. Not available on GitHub Actions CI.

### Scoring

MiniMax-M2.7 via OpenAI-compatible API at `https://api.minimax.chat/v1`. Env vars: `DEEPSEEK_API_KEY` (required), `AI_MODEL` / `AI_API_BASE` (optional overrides).

5 dimensions each scored 1-20 (满分 100), calibrated benchmarks in prompt.
- `totalScore >= 60` → `isSelected: true` (上榜)
- `finalScore = totalScore * 0.8 + (sourceWeight / 100) * 20`
- Cross-source dedup: Chinese bigram Jaccard similarity (threshold 0.4, 7-day window)
- Lower-scored duplicates become `relatedItems` of the higher-scored one
- 6 tags: 行业, 公司, 游戏, 干货, 活动, AI
- Frontend score colors: >= 90 red, >= 80 green, >= 60 orange, < 60 gray

MiniMax wraps responses in `<think>...</think>` tags; `callAI()` strips them. Occasional JSON parse failures caught and logged.

### Source status

| Source | Status | Type | Weight |
|--------|--------|------|--------|
| 游戏葡萄 | Active — QQ News author page, opencli rendering | `opencli-author` | 85 |
| 游戏茶馆 | Active — 5 category URLs, 3 maxPages, 7 daysBack | `web` | 60 |
| 腾讯游戏学堂 | Disabled — pending cheerio migration | `web` | 50 |
| 游戏陀螺 | Disabled — pending cheerio migration | `web` | 65 |
| 游戏日报 | Disabled — pending cheerio migration | `web` | 60 |
| 游资网 | Disabled — pending cheerio migration | `web` | 60 |

Disabled sources keep their config in `sources.json` with `url: ""` so they're skipped by the active filter.

### Data flow

1. `main()` reads `sources.json`, filters active sources by type+required fields
2. Serial processing (concurrency=1), 2 retries for web sources
3. Extraction: web → `fetchWebLegacy()`, opencli-author → `fetchOpencliAuthor()`
4. `processEntries()`: resolve redirects, skip external/images, dedup by URL, call `scoreItem()` per entry, 500ms rate limit
5. All items merged into `items.json` (max 3000), cross-source dedup, write to disk

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
