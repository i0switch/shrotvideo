#!/usr/bin/env bash
set -euo pipefail

CODEX_CMD="${CODEX_CMD:-codex}"
GEMINI_CMD="${GEMINI_CMD:-gemini}"

# Codex: 非対話・承認なし・WS書込OK（公式推奨）
CODEX_FLAGS="${CODEX_FLAGS:---ask-for-approval never --sandbox workspace-write}"
# Gemini: Flash固定・YOLO・デバッグ（重い読込を避ける）
GEMINI_FLAGS="${GEMINI_FLAGS:--y -d -m gemini-2.5-flash}"
MAX_TURNS="${MAX_TURNS:-2}"

log(){ printf "[orchestrator] %s\n" "$*"; }

run_gemini() {
  log "Gemini start"
  # まずは超軽量ヘルスチェック：相対 'agents' のみ（存在しなければ '.'）
  local inc="agents"; [ -d "$inc" ] || inc="."
  set +e
  out="$("$GEMINI_CMD" $GEMINI_FLAGS --include-directories "$inc" -p "日本語で「準備完了」とだけ出力してすぐ終了して" 2>&1)"
  rc=$?; set -e
  echo "$out"; log "Gemini exit code: $rc"
}

run_codex() {
  log "Codex start"
  if "$CODEX_CMD" --help 2>&1 | grep -q "exec"; then
    "$CODEX_CMD" $CODEX_FLAGS exec "【日本語のみ】このリポジトリを読み、agents/prompts/codex_builder.md の方針で作業を進める。必要なら npm ci（--no-audit --no-fund）とテストを実行し、結果を agents/mailbox/test_results.md に追記。"
  else
    "$CODEX_CMD" $CODEX_FLAGS "【日本語のみ】このリポジトリを読み、agents/prompts/codex_builder.md の方針で作業を進める。必要なら npm ci（--no-audit --no-fund）とテストを実行し、結果を agents/mailbox/test_results.md に追記。"
  fi
  log "Codex done"
}

preflight() {
  log "which gemini: $(command -v "$GEMINI_CMD" || echo 'not found')"
  log "which codex : $(command -v "$CODEX_CMD"   || echo 'not found')"
  log "GEMINI_FLAGS=$GEMINI_FLAGS"
  log "CODEX_FLAGS=$CODEX_FLAGS"
}

preflight
echo "===== TURN 1: Gemini (Planner) ====="; run_gemini || true
echo "===== TURN 1: Codex (Builder) ====="; run_codex || true