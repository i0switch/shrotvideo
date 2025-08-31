# GEMINI.md — X（Twitter）指定アカウントの最新ポストをスクショ保存するアプリ

> **目的**: 生成AI（Gemini）に、指定した X アカウントの最新ポスト *N* 件を、ログイン必須の状態でも安定取得し、要素単位（`<article role="article">`）で**同一レイアウトのスクリーンショット**として保存する CLI アプリと自動テスト一式を**完全実装**させるための指令書。

---

## TL;DR（要約）

* **要件**: `@handle` を受け取り、最新 *N* 件のポストを**記事要素単位でキャプチャ** → `out/screenshots/@handle/` に保存。
* **ログイン**: Cookie（`storageState`）を**自動保存/再利用**。未保存時は**ブラウザを立ち上げてユーザにログインさせ、保存**。
* **最終合格条件（DoD）**: 指定アカウントの**ポスト5件**が正常に撮れており、**提供された参照画像（サンプル）と同一レイアウト**であること（後述の画質・サイズ・余白・テーマを固定し、**画像ハッシュ/SSIM 検証**で合格）。
* **実装**: TypeScript + Node.js + Playwright（Chromium）。
* **テスト**: Playwright Test + 画像類似度（pHash または SSIM≥0.98）。

---

## 1. 成果物

生成AIは**動くリポジトリ**を丸ごと出力する。

```
project-root/
  package.json
  pnpm-lock.yaml | package-lock.json
  playwright.config.ts
  src/
    cli.ts                 # CLI エントリ
    grab.ts                # 取得ロジック（記事要素の検出/撮影）
    login.ts               # ログイン・Cookie保存/再利用
    utils/
      fs.ts, time.ts, image.ts
  tests/
    e2e.grab.spec.ts       # E2E: 5件撮影できること
    image-assert.spec.ts   # 参照画像と一致（pHash/SSIM）
  fixtures/
    expected/
      sample_ref.png       # 参照（ユーザ提供スクショをここに配置する想定）
  out/
    screenshots/           # 実行時に生成
  README.md
```

> **重要**: コードは\*\*そのままコピペ→`pnpm i && pnpm test && pnpm start`\*\*で動くこと（依存/型/設定を一切省略しない）。

---

## 2. 実装要件（機能）

### 2.1 CLI

* コマンド: `grab`

  * 例: `pnpm grab -u brain_oki -n 5 -o out/screenshots`
  * 引数:

    * `-u, --user` ・・・ `@`を含んでも可（正規化して `brain_oki` へ）
    * `-n, --count` ・・・ 取得件数（デフォルト: 5）
    * `-o, --outDir` ・・・ 保存先ディレクトリ
    * `--headful` ・・・ ユーザ操作を伴う可視ブラウザで実行
    * `--lang` ・・・ `ja-JP` を既定（参照画像が日本語UIのため）。
* コマンド: `login`

  * Cookie未保存・期限切れ時に**ヘッドフルで**`https://x.com/i/flow/login` を開き、ユーザ操作でログイン→`storageState` を `./.auth/x.storage.json` に保存。
* 失敗時は意味のあるエラーコード/メッセージを出すこと。

### 2.2 ログイン & Cookie 保存

* Playwright の `storageState` 機能を使用。
* **存在チェック** → **期限切れ/ログアウト検知**（ログイン画面 or 401/403）→ **再ログイン**。
* 2FA が有効な場合でも、人手操作で完了できるよう**待機ロジック**を実装（最大待機時間・タイムアウト明記）。

### 2.3 取得ロジック（スクショ）

* 画面遷移: `https://x.com/<user>` に移動。
* **環境固定**（参照画像と一致させるため）

  * **テーマ**: ライト固定
  * **言語**: `ja-JP` 固定（`acceptLanguage`/`navigator.language`）
  * **UA/ビューポート**: `1280x800`, deviceScaleFactor=1（DPR=1）
  * **アニメーション無効**: `animations: "disabled"` で撮影
  * **ズーム/スケール**: 1.0（CSS zoom を変更しない）
* **記事要素の選択**

  * ロケータ: `page.locator('article[role="article"]')`
  * ヘッダ固定帯/フッタがスクショに入らないよう**要素単位で `locator.screenshot()`** を使用。
* **スクロール**

  * `count` 件が描画されるまで `last().scrollIntoViewIfNeeded()` でインクリメンタルにロード。
* **保存**

  * ファイル名: `YYYYMMDD_HHmmss_<tweetId>_<index>.png`（`tweetId` は `article` 内の `a[href*="/status/"]` から抽出）。

### 2.4 構造的一致検証（サイズ可変対応）

* **ねらい**: ポスト本文量で高さが変わるため、**単純な画像一致やサイズ一致を要求しない**。要素構造とランドマーク領域で正しく撮れているかを検証する。
* **正規化**:

  * ビューポート/幅は固定（例: 1280×800, DPR=1）。
  * テーマ=ライト、言語=ja-JP。
  * スクショは `article[role="article"]` **要素のバウンディングボックス**で撮影（左右の余白はブラウザ依存のズレを避けるため要素単位）。
* **保存アセット**（1ポストあたり）:

  * `screenshotPath`: PNG。
  * `meta.json`: `{ tweetId, text, textHash(SHA-256), hasMedia, mediaTypes[], rects:{header, body, actions} }` を同名で保存。
* **検証アルゴリズム**（高さ可変でもOK）:

  1. **テキスト同一性**: `textHash` を DOM から再取得した本文と比較し一致。
  2. **ランドマークSSIM**: `header`（プロフィール行〜タイムスタンプ周辺）と`actions`（返信/リポスト/いいね列）を **同じ幅にリサイズ**した上で SSIM≥0.98 をそれぞれ満たす。`body`は高さ可変のためスキップまたは参考指標（SSIM≥0.94）。
  3. **メディア有無の一致**: `hasMedia` と `mediaTypes[]`（photo/video/gif）を DOM 判定と一致。
* **実装ノート**:

  * `locator.boundingBox()` で `header/body/actions` の矩形を取得し、`element.screenshot(clip)` で部分切り出し可能。
  * 比較は最小公倍幅にリサイズ後 SSIM を計算（pHash 併用可）。

---

## 3. 非機能要件

* **安定性**: ロケータは**表示テキスト依存を避け、役割/構造ベース**で指定。
* **リトライ**: ネットワーク/描画待ちに対して指数バックオフ。
* **速度**: `count<=10` で 1分以内目安。
* **開発者体験**: `pnpm dev` で headful 実行とログが標準出力に詳述。
* **OS**: Windows / macOS / Linux で動作。

---

## 4. テック選定

* **言語**: TypeScript（strict）
* **自動ブラウザ**: Playwright（Chromium）
* **CLI**: `tsx` + `yargs`（あるいは `commander`）
* **画像**: `sharp`（pHash/SSIM 実装はユーティリティ関数）
* **整形/品質**: ESLint, Prettier, `tsc --noEmit`

---

## 5. 実装タスク（AIへの指示）

1. **プロジェクト雛形**生成（`package.json`, `tsconfig.json`, `playwright.config.ts`）。
2. **`login.ts`**

   * `ensureLogin(contextPath)`：`storageState` の存在/有効性チェック、未ログイン時に `headful` でログイン実施、保存。
3. **`grab.ts`**

   * `grabLatestPosts({ user, count, outDir })`：ページ初期化（テーマ/言語/UA/viewport固定）、対象 `article` 群の検出→スクロール→`locator.screenshot` 保存。
4. **`cli.ts`**

   * `login` と `grab` サブコマンド。エラーハンドリング・終了コード。
5. **画像比較ユーティリティ**（`utils/image.ts`）

   * `compareImages(a,b)`：SSIM と pHash の両方を実装し合否を返す。
6. **テスト**（`tests/`）

   * `e2e.grab.spec.ts`：`login`→`grab -n 5` 実行→ファイル数と命名を検証。
   * `image-assert.spec.ts`：`fixtures/expected/sample_ref.png` と直近撮影の 1 枚を比較し**合格閾値**を満たすこと。
7. **README**

   * 使い方（ログイン→取得→検証）、トラブルシュート、注意事項（Xの規約順守）を記載。

---

## 6. 実行例

```bash
# 依存を入れる
pnpm i

# 1) 初回ログイン（ブラウザが開くのでユーザ操作）
pnpm login

# 2) 取得（例: @brain_oki から 5件）
pnpm grab -u brain_oki -n 5 -o out/screenshots

# 3) テスト（E2E + 画像一致）
pnpm test
```

---

## 7. 重要な安定化ノウハウ

* **記事要素スクショ**: `page.locator('article[role="article"]').nth(i).screenshot({ animations: 'disabled' })` を使い、固定ヘッダを避ける。
* **言語固定**: `newContext({ locale: 'ja-JP', acceptDownloads: true, ... })`、`page.addInitScript(()=>Object.defineProperty(navigator,'language',{value:'ja-JP'}))` などで二重に固定。
* **テーマ固定**: `page.emulateMedia({ colorScheme: 'light' })`。
* **ログイン維持**: `storageState` を読み書き一元化し、失効時は自動的に再ログインフローへフォールバック。
* **遅延描画**: 画像やカウンタがロードされるまで `expect(locator).toBeVisible()` / `toHaveCount(>=N)` を用意。

---

## 8. テスト受け入れ基準（Definition of Done）

* `pnpm test` が**ローカルでグリーン**。
* `pnpm grab -u <user> -n 5` 実行で **5枚**が `out/screenshots/<user>/` に生成され、各スクショに **対応する `meta.json`** が出力されている。
* 各ポストについて：

  * DOM から再収集した本文の `SHA-256` と `meta.json.textHash` が**一致**。
  * `header` および `actions` の **ランドマークSSIM ≥ 0.98**（幅正規化、部分領域比較）。
  * `hasMedia` / `mediaTypes[]` の**一致**。
* 以上を満たせば**高さは可変で合格**（本文量に依存するため）。

---
