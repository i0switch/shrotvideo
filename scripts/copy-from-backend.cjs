'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function parseArgs(argv){
  const out = {}; for (let i=2;i<argv.length;i++){ const a=argv[i];
    const m1=a.match(/^--(\w+?)=(.*)$/); if(m1){out[m1[1]]=m1[2]; continue;}
    const m2=a.match(/^--(\w+)$/); if(m2 && argv[i+1] && !argv[i+1].startsWith('--')){ out[m2[1]]=argv[i+1]; i++; }
  } return out;
}

async function ensureDir(p){ await fsp.mkdir(p,{recursive:true}).catch(()=>{}); return p; }

async function main(){
  const a = parseArgs(process.argv);
  let user = a.user || process.env.USER || '';
  if (!user) { console.error('Missing --user'); process.exit(1); }
  if (user.startsWith('@')) user = user.slice(1);
  const count = Math.max(1, Math.min(10, Number(a.count || 5)));
  const baseOut = (a.outBase || 'test-results/auto-screenshots').trim();
  const ts = Date.now();
  const outDir = path.join(process.cwd(), baseOut, `${user}-${ts}`);
  await ensureDir(outDir);
  const altBase = path.join(process.cwd(), 'screenshot', 'out', 'screenshots', user);
  const list = fs.existsSync(altBase) ? (await fsp.readdir(altBase)) : [];
  const pngs = list.filter(f=>/\.png$/i.test(f)).sort().slice(-count);
  let idx=0; for (const f of pngs){ idx++; const src=path.join(altBase,f); const dest=path.join(outDir, `${String(idx).padStart(2,'0')}-${f}`);
    const buf = await fsp.readFile(src); await fsp.writeFile(dest, buf);
  }
  const summary = pngs.map((f,i)=>({ id: f, src: path.join(altBase,f), saved: path.join(outDir, `${String(i+1).padStart(2,'0')}-${f}`)}));
  await fsp.writeFile(path.join(outDir,'summary.json'), JSON.stringify(summary,null,2),'utf8');
  console.log('[copy-from-backend] Saved', summary.length, 'file(s) to', outDir);
}

if (require.main === module){ main().catch(e=>{ console.error('[copy-from-backend] fatal:', e?.message||String(e)); process.exit(1); }); }
