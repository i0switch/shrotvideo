# CaptureApp

CaptureApp は Electron + Playwright + FFmpeg を組み合わせ、指定した X (旧 Twitter) アカウントの最新ポストを自動で処理し、要件に応じてスクリーンショットや動画合成を行うデスクトップアプリです。

## 主な機能

- GUI から対象アカウント ( @handle ) と取得件数を指定
- Playwright (Chrome チャネル) を用いてログインセッションを維持しつつ最新ポストを取得
- 単一動画付きポストの場合はスクリーンショットと動画を合成し、疑似キャプチャ動画を生成
- 画像・テキストポストの場合は指定範囲のスクリーンショットのみを出力
- 処理ごとに `outputs/{runId}/{tweetId}/` 以下へ成果物 (screenshot.png, video.mp4, composited.mp4, meta.json) を保存
- ログは `logs/` 配下にカテゴリ別で保存
- `tests/e2e` に Playwright テストを収録し、自動検証を実行

## 推奨環境

- Windows 10/11 または macOS 13+
- Node.js 18+ (Playwright, Electron の推奨バージョンに準拠)
- Google Chrome Stable がインストール済みであること

## セットアップ

```powershell
# 依存のインストール
npm install

# Playwright 依存 (Chrome) のセットアップ
npm run playwright:install
```

## 開発サーバの起動

```powershell
npm run dev
```

- メイン/プリロード: TypeScript ウォッチ + `tsc-alias` により dist へ即時トランスパイル
- レンダラ: Vite + React 開発サーバ (ポート 5173)
- Electron が自動起動し、GUI から設定・実行が可能

## 本番ビルド & パッケージング

```powershell
npm run build

# オプション: Electron パッケージ生成 (Win/.exe, macOS/.dmg/.zip)
npm run package
```

- `npm run build` で `dist/` 配下に main / preload / renderer の成果物を生成します。
- `npm run package` で electron-builder が `release/` に配布物を作成します。

## 自動テスト

```powershell
# 型チェック (全ターゲット)
npm run typecheck

# Playwright E2E テスト
npm run playwright:test

# 最終検収用シナリオのみ実行
npx playwright test tests/e2e/final.spec.ts
```

Playwright テストはヘッドレス/ヘッデッド両方に対応し、`storageState.json` の有無でログイン状態をスイッチできます。`tests/e2e/final.spec.ts` は最終成果物の構造と FFmpeg メタを検証します。

## 実行スクリプト例

```powershell
# 初回はGUIログイン（selectorは省略可。x.txtがあれば自動読込）
npm run final -- --handle kandounekodouga --count 1 --headless false

# ログイン完了後に10件をヘッドレスで処理
npm run final -- --handle kandounekodouga --count 10 --headless true --out outputs/final_run_$(Get-Date -Format yyyyMMdd)
```

`scripts/runFinal.js` はストレージ状態を確認し、未ログイン時は GUI ログインを促します。実行完了後、`run_meta.json` と `_reports/test-report.*` を生成し、10 件の成否とリトライ回数を集計します。

### 初回ログイン手順

1. `storageState.json` に `auth_token`/`ct0` が含まれていない場合、`npm run final` はエラーになります。
2. 初回のみヘッデッドモードで実行し、GUI ウィンドウで X にサインインしてください。

```powershell
npm run final -- --handle <対象ハンドル> --count 1 --selector (Get-Content X.txt) --headless false
```

- ログイン完了後、自動で `storageState.json` にセッションが保存されます。
- 以降は `--headless true` でバッチ実行しても認証済みセッションが利用されます。

## フォールバック戦略

- 動画 URL が検出できない場合: 自動再生→クリック→ミュート→待機延長→ネットワーク監視強化→最終手段で画面キャプチャ
- コーデックエラー: Chrome Stable 強制使用、Chromium 利用時は `chromium-codecs-ffmpeg-extra` を導入
- GPU 問題: `--use-gl=swiftshader|egl` などの起動オプション切替

## 注意事項

- X 上のコンテンツをダウンロード・加工する際は、対象の利用規約と著作権法を遵守してください。
- 自身のアカウントや権利許諾済み素材のみを対象にしてください。
- 必要に応じてウォーターマークや社内限定モードを提供可能です。
