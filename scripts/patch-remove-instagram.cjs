// scripts/patch-remove-instagram.cjs
// Node >=16 で動作。Instagram 分岐/型/配列の痕跡を安全に削除します。
const fs = require('node:fs');
const path = require('node:path');

const files = [
  'electron/tools/generate-from-urls.ts',
  'electron/tools/generate-test-video.ts',
  'electron/tools/generate-batch-accounts.ts',
];

function patchFile(fp) {
  if (!fs.existsSync(fp)) {
    console.warn('[skip] not found:', fp);
    return;
  }
  let src = fs.readFileSync(fp, 'utf8');
  const before = src;

  // 1) 三項演算子の Instagram 節を削除（: <cond> ? 'Instagram'）
  //   変数名(u/url/任意識別子)、includes/match/test の揺れ、http/https などを許容
  const IG_TERNARY = new RegExp(
    String.raw`s*:s*[A-Za-z_$][w$]*s*.s*(?:includes|match|test)s*(s*[^)]*instagram.com[^)]*)s*?s*['"]Instagram['"]`,
    'gi'
  );
  src = src.replace(IG_TERNARY, '');

  // 2) 'Instagram' リテラルが残っていれば、kind の連鎖ごと置換（フォールバック）
  //    const kind = ...; の“;”までを一括で安全差し替え
  if (/Instagram/.test(src)) {
    src = src.replace(
      /consts+kinds*=s*[sS]*?;/,
      `const kind = (u.includes('youtube.com') || u.includes('youtu.be'))
  ? 'YouTube'
  : (u.includes('tiktok.com') ? 'TikTok' : 'Unknown');`
    );
  }

  // 3) ユニオン型や as キャストから 'instagram' を除去
  //    例: 'tiktok'|'instagram'|'youtube' など
  src = src
    .replace(/|s*'instagram's*/g, '|')   // ...|'instagram'|
    .replace(/'instagram's*|/g, '')       // 'instagram'|
    .replace(/|s*'instagram'/g, '')       // |'instagram'
    .replace(/'instagram'/g, '');           // 単独で残った場合

  // 4) 配列/マップから 'instagram' を除去（末尾・先頭カンマ両対応）
  src = src
    .replace(/,s*['"]instagram['"]/gi, '') // , 'instagram'
    .replace(/['"]instagram['"]s*,s*/gi, '') // 'instagram',
    .replace(/\[\s*,/g, '[')                // [ ,x] のカンマ崩れ修正
    .replace(/,\s*\]/g, ']');               // [x, ] の末尾カンマ修正

  if (src !== before) {
    fs.writeFileSync(fp, src, 'utf8');
    console.log('[patched]', fp);
  } else {
    console.log('[no-op]', fp, '(already clean)');
  }
}

function main() {
  const repoRoot = process.cwd();
  for (const rel of files) {
    patchFile(path.join(repoRoot, rel));
  }
}

main();