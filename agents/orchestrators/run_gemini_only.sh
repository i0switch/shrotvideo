#!/usr/bin/env bash
set -euo pipefail

GEMINI_CMD="${GEMINI_CMD:-gemini}"
# ノイズ低減のため -d は外し、チェックポイントは有効化
GEMINI_FLAGS="${GEMINI_FLAGS:--y -c -m gemini-2.5-flash}"
# テレメトリ出力を捨てる（対応フラグ。未対応なら無視される）
TELEM_FLAGS="${TELEM_FLAGS:---telemetry-outfile /dev/null}"

mkdir -p agents/mailbox

# 相対ディレクトリのみを読む（Windows パス問題回避）
inc="agents"; [ -d src ] && inc="$inc,src"; [ -d electron ] && inc="$inc,electron"; [ -d tests ] && inc="$inc,tests"

log(){ printf "[gemini-only] %s\n" "$*"; }

run_planner() {
  log "Planner start"
  "$GEMINI_CMD" $GEMINI_FLAGS $TELEM_FLAGS --include-directories "$inc" -p $'
【日本語のみ】以下を「厳密に」実行：
1) リポジトリを要約し、最優先の改善タスクを3件だけ箇条書き化。
2) その結果を agents/mailbox/planner_to_builder.md に「追記」する。既存なら追記、新規なら作成。
   ※ ツール選択ポリシー：
     - 既存ファイルへは replace / write_file を使わず、run_shell_command で Node を使って追記:
       node -e "const fs=require(\"fs\");const p=\"agents/mailbox/planner_to_builder.md\";fs.mkdirSync(\"agents/mailbox\",{recursive:true});const s=process.argv.slice(1).join(\" \");fs.appendFileSync(p,s,{encoding:\"utf8\"});" "### $(date +%F) 計画\\n- タスク1\\n- タスク2\\n- タスク3\\n\\n"
     - 新規作成が必要な場合のみ write_file を許可。
3) 以降は承認を求めず自律実行（チェックポイント有効）。'
}

run_builder() {
  log "Builder start"
  "$GEMINI_CMD" $GEMINI_FLAGS $TELEM_FLAGS --include-directories "$inc" -p $'
【日本語のみ】以下を「厳密に」実行：
1) agents/mailbox/planner_to_builder.md の最新指示を実装。必要に応じてテストを実行。
2) テスト出力ダイジェストは run_shell_command で Node 追記（replace は使わない）:
   node -e "const fs=require(\"fs\");fs.appendFileSync(\"agents/mailbox/test_results.md\",\"\\n## 実行結果\\n\"+process.argv.slice(1).join(\" \")+\"\\n\",{encoding:\"utf8\"});" "テストログの要約をここに入れる"
3) 成功時は status.json を Node で原子的に更新（新規or上書き）:
   node -e "const fs=require(\"fs\");const p=\"agents/mailbox/status.json\";let o={};try{o=JSON.parse(fs.readFileSync(p,\"utf8\"))}catch{};o.turn=(o.turn||0)+1;o.done=true;fs.writeFileSync(p,JSON.stringify(o),\"utf8\");"
4) 失敗時は原因と次アクションを agents/mailbox/builder_to_planner.md に Node 追記。'
}

log "which gemini: $(command -v "$GEMINI_CMD" || echo not-found)"
log "GEMINI_FLAGS=$GEMINI_FLAGS"
log "include-directories=$inc"

echo "===== TURN 1: Planner ====="; run_planner || true
echo "===== TURN 1: Builder ====="; run_builder || true