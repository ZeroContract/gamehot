# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project overview

GameHot is a Chinese game industry news aggregator. It scrapes 5 Chinese game news sites, uses AI to score/translate/summarize articles, and displays a curated timeline on a Next.js frontend.

## Architecture

```
scripts/fetch.ts          →  Scraping + AI scoring pipeline (the data engine)
  ├── Hermes browser      →  AI-powered browsing (Chrome + vision), local Mac only
  ├── cheerio fallback    →  CSS selector scraping (works anywhere)
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
npm run fetch        # Run scraping + AI scoring pipeline (npx tsx scripts/fetch.ts)
```

## Fetch pipeline

### Two models, one API provider

- **Extraction**: Hermes browser (local) or cheerio (CI/fallback) pulls news lists from web sources
- **Scoring**: `callAI()` → MiniMax-M2.7 at `https://api.minimax.chat/v1` (OpenAI-compatible)

The env var `DEEPSEEK_API_KEY` holds the MiniMax API key (historical naming). Override model via `AI_MODEL`/`AI_API_BASE`.

### Hermes integration

`scripts/fetch.ts` auto-detects Hermes at `/Users/zhima/.local/bin/hermes`. When present:
- Spawns `hermes chat -q --toolsets browser --model MiniMax-M2.7 --accept-hooks --max-turns 12`
- Hermes uses opencli browser to open real Chrome, scroll, extract content
- Uses MiniMax vision to understand page layout

When Hermes is absent or fails, falls back to `fetchWebLegacy()` (cheerio CSS selectors).

`USE_HERMES` env var can force enable/disable.

### Scoring logic

5 dimensions each scored 1-10: importance, articleQuality, timeliness, uniqueness, usefulness.
- `totalScore >= 25` → `isSelected: true`
- `finalScore = totalScore * 0.6 + (sourceWeight / 100) * 20`
- Cross-source dedup via Chinese bigram Jaccard similarity (threshold 0.4, 7-day window)
- Lower-scored duplicate articles become `relatedItems` of the higher-scored one

### MiniMax `<think>` tag handling

MiniMax-M2.7 is a reasoning model that wraps responses in `<think>...</think>`. The `callAI()` function strips these before JSON parsing.

## Scheduling

**Primary**: macOS launchd runs `scripts/run-fetch.sh` every 30 minutes on the local Mac mini.

```bash
# View job status
launchctl list com.gamehot.fetch

# Stop / restart
launchctl unload ~/Library/LaunchAgents/com.gamehot.fetch.plist
launchctl load ~/Library/LaunchAgents/com.gamehot.fetch.plist

# Logs
tail -f data/fetch-launchd.log
tail -f data/fetch.log
```

The shell script (`scripts/run-fetch.sh`):
1. Pulls latest from GitHub
2. Runs `npm run fetch`
3. If `data/items.json` changed, commits and pushes

**Backup**: GitHub Actions `workflow_dispatch` (manual trigger only, no schedule). Uses cheerio mode since Hermes isn't available on CI runners.

## Data model

- `data/sources.json` — 5 web sources with CSS selectors for cheerio fallback
- `data/items.json` — All articles. Key fields: `isSelected` (curated), `score.totalScore`, `score.finalScore`, `score.relatedItems[]`
- Types defined in `src/lib/types.ts`

## Adding a new source

1. Add entry to `data/sources.json` with CSS selectors (`listSelector`, `titleSelector`, `linkSelector`, etc.) — these serve as Hermes fallback
2. Hermes browser mode handles new sources automatically without selector tuning
3. Run `npm run fetch` to test
