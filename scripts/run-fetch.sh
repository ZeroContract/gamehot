#!/bin/bash
# GameHot 本地定时抓取脚本
# 由 launchd 每 30 分钟调用，抓取 → 评分 → 自动 push 到 GitHub

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOCKFILE="/tmp/gamehot-fetch.lock"
LOGFILE="$PROJECT_DIR/data/fetch.log"

# 防止并发跑
if [ -f "$LOCKFILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 上一轮还在跑，跳过" >> "$LOGFILE"
  exit 0
fi
touch "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

cd "$PROJECT_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始抓取..." >> "$LOGFILE"

# 确保在 main 分支
git checkout main --quiet 2>/dev/null || true

# 拉取最新远程数据（避免冲突）
git pull --rebase origin main --quiet 2>>"$LOGFILE" || true

# 加载 API key（优先环境变量，其次 .env.local 文件）
if [ -z "$DEEPSEEK_API_KEY" ] && [ -f "$PROJECT_DIR/.env.local" ]; then
  export "$(grep -v '^#' "$PROJECT_DIR/.env.local" | grep DEEPSEEK_API_KEY | head -1)"
fi

if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ DEEPSEEK_API_KEY 未设置" >> "$LOGFILE"
  exit 1
fi

npx tsx scripts/fetch.ts 2>&1 | tee -a "$LOGFILE"

# 有变更才提交
if ! git diff --quiet data/items.json; then
  git add data/items.json
  git commit -m "🤖 自动抓取游戏新闻 $(date +'%Y-%m-%d %H:%M')"
  git pull --rebase origin main --quiet 2>>"$LOGFILE" || true
  git push origin main 2>>"$LOGFILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 已推送新数据" >> "$LOGFILE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 无新内容" >> "$LOGFILE"
fi
