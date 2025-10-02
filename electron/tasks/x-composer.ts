import path from 'node:path';
import fs from 'node:fs/promises';
import log from 'electron-log';
import { BrowserWindow } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

export type MediaBox = { x: number; y: number; width: number; height: number };

export type TweetClassification = 'single_video' | 'multi_video' | 'image' | 'text';

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 140);
}

export async function captureTweetScreenshotAndBox(url: string, outDir: string): Promise<{
  screenshotPath: string;
  relBox?: MediaBox;
  tweetId?: string;
  classification: TweetClassification;
  externalUrl?: string;
  hlsHint?: string;
  dpr?: number;
  diag?: {
    clipRectDip?: { x: number; y: number; width: number; height: number } | null;
    windowSizeDip?: { width: number; height: number };
    expectedPx: { width: number; height: number };
    actualPx: { width: number; height: number };
    deltaPx: { width: number; height: number };
    effectiveScale?: { x: number; y: number };
    articleRectDip?: { x: number; y: number; width: number; height: number } | null;
    pickedMediaRectDip?: { x: number; y: number; width: number; height: number } | null;
    overlayBoxPx?: { x: number; y: number; width: number; height: number } | null;
  };
} | null> {
  // パッケージ環境でも動作するように、ElectronのオフスクリーンBrowserWindowで記事を撮影し、要素矩形を評価する
  try { await fs.mkdir(outDir, { recursive: true }); } catch { /* ignore */ }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      // TrustedTypes/CSP の影響を緩和しつつ安全性は確保
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
      sandbox: false,
    },
  });

  try {
    // 追加: コンソール・ロード関連の詳細ログ
    try {
      win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        const lvl = level === 0 ? 'LOG' : level === 1 ? 'WARN' : level === 2 ? 'ERROR' : String(level);
        log.verbose(`[x-composer][console][${lvl}] ${sourceId || ''}:${line || 0} ${message}`);
      });
      win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
        log.warn('[x-composer] did-fail-load', { errorCode, errorDescription, validatedURL });
      });
      win.webContents.on('render-process-gone', (_e, details) => {
        log.warn('[x-composer] render-process-gone', details);
      });
      win.on('unresponsive', () => log.warn('[x-composer] window unresponsive'));
      win.on('responsive', () => log.verbose('[x-composer] window responsive'));
    } catch { /* ignore */ }

    try { win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'); } catch { /* ignore */ }
    await win.loadURL(url);
    // 初期安定化
    try { await win.webContents.executeJavaScript('new Promise(r=>{setTimeout(r,400)})', true); } catch { /* ignore */ }
    // 記事要素の存在を待機（最大30s）
    let ok = false;
    try {
      ok = await win.webContents.executeJavaScript(
        `new Promise(resolve => { try { const start=Date.now(); (function tick(){ try{ const a=document.querySelector('article[role="article"]'); if(a) return resolve(true); if(Date.now()-start>30000) return resolve(false);}catch{} setTimeout(tick,200); })(); } catch { resolve(false); } })`,
        true
      );
    } catch (e) {
      log.warn('[x-composer] executeJavaScript(wait article) failed; will try CDP fallback. Reason:', (e as Error)?.message || String(e));
      ok = false;
    }
    if (!ok) {
      // JS 注入が失敗した可能性があるため、CDP で記事存在のみチェック
      const exists = await tryGetRectsViaCDP(win, { onlyCheck: true }).catch(() => false);
      if (!exists) {
        log.warn('[x-composer] article not found for url (both JS/CDP failed):', url);
        return null;
      }
    }

    // DPRと記事/動画/画像矩形、tweetId、分類を取得
    let info: any | null = null;
    try {
      info = await win.webContents.executeJavaScript(
        `(() => {
          try {
            const dpr = window.devicePixelRatio || 1;
            const art = document.querySelector('article[role="article"]');
            const rectA = art && art.getBoundingClientRect();
            const vids = art ? Array.from(art.querySelectorAll('video')) : [];
            const imgs = art ? Array.from(art.querySelectorAll('img')) : [];
            const vRects = vids.map(v => v.getBoundingClientRect());
            const iRects = imgs.map(im => im.getBoundingClientRect());
            // 外部埋め込みを補足（カード、iframe、videoPlayer等）
            const card = art && art.querySelector('[data-testid="card.wrapper"]');
            const frames = art ? Array.from(art.querySelectorAll('iframe')) : [];
            const player = art && art.querySelector('[data-testid="videoPlayer"]');
            const altRects = [];
            if (card) { const r = card.getBoundingClientRect(); if (r && r.width>1 && r.height>1) altRects.push(r); }
            for (const f of frames) { try { const r = f.getBoundingClientRect(); if (r && r.width>1 && r.height>1) altRects.push(r); } catch {} }
            if (player) { const r = player.getBoundingClientRect(); if (r && r.width>1 && r.height>1) altRects.push(r); }
            const allRects = vRects.concat(altRects);
            const vCount = allRects.length; const iCount = imgs.length;
            let classification = 'text';
            if (vCount>0) classification = vCount===1 ? 'single_video' : 'multi_video';
            else if (iCount>0) classification = 'image';
            const link = art && art.querySelector('a[href*="/status/"]');
            const href = link && link.getAttribute('href') || '';
            const m = href && href.match(/\/status\/(\d+)/);
            const tweetId = m && m[1] || undefined;
            // 外部リンク（YouTube, youtu.be, video.twimg.com 等）を拾う
            let externalUrl = '';
            try {
              const aTags = art ? Array.from(art.querySelectorAll('a[href]')) : [];
              for (const a of aTags) {
                const h = a.getAttribute('href') || '';
                if (/https?:\/\/(www\.)?youtube\.com\//.test(h) || /https?:\/\/(www\.)?youtu\.be\//.test(h) || /https?:\/\/video\.twimg\.com\//.test(h)) { externalUrl = h; break; }
              }
            } catch {}
            // 追加: HLS source の簡易スキャン（ログ用ヒント）
            let hlsHint = '';
            try {
              const srcTags = art ? Array.from(art.querySelectorAll('source[src]')) : [];
              for (const s of srcTags) {
                const h = s.getAttribute('src') || '';
                if (/\.m3u8(\?|$)/.test(h) || /video\.twimg\.com/.test(h)) { hlsHint = h; break; }
              }
            } catch {}
            return {
              dpr,
              a: rectA ? { x: rectA.x, y: rectA.y, width: rectA.width, height: rectA.height } : null,
              v: allRects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
              i: iRects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
              classification,
              tweetId,
              externalUrl,
              hlsHint,
            };
          } catch(e) { return { dpr: 1, a: null, v: [], classification: 'text', tweetId: undefined }; }
        })()`
      );
    } catch (e) {
      log.warn('[x-composer] executeJavaScript(info extract) failed; fallback to CDP. Reason:', (e as Error)?.message || String(e));
      info = await tryGetRectsViaCDP(win).catch(() => null);
    }

  // 記事矩形が無ければ全画面、あれば記事領域でキャプチャ
    const ts = Date.now();
    const base = sanitizeFileName(`xshot-${info?.tweetId || 'post'}-${ts}`);
    const screenshotPath = path.join(outDir, `${base}.png`);

    // Electron の capturePage の clip は DIP（CSSピクセル）基準
    // そのため、DPR を掛けずに使用する
    let clip:
      | { x: number; y: number; width: number; height: number }
      | undefined;
    if (info?.a && info.a.width > 2 && info.a.height > 2) {
      clip = {
        x: Math.max(0, Math.floor(info.a.x)),
        y: Math.max(0, Math.floor(info.a.y)),
        width: Math.max(2, Math.floor(info.a.width)),
        height: Math.max(2, Math.floor(info.a.height)),
      };
    }

    // 診断用に実寸（px）と期待サイズ（clip or window × dpr）を求める
    let actualPx = { width: 0, height: 0 };
    let expectedPx = { width: 0, height: 0 };
    const dpr = Number((info?.dpr || 1)) || 1;
    const winBounds = win.getContentBounds(); // DIP
    try {
      const img: any = await (win.webContents as any).capturePage(clip as any);
      const size = typeof img.getSize === 'function' ? img.getSize() : { width: 0, height: 0 };
      actualPx = { width: Math.max(0, size.width || 0), height: Math.max(0, size.height || 0) };
      expectedPx = clip
        ? { width: Math.round((clip.width) * dpr), height: Math.round((clip.height) * dpr) }
        : { width: Math.round(winBounds.width * dpr), height: Math.round(winBounds.height * dpr) };
      await fs.writeFile(screenshotPath, img.toPNG());
    } catch (e) {
      log.warn('[x-composer] capturePage failed; trying full page. reason:', (e as Error)?.message || String(e));
      const img2: any = await (win.webContents as any).capturePage();
      const size2 = typeof img2.getSize === 'function' ? img2.getSize() : { width: 0, height: 0 };
      actualPx = { width: Math.max(0, size2.width || 0), height: Math.max(0, size2.height || 0) };
      expectedPx = { width: Math.round(winBounds.width * (Number(info?.dpr || 1) || 1)), height: Math.round(winBounds.height * (Number(info?.dpr || 1) || 1)) };
      await fs.writeFile(screenshotPath, img2.toPNG());
    }

    // 動画領域の相対座標（記事矩形基準）。
    // 注意:
    // - capturePage の出力は物理解像度（デバイスピクセル）。
    // - getBoundingClientRect は CSS ピクセル。
    // - さらに環境により Electron のキャプチャ倍率が window.devicePixelRatio と一致しないことがある。
    // よって、実測スケール（captured actualPx ÷ (clip or window)）を優先し、DPR はフォールバックに用いる。
    let relBox: MediaBox | undefined;
    const baseW = (clip ? clip.width : winBounds.width) || 0; // DIP
    const baseH = (clip ? clip.height : winBounds.height) || 0; // DIP
    const scaleX = baseW > 0 && actualPx.width > 0
      ? (actualPx.width / baseW)
      : (Number(info?.dpr || 1) || 1);
    const scaleY = baseH > 0 && actualPx.height > 0
      ? (actualPx.height / baseH)
      : (Number(info?.dpr || 1) || 1);
    if (Array.isArray(info?.v) && info.v.length > 0) {
      const v0 = info.v[0];
      if (info?.a && info.a.width > 2 && info.a.height > 2) {
        // 記事領域でクリップして撮影した場合: 相対座標に変換し、実測スケールを掛ける
        const rx = (v0.x - info.a.x) * scaleX;
        const ry = (v0.y - info.a.y) * scaleY;
        const rw = v0.width * scaleX;
        const rh = v0.height * scaleY;
        relBox = { x: rx, y: ry, width: rw, height: rh };
      } else {
        // 記事矩形が取れない/フルページ撮影の場合: 絶対座標に実測スケールを掛ける
        const rx = v0.x * scaleX;
        const ry = v0.y * scaleY;
        const rw = v0.width * scaleX;
        const rh = v0.height * scaleY;
        relBox = { x: rx, y: ry, width: rw, height: rh };
      }
    } else if (Array.isArray(info?.i) && info.i.length > 0) {
      // 動画矩形が見つからない場合、記事内の最大画像領域を候補にする（カード静止画など）
      const pick = [...info.i].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
      if (pick) {
        if (info?.a && info.a.width > 2 && info.a.height > 2) {
          const rx = (pick.x - info.a.x) * scaleX;
          const ry = (pick.y - info.a.y) * scaleY;
          const rw = pick.width * scaleX;
          const rh = pick.height * scaleY;
          relBox = { x: rx, y: ry, width: rw, height: rh };
        } else {
          const rx = pick.x * scaleX;
          const ry = pick.y * scaleY;
          const rw = pick.width * scaleX;
          const rh = pick.height * scaleY;
          relBox = { x: rx, y: ry, width: rw, height: rh };
        }
      }
    }

    try {
      log.info('[x-composer] capture info', {
        hasArticle: !!info?.a,
        vCount: Array.isArray(info?.v) ? info.v.length : 0,
        iCount: Array.isArray(info?.i) ? info.i.length : 0,
        classification: info?.classification,
        tweetId: info?.tweetId,
        externalUrl: info?.externalUrl,
        dpr: info?.dpr || 1,
        relBox,
      });
    } catch { /* ignore */ }

  const deltaPx = { width: (actualPx.width - expectedPx.width), height: (actualPx.height - expectedPx.height) };
  const diag = {
    clipRectDip: clip || null,
    windowSizeDip: { width: winBounds.width, height: winBounds.height },
    expectedPx,
    actualPx,
    deltaPx,
    effectiveScale: { x: scaleX, y: scaleY },
    articleRectDip: info?.a || null,
    pickedMediaRectDip: Array.isArray(info?.v) && info.v[0] ? info.v[0] : (Array.isArray(info?.i) && info.i[0] ? info.i[0] : null),
    overlayBoxPx: relBox || null,
  } as const;

  return { screenshotPath, relBox, tweetId: info?.tweetId, classification: (info?.classification || 'text') as TweetClassification, externalUrl: info?.externalUrl, hlsHint: (info as any)?.hlsHint, dpr, diag };
  } catch (e) {
    log.warn('[x-composer] capture failed:', (e as Error)?.message || String(e));
    return null;
  } finally {
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}

// CDP (Chrome DevTools Protocol) を使って記事と動画の矩形を取得するフォールバック
async function tryGetRectsViaCDP(win: BrowserWindow, opts?: { onlyCheck?: boolean }): Promise<any> {
  const dbg: any = (win.webContents as any).debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    try { await dbg.sendCommand('DOM.enable'); } catch { /* ignore */ }
    try { await dbg.sendCommand('Overlay.enable'); } catch { /* ignore */ }
    let root: any = null;
    try { root = await dbg.sendCommand('DOM.getDocument', { depth: -1 }); } catch { root = null; }
    const rootId = root && root.root && root.root.nodeId;
    if (!rootId) {
      return opts?.onlyCheck ? false : { dpr: 1, a: null, v: [], classification: 'text', tweetId: undefined };
    }
    let artRes: any = null;
    try { artRes = await dbg.sendCommand('DOM.querySelector', { nodeId: rootId, selector: 'article[role="article"]' }); } catch { artRes = null; }
    const articleId = artRes && artRes.nodeId || 0;
    if (!articleId) {
      return opts?.onlyCheck ? false : { dpr: 1, a: null, v: [], classification: 'text', tweetId: undefined };
    }
    if (opts?.onlyCheck) return true;
    let aBox: any = null;
    try { aBox = await dbg.sendCommand('DOM.getBoxModel', { nodeId: articleId }); } catch { aBox = null; }
    const aRect = aBox && aBox.model && aBox.model.content ? boxModelToRect(aBox.model) : null;
    // video/埋め込みノード
    const vRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    try {
      const vids = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: articleId, selector: 'video' });
      const ids = (vids && vids.nodeIds) || [];
      for (const vid of ids) {
        let vb: any = null;
        try { vb = await dbg.sendCommand('DOM.getBoxModel', { nodeId: vid }); } catch { vb = null; }
        const r = vb && vb.model ? boxModelToRect(vb.model) : null;
        if (r && r.width > 1 && r.height > 1) vRects.push(r);
      }
    } catch { /* ignore */ }
    // 外部埋め込み候補: カード/iframe/ビデオプレイヤー
    try {
      const card = await dbg.sendCommand('DOM.querySelector', { nodeId: articleId, selector: '[data-testid="card.wrapper"]' });
      if (card && card.nodeId) {
        let cb: any = null;
        try { cb = await dbg.sendCommand('DOM.getBoxModel', { nodeId: card.nodeId }); } catch { cb = null; }
        const r = cb && cb.model ? boxModelToRect(cb.model) : null;
        if (r && r.width > 1 && r.height > 1) vRects.push(r);
      }
    } catch { /* ignore */ }
    try {
      const ifs = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: articleId, selector: 'iframe' });
      const ids = (ifs && ifs.nodeIds) || [];
      for (const id of ids) {
        let mb: any = null;
        try { mb = await dbg.sendCommand('DOM.getBoxModel', { nodeId: id }); } catch { mb = null; }
        const r = mb && mb.model ? boxModelToRect(mb.model) : null;
        if (r && r.width > 1 && r.height > 1) vRects.push(r);
      }
    } catch { /* ignore */ }
    try {
      const player = await dbg.sendCommand('DOM.querySelector', { nodeId: articleId, selector: '[data-testid="videoPlayer"]' });
      if (player && player.nodeId) {
        let pb: any = null;
        try { pb = await dbg.sendCommand('DOM.getBoxModel', { nodeId: player.nodeId }); } catch { pb = null; }
        const r = pb && pb.model ? boxModelToRect(pb.model) : null;
        if (r && r.width > 1 && r.height > 1) vRects.push(r);
      }
    } catch { /* ignore */ }
    // 画像の矩形も収集
    const iRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    let imgCount = 0;
    try {
      const imgs = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: articleId, selector: 'img' });
      const ids = ((imgs && imgs.nodeIds) || []);
      imgCount = ids.length;
      for (const id of ids) {
        let mb: any = null;
        try { mb = await dbg.sendCommand('DOM.getBoxModel', { nodeId: id }); } catch { mb = null; }
        const r = mb && mb.model ? boxModelToRect(mb.model) : null;
        if (r && r.width > 1 && r.height > 1) iRects.push(r);
      }
    } catch { /* ignore */ }
    let classification: TweetClassification = 'text';
    if (vRects.length > 0) classification = vRects.length === 1 ? 'single_video' : 'multi_video';
    else if (imgCount > 0) classification = 'image';
    // tweetId 抽出（リンク href）
    let tweetId: string | undefined = undefined;
    let externalUrl: string | undefined = undefined;
    try {
      const link = await dbg.sendCommand('DOM.querySelector', { nodeId: articleId, selector: 'a[href*="/status/"]' });
      if (link && link.nodeId) {
        const attrs = await dbg.sendCommand('DOM.getAttributes', { nodeId: link.nodeId });
        const arr: string[] = (attrs && attrs.attributes) || [];
        const map: Record<string, string> = {};
        for (let i = 0; i < arr.length; i += 2) map[arr[i]] = arr[i + 1];
        const href = map['href'] || '';
        const m = href.match(/\/status\/(\d+)/);
        if (m) tweetId = m[1];
      }
      // 外部リンクも検索（適当な最初の1件）
      try {
        const aNodes = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: articleId, selector: 'a[href]' });
        const ids = (aNodes && aNodes.nodeIds) || [];
        for (const id of ids) {
          const attrs = await dbg.sendCommand('DOM.getAttributes', { nodeId: id });
          const arr: string[] = (attrs && attrs.attributes) || [];
          const map: Record<string, string> = {};
          for (let i = 0; i < arr.length; i += 2) map[arr[i]] = arr[i + 1];
          const href = map['href'] || '';
          if (/https?:\/\/(www\.)?youtube\.com\//.test(href) || /https?:\/\/(www\.)?youtu\.be\//.test(href) || /https?:\/\/video\.twimg\.com\//.test(href)) { externalUrl = href; break; }
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  return { dpr: 1, a: aRect, v: vRects, i: iRects, classification, tweetId, externalUrl };
  } catch (e) {
    log.warn('[x-composer] CDP fallback failed:', (e as Error)?.message || String(e));
    throw e;
  } finally {
    try { if ((win.webContents as any).debugger.isAttached()) (win.webContents as any).debugger.detach(); } catch { /* ignore */ }
  }
}

function boxModelToRect(model: { content: number[] }): { x: number; y: number; width: number; height: number } | null {
  // content は [x1,y1, x2,y2, x3,y3, x4,y4]
  try {
    const c = (model as any).content as number[];
    if (!Array.isArray(c) || c.length < 8) return null;
    const xs = [c[0], c[2], c[4], c[6]];
    const ys = [c[1], c[3], c[5], c[7]];
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
  } catch {
    return null;
  }
}

export async function overlayVideoOnScreenshot(params: {
  screenshotPath: string;
  videoPath: string;
  box: MediaBox;
  outputDir: string;
  fileName?: string;
}): Promise<string> {
  const { screenshotPath, videoPath, box, outputDir } = params;
  await fs.mkdir(outputDir, { recursive: true }).catch(() => undefined);
  const outName = sanitizeFileName(params.fileName || `x-compose-${Date.now()}.mp4`);
  const outputPath = path.join(outputDir, outName);

  // ffmpeg 実行パス設定
  // app.asar 配下のパスを app.asar.unpacked に差し替える安全解決
  const resolvePackedBinary = (p: string | undefined | null): string | undefined => {
    if (!p) return undefined;
    try {
      let fixed = p;
      if (fixed.includes('app.asar\\')) fixed = fixed.replace('app.asar\\', 'app.asar.unpacked\\');
      if (fixed.includes('app.asar/')) fixed = fixed.replace('app.asar/', 'app.asar.unpacked/');
      // 実在チェックは不要だが、存在すればそれを優先
      try { if (require('node:fs').existsSync(fixed)) return fixed; } catch {}
      return p || undefined;
    } catch { return p || undefined; }
  };
  try {
    const raw = (ffmpegStatic as unknown as string) || '';
    const bin = resolvePackedBinary(raw) || raw;
    if (bin) ffmpeg.setFfmpegPath(bin);
  } catch {}

  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(2, Math.round(box.width));
  const h = Math.max(2, Math.round(box.height));

  log.info('[x-composer] overlay start', { outputPath, x, y, w, h });

  const run = (permissive: boolean) => new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg();
    cmd.input(screenshotPath).inputOptions(['-loop 1', '-framerate 30']);
    cmd.input(videoPath);
    if (!permissive) {
      cmd
        .complexFilter([
          `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=rgba[bg]`,
          `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p[vid]`,
          `[bg][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`,
        ])
        .outputOptions([
          '-map [outv]',
          '-map 1:a?',
          '-c:v libx264',
          '-c:a aac',
          '-pix_fmt yuv420p',
          '-vsync 2',
          '-shortest',
          '-movflags +faststart',
          '-preset veryfast',
        ]);
    } else {
      cmd
        .complexFilter([
          `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[bg]`,
          `[1:v][bg]scale2ref=w=${w}:h=${h}[vid][bgr]`,
          `[bgr][vid]overlay=${x}:${y}:eval=init:shortest=1[outv]`,
        ])
        .outputOptions([
          '-map [outv]',
          '-map 1:a?',
          '-c:v libx264',
          '-c:a aac',
          '-pix_fmt yuv420p',
          '-vsync 2',
          '-shortest',
          '-movflags +faststart',
          '-preset veryfast',
        ]);
    }
    cmd
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err));
  });

  try {
    await run(false);
  } catch (e1) {
    log.warn('[x-composer] primary overlay failed; retry permissive', (e1 as Error)?.message || String(e1));
    await run(true);
  }

  log.info('[x-composer] overlay done', { outputPath });
  return outputPath;
}
