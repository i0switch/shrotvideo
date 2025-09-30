---
applyTo: '**'
---
# AGENTS.md — GPT-5 Codex 自律エージェント 指示書（最新版）

> 目的：**GUI アプリ**を自動生成し、指定した X（旧 Twitter）アカウントの最新ポスト群を処理して、要件に従いスクリーンショット／動画合成（1動画ポスト時）を行う。以降の全工程（設計→実装→テスト→パッケージング）を**完全自律**で遂行せよ。

---

## 0) 実行モード & 原則

* **完全自律（YOLO）**：明示の停止指示があるまで、設計・実装・試験・修正・配布物生成まで連続実行。
* **段階報告**：主要フェーズ完了ごとに要約ログを残す（人手承認は不要）。
* **可観測性**：ログは `logs/` に保存（build/e2e/compose/download の各カテゴリ別）。失敗は必ず再試行戦略付きで記録。
* **自動復旧**：3 段階リトライ → 代替手段（Chrome Stable 起動/Codec 切替/Selector 代替/Headed 切替）→ 継続。

---

## 1) 要件（ハイレベル仕様）

### 1.1 対象プラットフォーム

* **OS**：Windows 10/11、macOS 13+
* **配布**：Electron ベース単体アプリ（自動アップデート任意）

### 1.2 入力

* **対象 X アカウント**（@handle）と**取得件数**（最新 N）
* **スクリーンショット対象範囲**：`X.txt` に記載の XPath/セレクタ（初期値は `/html/body/div[1]/div/div/div[2]/main/div/div/div/div/div/section/div/div/div[1]/div/div/article`）
* **ログイン**：ユーザーが 1 回 GUI 上でログイン → セッション永続化（Playwright `storageState`）

### 1.3 出力（ケース別）

* **① 単一動画付きポスト**

  1. 指定範囲のスクショ取得
  2. ポスト動画をダウンロード
  3. **スクショの「動画領域」に動画をはめ込み合成** → まるで範囲を動画キャプチャしたかのような出力動画（mp4, h264/aac）
* **② 複数動画 or 画像付き or テキストのみ**

  * 指定範囲のスクショ（PNG）を保存

### 1.4 X スクレイピング（「メディアを再生できません」回避）

* **A. コーデック不足（最頻出）**

  * 既定：**Chrome Stable** を使用（Playwright `channel: 'chrome'`）
  * Chromium を使う場合（非推奨）：

    * Debian/Ubuntu: `apt-get install chromium-codecs-ffmpeg-extra`
    * もしくは `libffmpeg.so` をプロプライエタリ版に差替（自己責任）
* **B. オートプレイ規制**

  * 起動オプション：`--autoplay-policy=no-user-gesture-required`
  * 実行スクリプト：

    ```js
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.muted = true; v.play().catch(console.warn); }
    });
    ```
* **E. GPU/レンダラ関連**

  * 必要時のみ：`--use-gl=swiftshader` または `--use-gl=egl`、`--ignore-gpu-blocklist`
  * GPU なしサーバでも**デコードはソフトで概ね可**

> これらの運用上メモは**必ず**起動・DL・再生試行ごとに条件付きで適用し、自動切替可能にする。

---

## 2) 完成定義（DoD）

* GUI アプリで以下が**再現**できる：

  * 対象アカウントの最新 N 件のポスト URL 取得
  * 各ポストにログイン状態で遷移
  * **①単一動画**：スクショ＋動画 DL＋はめ込み合成動画の出力（mp4）
  * **②その他**：範囲スクショ（PNG）の出力
* 出力先：`outputs/{date}/{postId}/`

  * `screenshot.png`、`video.mp4`（単一動画時は `composited.mp4`）
  * `meta.json`（URL、種別、座標、DL 元、処理ログ要約）
* **自動テスト**：E2E（storageState あり/なし、headed/headless、動画/非動画の分岐）
* **ビルド成果**：Win（.exe）/macOS（.dmg or .zip）
* **ドキュメント**：`README.md`（使い方、回避策、注意）

---

## 3) 推奨スタック

* **GUI**：Electron + React（Vite）
* **自動操作**：Playwright（`channel: 'chrome'`）
* **メディア処理**：FFmpeg（同梱 or 動的 DL）
* **動画取得**：Network 監視で `video.twimg.com` / `.m3u8` / `.mp4` を捕捉（最優先）
* **画像/座標**：`getBoundingClientRect()` → スクショ座標変換
* **設定**：Zod バリデーション／electron-builder パッケージング

---

## 4) ディレクトリ構成（概要）

```
app/
  main/                # Electron Main（起動・IPC）
  renderer/            # React UI（設定・ログ・プレビュー）
  core/
    x/login.ts         # ログイン・storageState 永続
    x/fetchPosts.ts    # 最新ポストURL取得
    x/openPost.ts      # ページ遷移、要素待機
    x/mediaProbe.ts    # video検出、src/m3u8抽出、再生
    x/screenshot.ts    # 指定範囲スクショ
    x/download.ts      # 動画URL抽出→FFmpeg DL
    x/compose.ts       # スクショへ動画オーバーレイ
    x/classify.ts      # 単一動画/複数動画/画像/テキスト判定
    x/runner.ts        # 全体オーケストレーション
  tests/e2e/
  scripts/
  outputs/
  logs/
```

---

## 5) キーロジック要点（抜粋）

* 範囲スクショ（XPath/Selector 両対応）→ `boundingBox()` を `clip` に指定
* 動画領域の特定：`document.querySelector('video')` の `getBoundingClientRect()` をスクショ座標へ正規化
* ネットワークフックで動画 URL 候補を収集・優先度選定（拡張子、ビットレート）
* FFmpeg 合成：`overlay=x:y`、静止画+動画、音声は動画側を採用

---

## 6) GUI 仕様

* **設定**：ログイン（WebView）/ @handle / 取得件数 / 範囲セレクタ（`X.txt` 既定）/ 出力先 / 並列数 / headed 切替 / Chrome 強制
* **進捗**：キュー・進捗バー・失敗再試行回数・直近ログ
* **プレビュー**：`screenshot.png`、`composited.mp4`

---

## 7) 実装タスク（自律実行チェックリスト）

1. 雛形作成・依存導入（Playwright/FFmpeg/electron-builder）
2. 起動器：`channel:'chrome'`、`--autoplay-policy=no-user-gesture-required`、`--ignore-gpu-blocklist`（必要に応じ `--use-gl=swiftshader|egl`）
3. ログインフロー：`https://x.com/login`、2FA 対応、`storageState.json` 保存
4. 最新ポスト URL 取得：プロフィールから `article a[href*="/status/"]` を N 件抽出
5. 分類：単一動画/複数動画/画像/テキスト
6. 単一動画パス：範囲スクショ → 動画 URL 抽出 → mp4 保存 → 座標算出 → 合成
7. 上記以外：範囲スクショのみ
8. 堅牢化：セレクタ・リトライ・headed 切替・Chrome 不在時の案内/自動導入
9. E2E：storageState 有無・分岐網羅
10. パッケージング：win/mac

---

## 8) 設定例

`.env`

```
APP_OUTPUT_DIR=./outputs
APP_PARALLEL=2
APP_HEADLESS=true
APP_BROWSER=chrome
APP_REGION_SELECTOR=/html/body/div[1]/div/div/div[2]/main/div/div/div/div/div/section/div/div/div[1]/div/div/article
```

`config/app.json`

```json
{
  "screenshot": { "type": "png" },
  "video": { "codec": "h264", "audio": "aac" },
  "timeouts": { "nav": 30000, "waitVideo": 20000 }
}
```

---

## 9) スクリプト例

* m3u8→mp4：`ffmpeg -y -i <m3u8> -c:v libx264 -c:a aac -bsf:a aac_adtstoasc video.mp4`

---

## 10) フォールバック戦略

* **動画 URL 不明**：自動再生→クリック再生→ミュート→待機延長→`response`/`performance` 監視強化→最終手段として画面キャプチャ
* **範囲セレクタ不一致**：近傍探索（`article:has(video)` 等）→ 全画面スクショ＋ログ
* **Codec エラー**：Chrome Stable 強制、Chromium は codecs 追加
* **GPU 由来問題**：`--use-gl=swiftshader|egl`

---

## 11) テスト計画

* **ユニット**：領域変換、URL 選定、メタ生成
* **E2E**：

  * ログイン新規／流用
  * 単一動画→合成の最短経路
  * 画像ポスト→スクショのみ
  * autoplay 規制回避（ミュート再生）
  * headed/headless、ブラウザ切替
* **回帰**：DOM 変化検知でセレクタ健全性を日次チェック（任意）

---

## 12) 法的・倫理的注意

* ダウンロード・加工はプラットフォーム規約と著作権法を順守。
* 自身のコンテンツ/権利許諾済み素材を対象とすること。
* 必要に応じウォーターマーク/社内限定モードを提供。

---

## 13) 受け入れ基準（Acceptance Criteria）

1. 対象アカウントから**最新 N 件**の URL を取得できること
2. ログイン状態で各 URL に遷移できること
3. **① 単一動画**：スクショ＋DL＋合成で `composited.mp4` が生成されること
4. **② 複数動画/画像/テキスト**：`screenshot.png` が生成されること
5. 失敗時の**自動リトライ**＆代替策が作動し、`meta.json` とログに成否が明示されること
6. Win/mac の配布物が動作し、GUI から全工程が実行可能

---

## 14) 初回自動フロー（最短）

1. 雛形作成 → 依存導入 → Playwright（Chrome）セットアップ
2. GUI ログイン → `storageState.json` 保存
3. N=3 でスモーク → 分岐処理と生成物確認
4. E2E（headed/headless）→ ビルド出力

---

## 15) **最終成果物・検収項目（@kandounekodouga｜最新10件）**

**対象**：[https://x.com/kandounekodouga](https://x.com/kandounekodouga)

**要件**：

* **最新 10 件**のポストを**すべて**処理すること（動画・画像・テキストを含む、**合計 10 件**）。
* 各ポストに対し、仕様どおり：

  * **単一動画付き**：指定範囲スクショ、動画ダウンロード、**スクショ内の動画領域にオーバーレイ合成**（`composited.mp4`）。
  * **複数動画/画像/テキスト**：指定範囲スクショ（`screenshot.png`）。
* **「メディアを再生できません」**等の失敗を自動回避（Chrome Stable、autoplay 設定、GL 切替、Codec 対策）して**10/10**件の成果を出力。

**検収ディレクトリ構成（例）**：

```
outputs/final_run_YYYYMMDD/
  run_meta.json                   # 実行全体メタ（対象アカウント、投稿ID一覧、成功/失敗数、環境）
  _reports/
    test-report.json             # 自動テスト結果（下記に定義）
    test-report.html             # ヒューマンリーダブル
  <postId1>/
    screenshot.png
    video.mp4?                   # 単一動画のみ
    composited.mp4?              # 単一動画のみ
    meta.json
  ...（10件ぶん）
```

**自動検証（担保）**：`tests/e2e/final.spec.ts`

* ステップ：

  1. 対象アカウント `@kandounekodouga`、N=10 を設定
  2. URL 収集 → **10 件**であることを検証（重複なし）
  3. 各 URL の分類結果を `meta.json.type`（`single_video`/`multi_video|image|text`）で確認
  4. `single_video`：`screenshot.png`、`video.(mp4|m3u8→mp4)`、`composited.mp4` の存在と FFmpeg でのストリーム整合性（h264/aac）を検証
  5. `image|text`：`screenshot.png` の存在と PNG バリデーション
  6. すべての `meta.json` に overlay 座標（`x,y,w,h`）がある場合は値範囲（>0, 画面内）を検証
  7. 実行合計が **10/10 成功**であることを `run_meta.json` にて検証
* 生成：`_reports/test-report.json|html`（成功数、失敗詳細、リトライ回数、環境）

**合格判定**：

* `run_meta.json.total==10` かつ `run_meta.json.success==10`
* `test-report.json` の critical 失敗が 0
* サンプル抜き取り（2〜3件）で視認上も**仕様どおりのはめ込み合成**が確認できること

**再現性**：

* 実行コマンド例：

  ```bash
  APP_BROWSER=chrome APP_HEADLESS=false APP_PARALLEL=2 \
  node scripts/runFinal.js --handle kandounekodouga --count 10 \
    --selector "$(cat X.txt)" --out outputs/final_run_$(date +%Y%m%d)
  ```
* `scripts/runFinal.js` は、実行前に `storageState.json` 存在チェック→なければ GUI ログインフロー起動。

---

## 16) リスクと緩和

* DOM 変更：セレクタの多重フォールバックと日次回帰テスト
* 取得制限/レート：インターバル制御、指数バックオフ
* 地域/言語差分：`Accept-Language` と UI ラベル非依存のセレクタ優先

---

## 17) 提出物一覧（一式）

1. アプリ配布物（Win/mac）
2. `outputs/final_run_YYYYMMDD/` 一式（10件）
3. `_reports/test-report.json|html`、`run_meta.json`
4. `README.md`（セットアップ、既知の回避策、トラブルシュート）

---

以上の指示に従い、**GPT-5 Codex** は本アプリを**完全自律**で実装・検証・パッケージ化し、@kandounekodouga の**最新10件**を処理した成果とテスト担保を提出せよ。
