Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0) ディレクトリ確保
New-Item -ItemType Directory -Force -Path agents, agents\mailbox, agents\prompts, agents\orchestrators | Out-Null

# 1) GEMINI.md を取り込み（リポ直下にある想定。無ければスキップ）
if (Test-Path -Path ".\GEMINI.md") {
  Copy-Item -Path ".\GEMINI.md" -Destination "agents\GEMINI.md" -Force
  Write-Host "✔ Copied GEMINI.md -> agents\GEMINI.md"
} else {
  if (-not (Test-Path "agents\GEMINI.md")) {
    # 無ければプレースホルダだけ作成（後で手動で差し替え可能）
    @"
# GEMINI Autonomy Policy (placeholder)
ここにリポ直下の GEMINI.md をコピーしてください。自律実行ポリシー、改善タスク、最終検証、実行シナリオを含みます。
"@ | Set-Content -Encoding UTF8 "agents\GEMINI.md"
    Write-Host "⚠ GEMINI.md が見つかりませんでした。agents\GEMINI.md をプレースホルダで作成。"
  }
}

# 2) run_dual.sh を上書き：両エージェントが agents/GEMINI.md も必ず読む
@'
#!/usr/bin/env bash
set -euo pipefail

CODEX_CMD="${CODEX_CMD:-codex}"
GEMINI_CMD="${GEMINI_CMD:-gemini}"
# 既定で --yolo --checkpointing
GEMINI_ARGS="${GEMINI_ARGS:---yolo --checkpointing}"
MAX_TURNS="${MAX_TURNS:-10}"

run_codex() {
  $CODEX_CMD exec \
    --ask-for-approval never \
    --sandbox workspace-write \
    <<'PROMPT'
Read the entire workspace and:
- agents/AGENTS.md (dual-agent rules)
- agents/GEMINI.md (autonomy policy & improvement tasks)
Follow the rules as Builder using agents/prompts/codex_builder.md.
Obey autonomy policy from agents/GEMINI.md. Work autonomously. Do not ask for approval.
PROMPT
}

run_gemini() {
  $GEMINI_CMD $GEMINI_ARGS <<'PROMPT'
Read the entire workspace and:
- agents/AGENTS.md (dual-agent rules)
- agents/GEMINI.md (autonomy policy & improvement tasks)
Follow the rules as Planner/Reviewer using agents/prompts/gemini_planner.md.
Obey autonomy policy from agents/GEMINI.md. Work autonomously. Do not ask for approval.
PROMPT
}

turn=1
while [[ $turn -le $MAX_TURNS ]]; do
  echo "===== TURN $turn: Gemini (Planner) ====="
  run_gemini || true

  echo "===== TURN $turn: Codex (Builder) ====="
  run_codex || true

  if grep -q '"'"'"done"'"'"'[[:space:]]*:[[:space:]]*true' agents/mailbox/status.json 2>/dev/null; then
    echo "All done by agents 🎉"
    exit 0
  fi
  turn=$((turn+1))
done

echo "Reached MAX_TURNS=$MAX_TURNS without done=true. Check agents/mailbox/* for context."
exit 1
'@ | Set-Content -Encoding UTF8 "agents\orchestrators\run_dual.sh"

# 実行権限（Git Bash/WSL）
try { bash -lc "chmod +x agents/orchestrators/run_dual.sh" } catch {}

# 3) プロンプトに GEMINI.md 準拠を明記（先頭に追記、重複回避）
function Prepend-LineIfMissing {
  param([string]$Path, [string]$Line)
  $exists = Test-Path $Path
  if (-not $exists) { return }
  $raw = Get-Content -Raw -Encoding UTF8 $Path
  if ($raw -notmatch [regex]::Escape($Line)) {
    ($Line + "`r`n`r`n" + $raw) | Set-Content -Encoding UTF8 $Path
    Write-Host "✔ Updated $Path"
  } else {
    Write-Host "• Skipped (already mentions GEMINI.md): $Path"
  }
}

$codexNote  = "※必ず agents/GEMINI.md（自律実行ポリシー／改善タスク）に従って実装・テストを行うこと。"
$planNote   = "※必ず agents/GEMINI.md（自律実行ポリシー／改善タスク）に従って計画・レビューを行うこと。"

Prepend-LineIfMissing -Path "agents\prompts\codex_builder.md"    -Line $codexNote
Prepend-LineIfMissing -Path "agents\prompts\gemini_planner.md"   -Line $planNote

# 4) AGENTS.md に参照追記（末尾に一度だけ）
$agentsPath = "agents\AGENTS.md"
if (Test-Path $agentsPath) {
  $appendTag = "<!-- GEMINI.md linked -->"
  $ag = Get-Content -Raw -Encoding UTF8 $agentsPath
  if ($ag -notmatch [regex]::Escape($appendTag)) {
    @"
$appendTag

## 付記
このプロジェクトの自律動作／改善タスクは **agents/GEMINI.md** に定義されています。両エージェント（Builder/Planner）はこれに従って意思決定し、テスト失敗時の自動再試行・スナップショット復元・バックオフリトライなどを実施します。
"@ | Add-Content -Encoding UTF8 $agentsPath
    Write-Host "✔ Linked agents/GEMINI.md from AGENTS.md"
  } else {
    Write-Host "• AGENTS.md already links GEMINI.md"
  }
}

Write-Host "✅ Patch complete. Agents will now read agents/GEMINI.md on every turn."
