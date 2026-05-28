# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project overview

GameHot is a Chinese game industry news aggregator. It scrapes Chinese game news sites, uses AI (MiniMax-M2.7) to score/translate/summarize articles, and displays a curated timeline on a Next.js frontend.

Sources are being migrated one by one to a per-source customized scraping approach.

## Architecture

```
scripts/fetch.ts          →  Scraping + AI scoring pipeline (the data engine)
  ├── cheerio             →  HTTP fetch + CSS selector scraping
  ├── opencli browser     →  Real Chrome browser scraping (planned, not yet integrated)
  ├── callAI (MiniMax)    →  Scoring, translation, summarization (MiniMax-M2.7)
  └── data/items.json     →  Output: all articles with scores

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
```

`npm run fetch` requires `DEEPSEEK_API_KEY` in environment (MiniMax API key, historical naming). Load from `.env.local`:
```bash
export $(grep -v '^#' .env.local | grep DEEPSEEK_API_KEY | head -1) && npm run fetch
```

## Fetch pipeline

### Extraction

All sources are `web` type using cheerio (HTTP fetch + CSS selectors). Each source in `data/sources.json` supports:

- **`urls`** — Array of entry-point URLs (e.g. category pages). If absent, falls back to single `url`.
- **`maxPages`** — Max pagination pages per URL. Stops early on duplicate or old articles.
- **`daysBack`** — Time window in days (default 7). Articles older than this are discarded, and pagination stops when the window is exceeded.
- **`listSelector` / `titleSelector` / `linkSelector` / `snippetSelector` / `dateSelector`** — CSS selectors for cheerio extraction.

Pagination format is WordPress-standard (`/page/N`). Total pages parsed from `1 / N` in pagination markup.

Anti-crawl measures: UA pool rotation (6 UAs), `Referer` header on paginated requests, random delays (1.5–3s between pages, 2–4s between categories). All requests use `zh-CN` Accept-Language.

### Scoring

MiniMax-M2.7 via OpenAI-compatible API at `https://api.minimax.chat/v1`. Env vars: `DEEPSEEK_API_KEY` (required), `AI_MODEL` / `AI_API_BASE` (optional overrides).

5 dimensions each scored 1-10: importance, articleQuality, timeliness, uniqueness, usefulness.
- `totalScore >= 25` → `isSelected: true`
- `finalScore = totalScore * 0.6 + (sourceWeight / 100) * 20`
- Cross-source dedup via Chinese bigram Jaccard similarity (threshold 0.4, 7-day window)
- Lower-scored duplicate articles become `relatedItems` of the higher-scored one

MiniMax-M2.7 wraps responses in `<think>...</think>` tags; `callAI()` strips these before JSON parsing. Occasional JSON parse failures are caught and logged.

### Source migration status

Sources are being customized one at a time:

| Source | Status |
|--------|--------|
| 游戏茶馆 | Done — 5 category URLs, 3 maxPages, 7 daysBack |
| 腾讯游戏学堂 | Pending — old single-URL config |
| 游戏陀螺 | Pending — old single-URL config |
| 游戏日报 | Pending — old single-URL config |
| 游资网 | Pending — old single-URL config |

When migrating a source: analyze the site's DOM structure, anti-crawl needs, and pagination. Design selectors and strategy accordingly. Run fetch for that source alone before re-enabling others.

### Data flow

1. `main()` reads `sources.json`, filters active sources (web needs `url` or `urls`)
2. Serial processing (concurrency=1), 2 retries for web sources
3. `fetchWebLegacy()`: fetch HTML → cheerio extract entries → filter by time + dedup → pass to `processEntries()`
4. `processEntries()`: resolve redirects, dedup by URL, call `scoreItem()` per entry, 500ms rate limit
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

**Backup**: GitHub Actions `workflow_dispatch` (manual trigger only, no schedule). Cheerio mode only; opencli not available on CI runners.

## Data model

- `data/sources.json` — Source configs with CSS selectors, URLs, and scraping params. Types in `scripts/fetch.ts` (`Source` interface).
- `data/items.json` — All articles. Key fields: `isSelected` (curated), `score.totalScore`, `score.finalScore`, `score.relatedItems[]`. Types in `src/lib/types.ts`.
