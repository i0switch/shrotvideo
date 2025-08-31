const $ = (id) => document.getElementById(id);
const state = { videoPath: null, bgmPath: null, fontPath: null };
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

function ui() {
  return {
    topText: $('topText').value,
    bottomText: $('bottomText').value,
    fontHex: $('fontColor').value,
    boxHex: $('boxColor').value,
    boxAlpha: parseFloat($('boxAlpha').value || '0.8'),
    padding: parseInt($('padding').value || '16', 10),
    offsetTop: parseInt($('offsetTop').value || '0', 10),
    offsetBottom: parseInt($('offsetBottom').value || '0', 10),
    outName: $('outName').value || 'output_telop.mp4'
  };
}

function hexToRgba(hex, a) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})`;
}

function wrapText(text, maxWidth) {
  ctx.font = ctx.font || 'bold 28px system-ui';
  const chars = [...text];
  const lines = [];
  let line = '';
  for (const ch of chars) {
    const t = line + ch;
    if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = ch; }
    else { line = t; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawPreview() {
  if (!video.videoWidth) return;
  const W = canvas.width, H = canvas.height;
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.min(W/vw, H/vh);
  const dw = Math.round(vw*s), dh = Math.round(vh*s);
  const dx = Math.round((W-dw)/2), dy = Math.round((H-dh)/2);

  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0,0,W,H);
  ctx.drawImage(video, dx, dy, dw, dh);

  const v = ui();
  const fontSize = Math.max(16, Math.floor(H * 0.05));
  ctx.font = `bold ${fontSize}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const maxTextW = W * 0.9;
  function drawTelop(text, yBase) {
    if (!text) return;
    const lines = wrapText(text, maxTextW);
    const lineH = fontSize;
    const textH = lines.length * lineH;
    const bx = W/2 - Math.max(...lines.map(l => ctx.measureText(l).width))/2 - v.padding;
    const by = yBase - v.padding;
    const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + v.padding*2;
    const bh = textH + v.padding*2;
    ctx.fillStyle = hexToRgba(v.boxHex, v.boxAlpha);
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = v.fontHex;
    let y = yBase;
    for (const ln of lines) { ctx.fillText(ln, W/2, y); y += lineH; }
  }

  drawTelop(v.topText, v.padding + v.offsetTop);
  drawTelop(v.bottomText, H - (Math.max(1, ui().bottomText.length) ? fontSize : 0) - v.padding + v.offsetBottom);

  requestAnimationFrame(drawPreview);
}

$('pickVideo').onclick = async () => {
  const p = await window.api.pickVideo();
  if (!p) return;
  state.videoPath = p;
  video.src = `file://${p}`;
  video.onloadedmetadata = () => {
    const ratio = video.videoHeight / video.videoWidth;
    canvas.height = Math.round(canvas.width * ratio);
  };
  requestAnimationFrame(drawPreview);
};
$('pickBgm').onclick = async () => { const p = await window.api.pickAudio(); if (p) state.bgmPath = p; };
$('pickFont').onclick = async () => { const p = await window.api.pickFont(); if (p) state.fontPath = p; };

function escFF(s) { return (s||'').replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","\\'").replaceAll('%','\\%'); }
function hexAlpha(hex,a){ return `${hex.replace('#','')}@${Math.max(0,Math.min(1,a)).toFixed(3)}`; }

$('exportBtn').onclick = async () => {
  if (!state.videoPath) { alert('動画を選択してください'); return; }
  const v = ui();
  const fontSize = Math.max(16, Math.floor((canvas.height||1080) * 0.05));
  const x = '(w-text_w)/2';
  const yTop = `${v.padding}+${v.offsetTop}`;
  const yBottom = `h-text_h-${v.padding}+${v.offsetBottom}`;
  const base = `fontsize=${fontSize}:fontcolor=${v.fontHex.replace('#','')}:box=1:boxcolor=${hexAlpha(v.boxHex,v.boxAlpha)}:boxborderw=${v.padding}`;
  const font = state.fontPath ? `:fontfile='${escFF(state.fontPath)}'` : '';
  const fTop = v.topText ? `drawtext=text='${escFF(v.topText)}':x=${x}:y=${yTop}:${base}${font}` : '';
  const fBottom = v.bottomText ? `drawtext=text='${escFF(v.bottomText)}':x=${x}:y=${yBottom}:${base}${font}` : '';
  const vf = [fTop,fBottom].filter(Boolean).join(',');
  const out = state.videoPath.replace(/\\[^\\/]+$/, `\\${escFF(v.outName)}`);
  const args = ['-y','-i',state.videoPath,'-vf',vf,'-c:v','libx264','-preset','medium','-crf','18'];
  if (state.bgmPath) args.push('-i', state.bgmPath, '-shortest', '-c:a', 'aac', '-b:a', '192k');
  args.push(out);
  $('log').textContent = `ffmpeg ${args.map(a=>a.includes(' ')?`"${a}"`:a).join(' ')}`;
  const res = await window.api.runFFmpeg(args);
  $('log').textContent += `\n\n[exit ${res.code}]\n${res.stderr}`;
  if (res.code === 0) alert('書き出し完了');
};
