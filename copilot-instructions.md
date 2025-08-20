# COPILOT\_AGENTS.md — ログインとファイル/フォルダ選択の“実装まで自律”ガイド（GitHub Copilot Agent Mode版）

> 目的: 既存の Electron + Node/ffmpeg 前提アプリにおいて、**ログイン方式**と**ファイル/フォルダ選択UI**を GitHub Copilot Agent Mode が**自律的に設計→実装→テスト→修正→ビルド**まで完遂できるようにする。ユーザーの資格情報は**ログイン画面でのみ入力**し、保存はしない。2FA/OTP にも破綻なく対応する。

---

## 0) Agent 原則（Copilot向け 自律動作ポリシー）

* **資格情報はハードコード禁止**：ユーザーが公式ログイン画面で ID/Password/OTP を入力。収集/保存しない。
* **確認ダイアログの最小化**：合理的仮定で前進し、根拠を「意思決定ログ」に残す。
* **ロールバック可能性**：変更前にローカルスナップショット（`git stash -u` または一時ブランチ）。連続失敗 3 回で計画再立案（Plan → Do → Check → Act をログ）。
* **リトライ**：429/403/ネット断等は指数バックオフ（2s→4s→8s→…最大 5 分）。
* **監査可能なログ**：機械可読（JSON Lines）と人間可読（UI/コンソール）の二系統で残す。

> **実行方針**（Agent 自己宣言）: 「必要な前提の確認 → 設計 → 差分実装 → 自動テスト → 修正 → ビルド/配布物作成」の順に、原則ノンストップで進める。

---

## 1) Definition of Done（合格条件）

1. **ログイン**（X/Instagram/TikTok/YouTube のうち最小 1、可能なら複数）

   * アプリの「ログイン」ボタンから**公式ログイン画面**が Electron 小ウィンドウで表示される。
   * ユーザーが **ID/Password/2FA** を入力して認証成功すると、Agent が**自動検知**してセッションを安全保存。
   * 再起動後もセッションが復元され、保護ページへ**未ログインリダイレクトが起きない**。
2. **ファイル/フォルダ選択**

   * 設定画面の各パス入力欄に「**選択…**」ボタンがあり、OS ネイティブダイアログで選択→自動反映。拡張子フィルタ/フォルダ作成/直近記憶に対応。
3. **テストが緑**

   * ログイン機能（モック含む）とダイアログ IPC のユニット/統合/E2E がすべてパス。

---

## 2) 実装設計（ログイン：ユーザー入力・2FA対応・安全保存）

### 2.1 方針

* **公式ログインページを Electron でそのまま表示**：`BrowserWindow`/`BrowserView` に公式 URL をロード。
* **成功検知**：

  * 遷移 URL の**ドメイン/パス**（例：ホーム/プロフィール）をホワイトリストで判定。
  * `session.cookies.get(...)` で**必須 Cookie** が揃ったら成功と見なす（名称は正規表現/包含で頑健化）。
* **セッション保存**：

  * Cookie 群を **keytar**（OS セキュアストア）へ `{ service: APP_NAME, account: PLATFORM, password: JSON.stringify(cookieJar) }` 形式で保存。
  * 保存前に期限/スコープ/セキュア属性を検査し、必要なら正規化。
* **セッション復元**：

  * アプリ起動時/ジョブ開始前に keytar から復元 → `session.defaultSession.cookies.set(...)` で投入。
  * 失効検知時は「ログインが必要」UI（再ログイン導線）を提示。
* **2FA/OTP** は画面でユーザーが直接入力。自動読取はしない。

### 2.2 成功判定ヒント（初期値）

* **X (Twitter)**: `https://x.com/login` → 認証後 `https://x.com/home` 等。Cookie に `auth_token`/`ct0`（名称変更に備えて正規表現）
* **Instagram**: `https://www.instagram.com/accounts/login/` → トップへ遷移。
* **TikTok**: `https://www.tiktok.com/login/phone-or-email/email` → トップへ遷移。
* **YouTube**: `https://accounts.google.com/...` → `https://www.youtube.com/`。Google 系は Cookie が多いので**ドメイン/パス判定を強める**。

> **注意**：DOM 要素 ID のハードコードは避け、**ドメイン合致 + Cookie 存在**の二段階判定を基本にする。

### 2.3 実装タスク（差分）

* [ ] UI：各プラットフォーム用「ログイン」ボタンを設定/ダッシュボードに追加。
* [ ] Main：`createLoginWindow(platform)` 実装（URL・ウィンドウ・リスナー）。
* [ ] 成功検知：`did-navigate`/`did-stop-loading` + Cookie 取得で確定。
* [ ] セッション保存/復元：`keytar` 利用。期限切れ時の再ログイン導線。
* [ ] E2E：Playwright でモックサーバ（/login→/home）を用意しフロー検証。

### 2.4 参考コード（抜粋・TypeScript）

**main/login.ts**

```ts
import { BrowserWindow, session, ipcMain } from 'electron';
import * as keytar from 'keytar';

const APP = 'ShortVideoAssistant';

const LOGIN_URL: Record<string, string> = {
  x: 'https://x.com/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  tiktok: 'https://www.tiktok.com/login/phone-or-email/email',
  youtube: 'https://accounts.google.com/signin/v2/identifier?service=youtube',
};

export async function restoreCookies(platform: string) {
  const raw = await keytar.getPassword(APP, platform);
  if (!raw) return;
  const jar = JSON.parse(raw) as Array<Electron.Cookie>;
  for (const c of jar) {
    try { await session.defaultSession.cookies.set(c); } catch { /* ignore */ }
  }
}

async function captureCookies(platform: string) {
  const cookies = await session.defaultSession.cookies.get({});
  await keytar.setPassword(APP, platform, JSON.stringify(cookies));
}

export function createLoginWindow(platform: keyof typeof LOGIN_URL) {
  const win = new BrowserWindow({ width: 520, height: 720, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.loadURL(LOGIN_URL[platform]);

  const successCheck = async (url: string) => {
    const host = new URL(url).hostname;
    const okDomain = /x\.com|tiktok\.com|instagram\.com|youtube\.com/.test(host);
    if (!okDomain) return;
    const hasAuth = (await session.defaultSession.cookies.get({}))
      .some(c => /auth|ct0|SAPISID|SSID/i.test(c.name));
    if (hasAuth) { await captureCookies(platform); win.close(); }
  };

  win.webContents.on('did-navigate', (_e, url) => successCheck(url));
  win.webContents.on('did-stop-loading', () => successCheck(win.webContents.getURL()));
}

ipcMain.handle('auth.login', async (_e, platform: string) => { createLoginWindow(platform as any); });
```

**preload/auth.ts**

```ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('auth', {
  login: (platform: 'x'|'instagram'|'tiktok'|'youtube') => ipcRenderer.invoke('auth.login', platform),
});
```

**renderer（擬似）**

```ts
loginButton.onclick = () => {
  ui.showHint('ID/パスワード、必要なら 2FA コードを入力してください。成功すると自動で閉じます。');
  window.auth.login('x');
};
```

---

## 3) ファイル/フォルダ選択 UI（OS ネイティブダイアログ）

### 3.1 仕様

* 各パス欄の右に **「選択…」** ボタン。
* **フォルダ選択**：`properties: ['openDirectory','createDirectory']`
* **ファイル選択**：`properties: ['openFile']` + フィルタ（例：`[{ name:'Audio', extensions:['mp3','wav','aac'] }]`）
* 直近パスを `app.getPath('userData')` 配下に永続化→ 次回 `defaultPath` に利用。
* 結果は IPC で Renderer に返し、自動反映。

### 3.2 実装タスク

* [ ] Main：`dialog.showOpenDialog` を呼ぶ IPC ハンドラ。
* [ ] Preload：`contextBridge` で `files.pickFile/ pickFolder` を公開。
* [ ] Renderer：各「選択…」ボタンから呼び出し、フォーム状態へ反映。
* [ ] 型/バリデーション：存在/書込権/拡張子チェック。

### 3.3 参考コード

**main/dialogs.ts**

```ts
import { BrowserWindow, dialog, ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const lastPathFile = path.join(app.getPath('userData'), 'last-path.json');
function loadLastPath() { try { return JSON.parse(fs.readFileSync(lastPathFile,'utf8')); } catch { return {}; } }
function saveLastPath(obj: any) { fs.mkdirSync(path.dirname(lastPathFile), { recursive: true }); fs.writeFileSync(lastPathFile, JSON.stringify(obj)); }

const last = loadLastPath();

ipcMain.handle('files.pickFolder', async (e, key: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'フォルダを選択',
    properties: ['openDirectory','createDirectory'],
    defaultPath: last[key] || undefined,
  });
  if (canceled) return null;
  last[key] = filePaths[0];
  saveLastPath(last);
  return filePaths[0];
});

ipcMain.handle('files.pickFile', async (e, key: string, filters?: Electron.FileFilter[]) => {
  const win = BrowserWindow.fromWebContents(e.sender)!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'ファイルを選択',
    properties: ['openFile'],
    filters,
    defaultPath: last[key] || undefined,
  });
  if (canceled) return null;
  last[key] = filePaths[0];
  saveLastPath(last);
  return filePaths[0];
});
```

**preload/files.ts**

```ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('files', {
  pickFolder: (key: string) => ipcRenderer.invoke('files.pickFolder', key),
  pickFile: (key: string, filters?: Electron.FileFilter[]) => ipcRenderer.invoke('files.pickFile', key, filters),
});
```

**renderer（擬似）**

```ts
bgmSelectBtn.onclick = async () => {
  const picked = await window.files.pickFile('bgm', [{ name:'Audio', extensions:['mp3','wav','aac'] }]);
  if (picked) form.setValue('bgmPath', picked);
};
outputDirBtn.onclick = async () => {
  const picked = await window.files.pickFolder('outputDir');
  if (picked) form.setValue('outputDir', picked);
};
```

---

## 4) テスト計画（自動化）

### 4.1 ログイン機能

* **ユニット**：Cookie 正規化・保存/復元・必須 Cookie 判定関数。
* **統合**：`createLoginWindow` のナビゲーションをモック（/login→/home）でシミュレーション。
* **E2E（Playwright）**：

  * アプリ起動→「X にログイン」クリック→モックログインに ID/パス入力→/home 遷移→Cookie 保存→再起動後に保護ページ直アクセス成功。

### 4.2 ファイル/フォルダ選択

* **ユニット**：`last-path.json` の読み書き / ダイアログ結果の正規化。
* **統合**：IPC 経由選択で Renderer のフォーム値が更新されること。

---

## 5) 受け入れチェックリスト（PO 視点）

* [ ] 公式ログイン画面の表示とユーザー入力のみでの完了。
* [ ] セッションの永続：終了→再起動でも維持。期限切れ時は自然な再ログイン導線。
* [ ] OS ネイティブダイアログ：フィルタ/既定パス/直近記憶が機能。
* [ ] CI でもテストが安定して緑。

---

## 6) Copilot Agent Mode 実行プレイブック

> **目的**：本ファイルをコンテキストに、Copilot による**無停止オートラン**を実現。

1. **前提確認**

   * Node / pnpm or npm、Electron、Playwright が devDependencies に存在。存在しなければ追加。
   * `keytar` のネイティブ前提に注意（Windows の場合 `windows-build-tools` 等が必要なら自動セットアップ）。
2. **ブランチ戦略**

   * `git switch -c feat/auth-and-dialogs`（存在すれば更新）。
   * 変更前に `git stash -u` でスナップショット。
3. **差分実装**（本ファイルの 2,3 の設計に従う）

   * `main/login.ts`, `preload/auth.ts`, `main/dialogs.ts`, `preload/files.ts` の新規/改変。
   * Renderer にボタン/フォーム連携を追加（適切な状態管理を選択：React/Redux/Zustand 等）。
4. **テスト実装**

   * ユニット/統合/Playwright E2E を作成し、`npm run test` / `npm run test:e2e` を整備。
5. **反復修正**

   * 失敗時はログに根因を残し、根因ごとに最小差分で修正 → 再実行。
6. **ビルド/配布物**

   * `npm run build` → `electron-builder` 等で exe/MSI/portable を生成。
7. **最終確認**

   * DoD の 3 要件を再検証。`README`/アプリ内ヘルプも更新。

---

## 7) VS Code / Copilot 推奨設定（参考）

> 環境とポリシーにより挙動は異なるため、以下は**推奨**。組織ポリシーに従うこと。

* `settings.json`（例）

```json
{
  "github.copilot.chat.codeGeneration.useInstructionFiles": true,
  "github.copilot.chat.editing.enableEditCode": true,
  "github.copilot.chat.serverSideActions.enabled": true,
  "github.copilot.chat.experimental.promptsInWorkspace": true
}
```

* Copilot Chat の「コマンド実行許可」系は最新版拡張の仕様に依存。ターミナルやワークスペースに**信頼**を付与し、エージェントの実行確認を減らす。

---

## 8) セキュリティと運用メモ

* 収集対象は **Cookie のみ**。ID/パス/OTP は保存しない。ログに個人情報を書かない。Cookie 値の平文出力は禁止（マスク）。
* Google/YouTube はドメイン横断 Cookie が多い→**URL 判定を厳しめ**にして誤検知を抑制。
* `keytar` はビルドにネイティブ前提あり→CI/配布用に **prebuild** を検討。
* 企業プロキシ/証明書ストアで遷移が止まる場合 → タイムアウト/再試行を明示化。

---

### 付録A：成功検知のガード例

* Cookie 数が閾値以上 & 重要名を含む。
* 直近 URL が許可ドメインかつ `/home|/feed|/` 等へ遷移。
* ログインページ特有要素の**消失**（フォーム/ボタンが DOM から消える）。

### 付録B：Agent の自己ログ（JSON Lines 例）

```jsonl
{"phase":"plan","ok":true,"notes":"login+dialog IPC diff"}
{"phase":"impl","file":"main/login.ts","action":"write","loc":220}
{"phase":"test","cmd":"npm run test:e2e","result":"fail","reason":"cookie not saved"}
{"phase":"fix","diff":"add captureCookies after did-navigate"}
{"phase":"test","cmd":"npm run test:e2e","result":"pass"}
{"phase":"build","cmd":"npm run build","result":"pass"}
```