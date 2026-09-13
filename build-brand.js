/* =========================================================
   BUILD THE BRAND ASSETS  (Phase D)
   ---------------------------------------------------------
   brand/loop-mark.svg is the one source of LOOP's mark. This
   script derives everything else from it and touches nothing
   it did not derive:

     icon-192.png, icon-512.png     purpose "any": the mark on
                                    its own squircle, corners
                                    transparent
     icon-maskable-192.png,
     icon-maskable-512.png          purpose "maskable": full
                                    bleed; the mark already sits
                                    inside the 80% safe circle
     apple-touch-icon.png           180, full bleed and opaque;
                                    iOS applies its own mask
     favicon.svg, favicon-32.png    the flat mark, larger in its
                                    squircle, for tab sizes
     index.html                     the launch mark, between the
                                    LOOP-MARK-BEGIN / END markers
     brand/icons.json               what was built, from which
                                    master, with every hash

   Rasterising uses a headless Chromium browser (Edge or Chrome)
   over the DevTools Protocol, so no image library is needed.
   Set LOOP_BROWSER to its path if it is not found.

       node build-brand.js

   A contract holds the derived files to the hashes recorded in
   brand/icons.json, and icons.json to the master's own hash, so
   editing the master without rebuilding fails the suite.
   ========================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const MASTER = path.join(ROOT, 'brand', 'loop-mark.svg');
const APP = path.join(ROOT, 'index.html');
const RECORD = path.join(ROOT, 'brand', 'icons.json');
const OPEN = '<!-- LOOP-MARK-BEGIN -->';
const CLOSE = '<!-- LOOP-MARK-END -->';
const NL = String.fromCharCode(10);

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const lf = text => String(text).split('\r\n').join(NL);

/* ---------- pure derivation (required by the contracts) ---------- */

function part(master, open, close){
  const a = master.indexOf(open);
  const b = master.indexOf(close, a);
  if(a === -1 || b === -1) throw new Error('master is missing ' + open);
  return master.slice(a, b + close.length);
}
function pieces(masterText){
  const m = lf(masterText);
  const defs = part(m, '<defs>', '</defs>');
  const field = part(m, '<g id="field">', '</g>');
  const mark = part(m, '<g id="mark">', NL + '</g>' + NL + '</svg>').replace(NL + '</svg>', '');
  return { defs, field, mark };
}
/* The tile an "any" icon and the favicon sit on: a continuous-curvature
   superellipse (exponent 5), the same family as an iOS icon mask. */
function squirclePath(size){
  const pts = [], half = size / 2, k = 256;
  for(let i = 0; i < k; i++){
    const t = i / k * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push((half + half * Math.sign(c) * Math.pow(Math.abs(c), 0.4)).toFixed(2) + ' ' +
             (half + half * Math.sign(s) * Math.pow(Math.abs(s), 0.4)).toFixed(2));
  }
  return 'M' + pts.join(' L') + ' Z';
}
const svgOpen = (w, h, vb, extra) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="' + vb + '"' + (extra || '') + '>';

/* Full bleed: the master as drawn. */
function composeFull(masterText){
  const p = pieces(masterText);
  return svgOpen(1024, 1024, '0 0 1024 1024') + NL + p.defs + NL + p.field + NL + p.mark + NL + '</svg>' + NL;
}
/* Its own squircle, transparent outside it. */
function composeAny(masterText){
  const p = pieces(masterText);
  const defs = p.defs.replace('</defs>', '<clipPath id="loop-tile"><path d="' + squirclePath(1024) + '"/></clipPath>' + NL + '</defs>');
  return svgOpen(1024, 1024, '0 0 1024 1024') + NL + defs + NL +
    '<g clip-path="url(#loop-tile)">' + NL + p.field + NL + '</g>' + NL + p.mark + NL + '</svg>' + NL;
}
/* Tab sizes: no bloom, no tuck shadow, no edge light (all sub-pixel there),
   and the mark drawn larger in its squircle so it reads at 16-32px. */
function composeFlat(masterText){
  const p = pieces(masterText);
  const field = p.field.replace(/\n<rect id="bloom"[^\n]*\/>/, '');
  const mark = p.mark
    .replace(/\n<g id="tuck"[\s\S]*?\n<\/g>/, '')
    .replace(/\n<rect mask="url\(#loop-edge-mask\)"[^\n]*\/>/, '')
    .replace('<g id="mark">', '<g id="mark" transform="translate(512 512) scale(1.22) translate(-512 -512)">');
  const defs = p.defs.replace('</defs>', '<clipPath id="loop-tile"><path d="' + squirclePath(1024) + '"/></clipPath>' + NL + '</defs>');
  return svgOpen(1024, 1024, '0 0 1024 1024') + NL + defs + NL +
    '<g clip-path="url(#loop-tile)">' + NL + field + NL + '</g>' + NL + mark + NL + '</svg>' + NL;
}
/* The launch mark: the mark alone, cropped to its own box with a margin, for
   the app's opening screen. No title, so it is never announced. */
function composeLaunch(masterText){
  const p = pieces(masterText);
  return svgOpen(112, 112, '192 192 640 640', ' class="intro-mark" aria-hidden="true" focusable="false"') +
    p.defs + p.mark + '</svg>';
}

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, compose: composeAny, purpose: 'any', transparent: true },
  { file: 'icon-512.png', size: 512, compose: composeAny, purpose: 'any', transparent: true },
  { file: 'icon-maskable-192.png', size: 192, compose: composeFull, purpose: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, compose: composeFull, purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, compose: composeFull, purpose: 'apple-touch-icon' },
  { file: 'favicon-32.png', size: 32, compose: composeFlat, purpose: 'favicon', transparent: true }
];

/* ---------- the browser ---------- */

function findBrowser(){
  const candidates = [process.env.LOOP_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find(p => p && fs.existsSync(p));
}
async function openBrowser(){
  const exe = findBrowser();
  if(!exe) throw new Error('no Chromium browser found — set LOOP_BROWSER');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-brand-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for(let i = 0; i < 100 && !targets; i++){
    try{ targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); }
    catch(e){ await new Promise(r => setTimeout(r, 200)); }
  }
  if(!targets) throw new Error('browser did not start');
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const waiters = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if(m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if(m.method) waiters.slice().forEach(w => w(m));
  };
  const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  await send('Page.enable');
  return {
    async render(svg, size, transparent){
      const vp = Math.max(size, 256);                   // a tiny viewport is not guaranteed; the clip is exact
      await send('Emulation.setDeviceMetricsOverride', { width: vp, height: vp, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      const loaded = new Promise(res => { const w = m => { if(m.method === 'Page.loadEventFired'){ waiters.splice(waiters.indexOf(w), 1); res(); } }; waiters.push(w); });
      const sized = svg.replace('width="1024" height="1024"', 'width="' + size + '" height="' + size + '"');
      const html = '<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>' + sized + '</body></html>';
      await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
      await loaded;
      await new Promise(r => setTimeout(r, 120));
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    },
    async close(){
      /* The browser is asked to close itself: on Windows the executable that
         was started hands off to a separate browser process and exits, so
         killing the started process leaves the browser and its helpers
         running. The kill is only the fallback. */
      try{ await Promise.race([send('Browser.close'), new Promise(r => setTimeout(r, 2000))]); }catch(e){}
      try{ ws.close(); }catch(e){}
      await new Promise(r => setTimeout(r, 600));
      if(process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else{ try{ proc.kill(); }catch(e){} }
      try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
    }
  };
}

function pngSize(buf){
  if(buf.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ---------- build ---------- */

async function main(){
  const masterBuf = fs.readFileSync(MASTER);
  const master = masterBuf.toString('utf8');
  const record = {
    note: 'Derived from brand/loop-mark.svg by build-brand.js. Rebuild after changing the master.',
    master: { file: 'brand/loop-mark.svg', sha256: sha256(Buffer.from(lf(master))) },
    outputs: {}
  };

  const browser = await openBrowser();
  try{
    for(const o of OUTPUTS){
      const png = await browser.render(o.compose(master), o.size, !!o.transparent);
      const dims = pngSize(png);
      if(dims.width !== o.size || dims.height !== o.size) throw new Error(o.file + ' rendered at ' + dims.width + 'x' + dims.height);
      fs.writeFileSync(path.join(ROOT, o.file), png);
      record.outputs[o.file] = { purpose: o.purpose, width: o.size, height: o.size, sha256: sha256(png) };
      console.log('  ' + o.file.padEnd(24) + o.size + 'px  ' + o.purpose);
    }
  } finally {
    await browser.close();
  }

  const favicon = composeFlat(master);
  fs.writeFileSync(path.join(ROOT, 'favicon.svg'), favicon);
  record.outputs['favicon.svg'] = { purpose: 'favicon', sha256: sha256(Buffer.from(favicon)) };
  console.log('  favicon.svg');

  /* The launch mark goes into index.html between its markers, and nowhere
     else in the file changes. */
  const raw = fs.readFileSync(APP, 'utf8');
  const crlf = raw.indexOf('\r\n') !== -1;
  let app = lf(raw);
  const a = app.indexOf(OPEN), b = app.indexOf(CLOSE);
  if(a === -1 || b === -1 || b < a) throw new Error('LOOP-MARK markers not found in index.html');
  const launch = composeLaunch(master);
  app = app.slice(0, a + OPEN.length) + launch + app.slice(b);
  fs.writeFileSync(APP, crlf ? app.split(NL).join('\r\n') : app);
  record.outputs['index.html#launch'] = { purpose: 'launch', sha256: sha256(Buffer.from(launch)) };
  console.log('  index.html launch mark');

  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + NL);
  console.log('recorded in brand/icons.json');
}

module.exports = { pieces, squirclePath, composeFull, composeAny, composeFlat, composeLaunch, OUTPUTS, OPEN, CLOSE, sha256, lf };
if(require.main === module){
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
