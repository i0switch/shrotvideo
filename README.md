<div align="center">

# ShortVideo-Genius 🛠️📹

設定した X / TikTok / YouTube アカウントを監視し、新着コンテンツや RT / Shorts を自動検知 → 取得 → 整形 → ショート動画生成・保存までを一気通貫で行う **デスクトップ自動化 & クリエイティブ補助ツール** です。

</div>

## 目次
1. 概要 / コア機能
2. 主な処理フロー
3. アーキテクチャ概要
4. 機能詳細 (プラットフォーム別)
5. 生成動画の仕様とカスタマイズ
6. 設定 (AppSettings) と保存場所
7. テストラン / 品質計測機能
8. 環境変数一覧
9. インストール & ビルド
10. 実行方法 (Dev / Prod / Packaged)
11. セキュリティ (Cookie / Keytar)
12. ログ & 出力ファイル構成
13. Playwright / yt-dlp / ffmpeg 利用について
14. 今後の拡張候補

---

## 1. 概要 / コア機能

- X(旧Twitter) アカウントの RT / 投稿を監視し:
	- 直接動画がある場合: **direct capture (mp4 取得)**
	- 静止/プレビューのみ: スクリーンショット列を取得し背景動画と合成
- YouTube Shorts / TikTok のチャンネルを監視し、新しい短尺動画をローカルへ保存 (yt-dlp 利用)
- 取得メタ + ユーザー設定に基づき ffmpeg で **縦長ショート動画 (リサイズ / BGM / テロップ)** を生成
- テストラン(擬似一括処理)で処理品質を計測し、統計 & JSON ログを出力

## 2. 主な処理フロー

監視 / テスト実行時:
1. JobManager がプラットフォームごとのアカウント列挙
2. Scraper が最新 N 件 (指定 / テスト値) を列挙
3. 各アイテムを分類: `video_url` or `screenshot`
4. X で mp4 が直接ダウンロード可能 → direct capture → 保存
5. スクショ列の場合: 背景 + レイアウト合成で短尺生成 (ffmpeg)
6. 生成結果 / 失敗 / スキップを structured log (JSONL) + summary に書き出し
7. テストラン終端で: `test-run-<timestamp>.json` とイベント `.events.jsonl` を出力

## 3. アーキテクチャ概要

| レイヤ | 役割 |
|--------|------|
| Electron Main (`electron/*.ts`) | ウィンドウ生成 / IPC / ジョブオーケストレーション / Playwright ブラウザ確保 |
| JobManager | アカウント列挙・重複防止・並列制御(PQueue)・直近統計管理 / テストラン統計 |
| Scraper (`tasks/scraper.ts`) | X / TikTok / YouTube アカウントの最新投稿列挙 & 分類 (strict mp4 連携) |
| Downloader (`tasks/downloader.ts`) | mp4 の一時取得 (yt-dlp, fetch 等) |
| Video Generator (`tasks/video-generator.ts`) | スクショ + 設定 を ffmpeg フィルタにマップし最終 mp4 生成 |
| Structured Logger | JSONL イベント / サマリ / テストラン成果物出力 |
| Renderer (React/Vite) | 設定フォーム / ステータス表示 / 起動トリガ / ダッシュボード |

## 4. 機能詳細 (プラットフォーム別)

### X
- RT/投稿タイムライン監視 (アカウント複数)
- direct capture: 投稿が単一動画 tweet と認識された場合にスクリーンショット省略し mp4 保存
- strict mp4 判定: 誤検出防止 (basename 一致のみ / `.copy.mp4` / legacy suffix 除外)

### YouTube
- チャンネル Shorts タブのみ対象 (`/@<channel>/shorts`)
- playable probe: duration / availability チェック (≤ ~61s)

### TikTok
- チャンネルの最新短尺一覧を取得 (ログイン cookie 任意)

## 5. 生成動画の仕様とカスタマイズ
- 出力解像度 (width / height)
- 背景動画 / 塗りつぶし / スケール (cover / letterbox)
- BGM / 音量 / ループ
- オーバーレイテロップ (上 / 下)
- 取得スクショ枚数のサンプリング / フレームレート

## 6. 設定 (AppSettings) と保存場所
- electron-store に保存: `%APPDATA%/ShortVideo-Genius/config.json` (Windows), `~/Library/Application Support/ShortVideo-Genius/`
- `general.outputPath` : 生成動画 & テストラン成果ファイル出力ベース
- `platforms.{x,tiktok,youtube}`: enabled / intervalMinutes / scrapeDelayMs / accounts[]

## 7. テストラン / 品質計測
- `runTestOnceAll` / `runTestLatestNAll` により最新 N 件を一括再処理 (状態変更なし)
- 統計: `timeouts`, `skips`, `directCaptureAttempts`, `directCaptureSuccesses`, `xVideoUrlItems`
- 品質イベント:
	- `test-run:quality-warning`
	- `test-run:quality-degradation`
- 出力:
	- `<outputPath>/test-run-<timestamp>.json`
	- `<outputPath>/test-run-<timestamp>.events.jsonl`

## 8. 環境変数一覧 (主に自動テスト / 自動実行用)
| 変数 | 意味 |
|------|------|
| RUN_TEST_ON_START=1 | 起動直後にテストラン実行 |
| RUN_TEST_EXIT=1 | テスト終了後アプリ終了 |
| RUN_TEST_N | 取得件数上書き (デフォルト5) |
| RUN_TEST_TIMEOUT_MS | 基本タイムアウト共通値 |
| RUN_TEST_ENUM_TIMEOUT_MS | 列挙フェーズ個別タイムアウト |
| RUN_TEST_PROC_TIMEOUT_MS | アイテム処理フェーズ個別タイムアウト |
| CAPTURE_X_SCREENSHOTS=1 | パッケージ EXE 自動スクリーンショットモード |
| CAPTURE_X_ACCOUNT | 上記モードの対象 X アカウント |
| CAPTURE_X_LIMIT | 取得上限 |
| CAPTURE_OUT_BASE | 出力先ベースパス上書き |
| CAPTURE_EXIT=1 | 処理完了で自動終了 |

## 9. インストール & ビルド
```bash
npm install    # 依存導入 (playwright-core / ffmpeg-static / ytdlp-nodejs など)
npm run build  # React + Electron preload / main ビルド
```
開発モード (renderer + main 同時起動):
```bash
npm start
```

## 10. 実行方法 (Windows パッケージ例)
```bash
npm run dist:win
./release/win-unpacked/ShortVideo-Genius.exe
```
初回起動で Playwright Chromium をユーザーデータディレクトリへ自動インストールします。

### 未署名バイナリの実行 (Windows / macOS)
手順は従来通り (SmartScreen 解除 / Gatekeeper 右クリック「開く」) – 下部 Appendix 参照。

## 11. セキュリティ (Cookie / Keytar)
- ログイン cookie は `keytar` を用いて OS セキュアストアに保存
- 一時 cookie ファイルはスクレイプ時に Netscape 形式で tmp に生成 → 処理後ガベージ
- 構造化ログに秘密情報は出力しない設計 (tweet id / file path / 統計 のみ)

## 12. ログ & 出力ファイル構成 (代表例)
| 種別 | 例 | 説明 |
|------|----|------|
| アプリログ(JSONL) | `logs/app.log.jsonl` | electron-log を JSONL 複製 |
| 構造化イベント | `structured-events.jsonl` | 処理イベントストリーム |
| サマリ | `summary-events.jsonl` | 主要集計抜粋 |
| テストラン | `test-run-*.json` / `*.events.jsonl` | 単回テスト統計 & イベント全量 |
| 生成動画 | `<outputPath>/*.mp4` | 最終ショート動画 |

## 13. Playwright / yt-dlp / ffmpeg
- Playwright: headless Chromium で X ページを描画 → スクショ / 動画 direct capture 補助
- yt-dlp: YouTube Shorts / TikTok 動画メタ & ダウンロード
- ffmpeg (ffmpeg-static): リサイズ / 合成 / オーディオミックス / FPS 変換

## 14. 今後の拡張候補
- キャッシュ / 重複動画ハッシュ検知
- OCR + 自動テロップ生成
- マルチテンプレート (アカウント別プロファイル)
- 動画品質スコアリングと自動再試行

---
### Appendix: 未署名アプリ実行手順 (再掲)
**Windows:** プロパティ > ブロック解除 / SmartScreen で「詳細情報」→「実行」

**macOS:** 右クリック「開く」→ Gatekeeper ダイアログで「開く」 / System Settings > Privacy & Security から許可

### Appendix: Playwright ブラウザ同梱
`PLAYWRIGHT_BROWSERS_PATH` をユーザーデータ配下に設定し同梱 Chromium を強制利用、追加ダウンロード不要で安定性を確保。

---
ライセンスや配布形態は未定義 (Private / Internal)。必要に応じて `LICENSE` を追加してください。