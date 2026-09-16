/* =========================================================
   BUILD THE MUSCLE MAP ATLAS  (Phase D76.5)
   ---------------------------------------------------------
   muscle-map.webp is the approved illustration (LOOP 7.6) and
   the one source of the body figure. It is never edited. It
   already paints six groups blue, so drawing it as-is would
   claim work that was not done. This script derives, from that
   file alone and touching nothing it did not derive:

     muscle-map-atlas.webp     one image: the same figure with
                               the highlight colour taken out
                               (the neutral base, same pixels of
                               body, same alpha), and below it one
                               lit tile per canonical group per
                               view, cut from the same figure
     muscle-map-regions.png    which group owns each pixel of the
                               figure (0 = none), so the contracts
                               can check the tiles without a
                               WebP decoder
     muscle-map.json           what was built, from which master,
                               every tile rectangle, every hash,
                               and this build's own pixel checks
     index.html                the tile table, between the
                               MUSCLE-ATLAS-BEGIN / END markers

   How a highlight is made without redrawing anything:
   the art is flat shapes on a navy body, with navy gaps between
   them. Each shape is found as a connected region clearly away
   from the navy; each pixel near a shape is owned by it, with a
   coverage t (how much of the shape's colour is in that pixel
   against the navy — the anti-aliasing). Recolouring a shape
   moves every owned pixel by its own t, in OKLab, keeping its
   lightness texture and swapping the art's edge style for grey
   shapes (a soft light bevel) with the one it uses for blue
   shapes (a faint pale edge), or the reverse. Out-of-gamut
   colours lose chroma, never hue. Blue shapes' lit tiles are the
   approved pixels themselves, so lighting exactly the set the
   illustration shows reproduces it.

   Rasterising uses a headless Chromium browser (Edge or Chrome)
   over the DevTools Protocol, only to decode and encode WebP, so
   no image library is needed. Set LOOP_BROWSER to its path if it
   is not found.

       node build-muscle-map.js

   A contract holds the atlas and region map to the hashes in
   muscle-map.json, muscle-map.json to the master's own hash, and
   index.html's table to muscle-map.json, so editing the master
   or the table without rebuilding fails the suite.
   ========================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const MASTER = 'muscle-map.webp';
const ATLAS = 'muscle-map-atlas.webp';
const REGIONS = 'muscle-map-regions.png';
const RECORD = 'muscle-map.json';
const APP = 'index.html';
const OPEN = '/* MUSCLE-ATLAS-BEGIN */';
const CLOSE = '/* MUSCLE-ATLAS-END */';
const NL = String.fromCharCode(10);

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/* ---------- what the art draws (image coordinates of the master) ---------- */

/* The canonical groups in MUSCLE_MAP order, and for each view a point deep
   inside every shape of the art that draws that group. Nothing here invents a
   group: forearms, obliques-as-their-own-group, adductors, neck, knees and
   the lower back are not LOOP groups, so their shapes are named nowhere and
   stay neutral. Obliques are drawn inside abs because LOOP's abs keywords
   are core work that includes them (twist, side bend, woodchop, pallof). */
const GROUP_SHAPES = {
  chest:      { front: [[251, 351], [361, 351]] },
  shoulders:  { front: [[145, 320], [460, 311]], back: [[665, 311], [958, 308]] },
  back:       { back: [[760, 250], [866, 250], [777, 328], [852, 327], [725, 335], [903, 337], [737, 454], [886, 460]] },
  biceps:     { front: [[145, 429], [464, 427]] },
  triceps:    { back: [[658, 416], [969, 417]] },
  abs:        { front: [[272, 445], [340, 445], [277, 498], [332, 498], [280, 552], [330, 552], [306, 615], [230, 568], [389, 561]] },
  quads:      { front: [[233, 734], [378, 735], [177, 780], [432, 793]] },
  hamstrings: { back: [[712, 826], [765, 832], [860, 831], [914, 834]] },
  glutes:     { back: [[755, 672], [870, 671]] },
  calves:     { front: [[184, 1021], [248, 1036], [361, 1039], [425, 1022]], back: [[703, 1036], [759, 1036], [865, 1033], [921, 1035]] }
};
const GROUPS = Object.keys(GROUP_SHAPES);
/* The two views: the front figure is left of this column, the back right of it. */
const VIEW_SPLIT_X = 561;
/* The back view's head outline and its neck/upper-trapezius strips are one
   connected shape in the art. Above the junction row it is only the ring;
   below it, the ring's edge is bright and the strips are not. */
const HEAD_RING = { seed: [813, 149], junctionY: 152, brightSum: 300 };
/* The art's own tones, read from named shapes: its three blues, and the
   three greys it uses for muscle bellies (biceps, obliques, abs). A blue
   shape's neutral grey is the grey at the same rank; a grey shape's lit blue
   is interpolated at its lightness. */
const TONE_SEEDS = {
  blue:  { cyan: [251, 351], mid: [233, 734], deep: [712, 826] },
  grey:  { light: [145, 429], middle: [230, 568], dark: [277, 498] }
};
const PARAMS = {
  segmentDeltaE: 0.06,     // OKLab distance from the navy that counts as inside a shape
  minArea: 40,             // smaller components are compression specks
  coreSteps: 3,            // ownership reaches this many pixels past a shape's edge
  coreMinAlpha: 120,
  haloSteps: 10,           // blue-tinted halo pixels past that, on the silhouette
  haloMinT: 0.02,
  haloMinChroma: 0.045,    // the navy and the greys sit near 0.03

  tilePad: 4,
  grid: 32,                // tile origins, atlas positions and atlas size are multiples of this (see the packer)
  gutter: 32,              // transparent space between atlas cells, wider than any mip footprint at card sizes
  quality: 0.9,
  surface: [14, 20, 31]    // --surface, only for the build's own reconstruction check
};

/* ---------- colour ---------- */

const SRGB_LIN = new Float64Array(256);
for(let i = 0; i < 256; i++){ const v = i / 255; SRGB_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function oklab(r, g, b){
  const R = SRGB_LIN[r], G = SRGB_LIN[g], B = SRGB_LIN[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function labToLinear(L, a, b){
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
/* OKLab -> sRGB bytes. Out of gamut keeps lightness and hue and gives up
   chroma; clipping channels one by one is what shifts a pale cyan to green. */
function labToRGB(L, a, b){
  L = Math.max(0, Math.min(1, L));
  const inGamut = v => v[0] >= -1e-4 && v[0] <= 1.0001 && v[1] >= -1e-4 && v[1] <= 1.0001 && v[2] >= -1e-4 && v[2] <= 1.0001;
  let lin = labToLinear(L, a, b);
  if(!inGamut(lin)){
    let lo = 0, hi = 1;
    for(let i = 0; i < 24; i++){ const k = (lo + hi) / 2; if(inGamut(labToLinear(L, a * k, b * k))) lo = k; else hi = k; }
    lin = labToLinear(L, a * lo, b * lo);
  }
  return lin.map(c => { c = Math.max(0, Math.min(1, c)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); });
}
const chroma = lab => Math.hypot(lab[1], lab[2]);

/* ---------- PNG (the region map) ---------- */

function pngChunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodeGreyPNG(w, h, values){
  const raw = Buffer.alloc((w + 1) * h);
  for(let y = 0; y < h; y++){ raw[y * (w + 1)] = 0; Buffer.from(values.buffer, values.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
/* 8-bit greyscale, filter-aware, for the contracts */
function decodeGreyPNG(buf){
  let off = 8, w = 0, h = 0; const idat = [];
  while(off < buf.length){
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if(type === 'IHDR'){ w = data.readUInt32BE(0); h = data.readUInt32BE(4); if(data[8] !== 8 || data[9] !== 0) throw new Error('region map is not 8-bit grey'); }
    else if(type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const out = new Uint8Array(w * h); const prev = new Uint8Array(w);
  for(let y = 0; y < h; y++){
    const f = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), cur = out.subarray(y * w, (y + 1) * w);
    for(let x = 0; x < w; x++){
      const a = x ? cur[x - 1] : 0, b = prev[x], c = x ? prev[x - 1] : 0; let v = row[x];
      if(f === 1) v += a; else if(f === 2) v += b; else if(f === 3) v += (a + b) >> 1;
      else if(f === 4){ const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    prev.set(cur);
  }
  return { width: w, height: h, values: out };
}

/* ---------- the derivation ---------- */

function derive(master){
  const W = master.width, H = master.height, N = W * H, D = master.rgba;
  const LAB = new Float32Array(N * 3);
  for(let p = 0; p < N; p++){ const o = oklab(D[p * 4], D[p * 4 + 1], D[p * 4 + 2]); LAB[p * 3] = o[0]; LAB[p * 3 + 1] = o[1]; LAB[p * 3 + 2] = o[2]; }
  const at = (x, y) => y * W + x;
  const median = arr => { const s = Float64Array.from(arr).sort(); return s[s.length >> 1]; };
  const neighbours = (p) => { const x = p % W; return [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p >= W ? p - W : -1, p + W < N ? p + W : -1]; };

  /* the navy: opaque, dark, low-chroma pixels */
  const nl = [], na = [], nb = [], navyRGB = [[], [], []];
  for(let p = 0; p < N; p++){
    if(D[p * 4 + 3] >= 245 && LAB[p * 3] < 0.32 && Math.hypot(LAB[p * 3 + 1], LAB[p * 3 + 2]) < 0.06){
      nl.push(LAB[p * 3]); na.push(LAB[p * 3 + 1]); nb.push(LAB[p * 3 + 2]);
      if((nl.length & 7) === 0){ navyRGB[0].push(D[p * 4]); navyRGB[1].push(D[p * 4 + 1]); navyRGB[2].push(D[p * 4 + 2]); }
    }
  }
  const NAVY_LAB = [median(nl), median(na), median(nb)];
  const NAVY = navyRGB.map(median);

  /* shapes: 4-connected regions clearly away from the navy */
  const labels = new Int32Array(N); const comps = [null];
  for(let p = 0; p < N; p++){
    if(labels[p] || D[p * 4 + 3] < 200) continue;
    if(Math.hypot(LAB[p * 3] - NAVY_LAB[0], LAB[p * 3 + 1] - NAVY_LAB[1], LAB[p * 3 + 2] - NAVY_LAB[2]) < PARAMS.segmentDeltaE) continue;
    const id = comps.length; const stack = [p]; labels[p] = id; let area = 0;
    while(stack.length){
      const c = stack.pop(); area++;
      for(const n of neighbours(c)){
        if(n < 0 || labels[n] || D[n * 4 + 3] < 200) continue;
        if(Math.hypot(LAB[n * 3] - NAVY_LAB[0], LAB[n * 3 + 1] - NAVY_LAB[1], LAB[n * 3 + 2] - NAVY_LAB[2]) < PARAMS.segmentDeltaE) continue;
        labels[n] = id; stack.push(n);
      }
    }
    comps.push({ id, area });
  }

  /* split the back view's head ring from the neck strips it touches */
  const ringComp = labels[at(...HEAD_RING.seed)];
  if(!ringComp) throw new Error('head ring seed is not on a shape');
  const ringish = p => ((p / W) | 0) < HEAD_RING.junctionY || D[p * 4] + D[p * 4 + 1] + D[p * 4 + 2] > HEAD_RING.brightSum;
  const neckSeeds = GROUP_SHAPES.back.back.filter(s => labels[at(...s)] === ringComp).map(s => at(...s));
  if(neckSeeds.length !== 2) throw new Error('expected two neck seeds on the head shape, found ' + neckSeeds.length);
  const neckId = comps.length; comps.push({ id: neckId, area: 0 });
  {
    const stack = neckSeeds.slice(); neckSeeds.forEach(s => { if(ringish(s)) throw new Error('neck seed is ring-coloured'); labels[s] = neckId; });
    while(stack.length){ const c = stack.pop();
      for(const n of neighbours(c)) if(n >= 0 && labels[n] === ringComp && !ringish(n)){ labels[n] = neckId; stack.push(n); } }
    comps[ringComp].area = 0;
    for(let p = 0; p < N; p++){ if(labels[p] === neckId) comps[neckId].area++; else if(labels[p] === ringComp) comps[ringComp].area++; }
  }

  /* shape colours */
  const samples = new Map();
  for(let p = 0; p < N; p++){ const id = labels[p]; if(!id) continue;
    let s = samples.get(id); if(!s){ s = [[], [], []]; samples.set(id, s); }
    s[0].push(D[p * 4]); s[1].push(D[p * 4 + 1]); s[2].push(D[p * 4 + 2]); }
  for(const [id, s] of samples) comps[id].S = s.map(median);
  const isBlue = S => chroma(oklab(...S)) > 0.08;

  /* name the shapes */
  const groupOfComp = new Map(); const shapeTable = {};
  for(const g of GROUPS) for(const view of Object.keys(GROUP_SHAPES[g])){
    for(const seed of GROUP_SHAPES[g][view]){
      const id = labels[at(...seed)];
      if(!id || comps[id].area < PARAMS.minArea) throw new Error(g + ' seed ' + seed + ' is not inside a shape');
      if(groupOfComp.has(id) && groupOfComp.get(id) !== g) throw new Error('shape at ' + seed + ' claimed by ' + groupOfComp.get(id) + ' and ' + g);
      if((seed[0] < VIEW_SPLIT_X) !== (view === 'front')) throw new Error(g + ' seed ' + seed + ' is on the wrong view');
      groupOfComp.set(id, g);
      (shapeTable[g] = shapeTable[g] || []).push({ view, seed, area: comps[id].area, rgb: comps[id].S, highlighted: isBlue(comps[id].S) });
    }
  }
  const strayBlue = comps.filter(c => c && c.area >= PARAMS.minArea && c.S && isBlue(c.S) && !groupOfComp.has(c.id));
  if(strayBlue.length) throw new Error('blue shapes belong to no group: ' + strayBlue.map(c => c.id).join(','));

  /* tones */
  const toneOf = seed => comps[labels[at(...seed)]].S;
  const T = { cyan: toneOf(TONE_SEEDS.blue.cyan), mid: toneOf(TONE_SEEDS.blue.mid), deep: toneOf(TONE_SEEDS.blue.deep),
              light: toneOf(TONE_SEEDS.grey.light), middle: toneOf(TONE_SEEDS.grey.middle), dark: toneOf(TONE_SEEDS.grey.dark) };
  const ladder = [[T.dark, T.deep], [T.middle, T.mid], [T.light, T.cyan]].map(([g, b]) => ({ g, b, gL: oklab(...g)[0], bLab: oklab(...b) }));
  const neutralToneOf = S => { const L = oklab(...S)[0]; return ladder.reduce((best, r) => Math.abs(r.bLab[0] - L) < Math.abs(best.bLab[0] - L) ? r : best).g; };
  const litToneOf = S => {
    const L = oklab(...S)[0];
    if(L <= ladder[0].gL) return ladder[0].b;
    if(L >= ladder[2].gL) return ladder[2].b;
    const i = L < ladder[1].gL ? 0 : 1, f = (L - ladder[i].gL) / (ladder[i + 1].gL - ladder[i].gL);
    return labToRGB(...[0, 1, 2].map(k => ladder[i].bLab[k] + f * (ladder[i + 1].bLab[k] - ladder[i].bLab[k])));
  };

  /* ownership: shapes reach a few pixels into the navy around them */
  const owner = new Int32Array(N); const step = new Uint8Array(N).fill(255);
  let frontier = [];
  for(let p = 0; p < N; p++){ const id = labels[p]; if(id && comps[id].area >= PARAMS.minArea){ owner[p] = id; step[p] = 0; frontier.push(p); } }
  for(let s = 1; s <= PARAMS.coreSteps; s++){
    const next = [];
    for(const c of frontier) for(const n of neighbours(c)){
      if(n < 0 || step[n] !== 255 || D[n * 4 + 3] < PARAMS.coreMinAlpha) continue;
      step[n] = s; owner[n] = owner[c]; next.push(n);
    }
    frontier = next;
  }
  const coverage = (p, S) => {
    const dx = S[0] - NAVY[0], dy = S[1] - NAVY[1], dz = S[2] - NAVY[2];
    return Math.max(0, Math.min(1, ((D[p * 4] - NAVY[0]) * dx + (D[p * 4 + 1] - NAVY[1]) * dy + (D[p * 4 + 2] - NAVY[2]) * dz) / (dx * dx + dy * dy + dz * dz)));
  };
  const t = new Float32Array(N);
  for(let p = 0; p < N; p++) if(owner[p]) t[p] = coverage(p, comps[owner[p]].S);

  /* inner distance from the edge of each owned region (for the edge style) */
  const dist = new Uint8Array(N).fill(255); let q = [];
  for(let p = 0; p < N; p++){ const id = owner[p]; if(!id) continue;
    if(neighbours(p).some(n => n < 0 || owner[n] !== id)){ dist[p] = 0; q.push(p); } }
  for(let d = 1; q.length && d < 255; d++){ const next = [];
    for(const c of q) for(const n of neighbours(c)) if(n >= 0 && owner[n] === owner[c] && dist[n] === 255){ dist[n] = d; next.push(n); }
    q = next; }

  /* The blue-tinted halo on the silhouette, past the core reach, is owned
     too, so it neutralises and relights. The search walks through anything
     (a pure navy outline often separates a shape from its halo) carrying the
     nearest blue shape, and claims only unowned pixels that are actually
     blue-tinted. */
  const halo = new Uint8Array(N); const via = new Int32Array(N); const seen = new Uint8Array(N);
  frontier = [];
  for(let p = 0; p < N; p++) if(owner[p] && isBlue(comps[owner[p]].S)){ via[p] = owner[p]; seen[p] = 1; frontier.push(p); }
  for(let s = 1; s <= PARAMS.haloSteps; s++){
    const next = [];
    for(const c of frontier) for(const n of neighbours(c)){
      if(n < 0 || seen[n] || D[n * 4 + 3] === 0) continue;
      seen[n] = 1; via[n] = via[c]; next.push(n);
      if(owner[n] || chroma([LAB[n * 3], LAB[n * 3 + 1], LAB[n * 3 + 2]]) < PARAMS.haloMinChroma || LAB[n * 3 + 2] > -0.02) continue;
      const tt = coverage(n, comps[via[c]].S); if(tt <= PARAMS.haloMinT) continue;
      owner[n] = via[c]; t[n] = tt; dist[n] = 0; halo[n] = 1;
    }
    frontier = next;
  }

  /* the art's edge style, measured: mean lightness/chroma offset from the flat mix, by inner distance */
  const idealLab = (p, S) => { const k = t[p]; return oklab(Math.round(NAVY[0] * (1 - k) + S[0] * k), Math.round(NAVY[1] * (1 - k) + S[1] * k), Math.round(NAVY[2] * (1 - k) + S[2] * k)); };
  const style = { grey: [], blue: [] };
  for(const kind of ['grey', 'blue']){
    const acc = Array.from({ length: 13 }, () => ({ n: 0, dL: 0, dC: 0 }));
    for(let p = 0; p < N; p++){ const id = owner[p]; if(!id || halo[p] || comps[id].area < 1000 || (isBlue(comps[id].S) ? 'blue' : 'grey') !== kind) continue;
      const d = Math.min(dist[p], 12), ideal = idealLab(p, comps[id].S);
      acc[d].n++; acc[d].dL += LAB[p * 3] - ideal[0]; acc[d].dC += Math.hypot(LAB[p * 3 + 1], LAB[p * 3 + 2]) - chroma(ideal); }
    const deep = { dL: acc[12].dL / acc[12].n, dC: acc[12].dC / acc[12].n };
    style[kind] = acc.map(e => ({ dL: e.n ? e.dL / e.n - deep.dL : 0, dC: e.n ? e.dC / e.n - deep.dC : 0 }));
  }
  const recolour = (p, S, target, from, to) => {
    const d = Math.min(dist[p], 12), src = idealLab(p, S), dst = idealLab(p, target);
    const actual = [LAB[p * 3], LAB[p * 3 + 1], LAB[p * 3 + 2]];
    const dL = (actual[0] - src[0]) - style[from][d].dL + style[to][d].dL;
    const texC = chroma(actual) - chroma(src) - style[from][d].dC;
    const keep = chroma(src) > 1e-4 ? Math.min(1, chroma(dst) / chroma(src)) : 0;
    const C = Math.max(0, chroma(dst) + texC * keep + style[to][d].dC), h = Math.atan2(dst[2], dst[1]);
    return labToRGB(dst[0] + dL, C * Math.cos(h), C * Math.sin(h));
  };

  /* the neutral base and the lit figure */
  const neutral = new Uint8Array(D); const lit = new Uint8Array(D); const region = new Uint8Array(N);
  for(let p = 0; p < N; p++){
    const id = owner[p]; if(!id) continue;
    const S = comps[id].S, blue = isBlue(S), g = groupOfComp.get(id);
    if(blue){ const c = recolour(p, S, neutralToneOf(S), 'blue', 'grey'); neutral[p * 4] = c[0]; neutral[p * 4 + 1] = c[1]; neutral[p * 4 + 2] = c[2]; }
    if(g){
      region[p] = GROUPS.indexOf(g) + 1;
      if(blue){ lit[p * 4] = D[p * 4]; lit[p * 4 + 1] = D[p * 4 + 1]; lit[p * 4 + 2] = D[p * 4 + 2]; }
      else { const c = recolour(p, S, litToneOf(S), 'grey', 'blue'); lit[p * 4] = c[0]; lit[p * 4 + 1] = c[1]; lit[p * 4 + 2] = c[2]; }
    }
  }

  /* tiles: one per group per view, the bounding box of its owned pixels plus padding */
  const tiles = [];
  for(const g of GROUPS){
    const gi = GROUPS.indexOf(g) + 1;
    for(const view of ['front', 'back']){
      if(!GROUP_SHAPES[g][view]) continue;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for(let p = 0; p < N; p++){ if(region[p] !== gi) continue; const x = p % W, y = (p / W) | 0;
        if((x < VIEW_SPLIT_X) !== (view === 'front')){
          if(!GROUP_SHAPES[g][view === 'front' ? 'back' : 'front']) throw new Error(g + ' owns a pixel on a view it is not drawn on, at ' + x + ',' + y);
          continue;
        }
        if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
      /* Snapped outward to the grid, so a tile's offset in the atlas is a
         whole number of grid cells from where it is drawn. Downscaling
         samples a mip level whose texels are up to a grid cell wide; equal
         phase means a lit tile filters exactly as the base beneath it does,
         so its edges land on the base's edges at every card size. */
      const G = PARAMS.grid;
      x0 = Math.max(0, Math.floor((x0 - PARAMS.tilePad) / G) * G); y0 = Math.max(0, Math.floor((y0 - PARAMS.tilePad) / G) * G);
      x1 = Math.min(W, Math.ceil((x1 + 1 + PARAMS.tilePad) / G) * G); y1 = Math.min(H, Math.ceil((y1 + 1 + PARAMS.tilePad) / G) * G);
      tiles.push({ group: g, view, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }

  /* pack: the base at the top, tiles below on shelves, tallest first, every
     position on the grid and the atlas itself a whole number of grid cells */
  const G = PARAMS.grid, snap = v => Math.ceil(v / G) * G;
  const AW = snap(W);
  const order = tiles.slice().sort((a, b) => b.h - a.h || b.w - a.w || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (a.view < b.view ? -1 : 1));
  let cx = 0, cy = snap(H) + PARAMS.gutter, shelf = 0;
  for(const tl of order){
    if(cx && cx + tl.w > AW){ cx = 0; cy += snap(shelf) + PARAMS.gutter; shelf = 0; }
    tl.ax = cx; tl.ay = cy; cx += snap(tl.w) + PARAMS.gutter; shelf = Math.max(shelf, tl.h);
  }
  const AH = snap(cy + shelf);
  const atlas = new Uint8Array(AW * AH * 4);
  for(let y = 0; y < H; y++) atlas.set(neutral.subarray(y * W * 4, (y + 1) * W * 4), y * AW * 4);
  for(const tl of tiles){
    const gi = GROUPS.indexOf(tl.group) + 1;
    for(let y = 0; y < tl.h; y++) for(let x = 0; x < tl.w; x++){
      const p = at(tl.x + x, tl.y + y); if(region[p] !== gi) continue;
      const o = ((tl.ay + y) * AW + tl.ax + x) * 4;
      atlas[o] = lit[p * 4]; atlas[o + 1] = lit[p * 4 + 1]; atlas[o + 2] = lit[p * 4 + 2]; atlas[o + 3] = D[p * 4 + 3];
    }
  }

  /* symmetry, per group per view: left half against the mirrored right half.
     The axis is the centre of all muscle regions on that view, which is the
     figure's own midline (the silhouette's extremes are the hands, and the
     art does not hold them exactly level). */
  const viewAxis = {};
  for(const view of ['front', 'back']){
    let sx = 0, n = 0;
    for(let p = 0; p < N; p++){ if(!region[p]) continue; const x = p % W; if((x < VIEW_SPLIT_X) !== (view === 'front')) continue; sx += x; n++; }
    viewAxis[view] = sx / n;
  }
  const symmetry = {};
  for(const tl of tiles){
    const gi = GROUPS.indexOf(tl.group) + 1, axis = viewAxis[tl.view];
    const side = [{ n: 0, sx: 0, sy: 0 }, { n: 0, sx: 0, sy: 0 }];
    for(let y = tl.y; y < tl.y + tl.h; y++) for(let x = tl.x; x < tl.x + tl.w; x++){
      if(region[at(x, y)] !== gi) continue; const s = side[x < axis ? 0 : 1]; s.n++; s.sx += Math.abs(x - axis); s.sy += y; }
    symmetry[tl.group + '.' + tl.view] = {
      areaRatio: +(Math.min(side[0].n, side[1].n) / Math.max(side[0].n, side[1].n)).toFixed(4),
      mirroredCentroidDx: +Math.abs(side[0].sx / side[0].n - side[1].sx / side[1].n).toFixed(2),
      centroidDy: +Math.abs(side[0].sy / side[0].n - side[1].sy / side[1].n).toFixed(2)
    };
  }

  return { W, H, AW, AH, atlas, neutral, lit, region, tiles, NAVY, T, style, symmetry, shapeTable, viewAxis,
    haloPixels: halo.reduce((n, v) => n + v, 0) };
}

/* ---------- checks against the master ---------- */

/* straight-alpha source-over onto an opaque ground; `stride` is the width of
   the image the base rows are read from (the atlas is wider than the figure) */
function composite(W, H, base, stride, layers, bg){
  const out = new Float64Array(W * H * 3);
  for(let p = 0; p < W * H; p++){ for(let k = 0; k < 3; k++) out[p * 3 + k] = bg[k]; }
  const over = (p, rgba, o, op) => { const a = rgba[o + 3] / 255 * op; if(!a) return;
    for(let k = 0; k < 3; k++) out[p * 3 + k] = rgba[o + k] * a + out[p * 3 + k] * (1 - a); };
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) over(y * W + x, base, (y * stride + x) * 4, 1);
  for(const L of layers) for(let y = 0; y < L.h; y++) for(let x = 0; x < L.w; x++)
    over((L.y + y) * W + L.x + x, L.rgba, ((L.ay + y) * L.stride + L.ax + x) * 4, L.op);
  return out;
}
function checks(built, master, atlasPixels, label){
  const { W, H, AW, AH, tiles, region } = built; const N = W * H, M = master.rgba;
  let alphaDiffs = 0, highlightLeft = 0, untouchedTint = 0, masterBlue = 0;
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
    const p = y * W + x, o = (y * AW + x) * 4;
    if(atlasPixels[o + 3] !== M[p * 4 + 3]) alphaDiffs++;
    if(M[p * 4 + 3] >= 32 && M[p * 4 + 2] - Math.max(M[p * 4], M[p * 4 + 1]) >= 30) masterBlue++;
    if(atlasPixels[o + 3] >= 32 && atlasPixels[o + 2] - Math.max(atlasPixels[o], atlasPixels[o + 1]) >= 30){
      if(region[p]) highlightLeft++; else untouchedTint++;
    }
  }
  /* lighting exactly what the approved illustration shows reproduces it */
  const approved = ['chest', 'shoulders', 'quads', 'hamstrings', 'glutes', 'calves'];
  const layers = tiles.filter(tl => approved.includes(tl.group)).map(tl => Object.assign({ rgba: atlasPixels, stride: AW, op: 1 }, tl));
  const got = composite(W, H, atlasPixels, AW, layers, PARAMS.surface);
  const want = composite(W, H, M, W, [], PARAMS.surface);
  const diffs = new Float64Array(N); let maxDiff = 0, sum = 0;
  for(let p = 0; p < N; p++){ let d = 0; for(let k = 0; k < 3; k++) d = Math.max(d, Math.abs(got[p * 3 + k] - want[p * 3 + k])); diffs[p] = d; sum += d; if(d > maxDiff) maxDiff = d; }
  const sorted = Float64Array.from(diffs).sort();
  /* no tile paints a pixel its group does not own; no lit pixel leans green */
  let outside = 0, green = 0;
  for(const tl of tiles){ const gi = GROUPS.indexOf(tl.group) + 1;
    for(let y = 0; y < tl.h; y++) for(let x = 0; x < tl.w; x++){
      const o = ((tl.ay + y) * AW + tl.ax + x) * 4; if(!atlasPixels[o + 3]) continue;
      if(region[(tl.y + y) * W + tl.x + x] !== gi) outside++;
      if(atlasPixels[o + 1] > atlasPixels[o + 2] + 2 && atlasPixels[o + 1] > 90) green++;
    } }
  /* nothing in the gutters */
  const inCell = new Uint8Array(AW * AH);
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) inCell[y * AW + x] = 1;
  for(const tl of tiles) for(let y = 0; y < tl.h; y++) for(let x = 0; x < tl.w; x++) inCell[(tl.ay + y) * AW + tl.ax + x] = 1;
  let gutterInk = 0; for(let p = 0; p < AW * AH; p++) if(!inCell[p] && atlasPixels[p * 4 + 3]) gutterInk++;
  return { label, alphaDiffsFromMaster: alphaDiffs, masterBluePixels: masterBlue,
    highlightPixelsLeftInNeutralBase: highlightLeft, blueTintedPixelsTheBuildNeverTouched: untouchedTint,
    approvedReconstruction: { maxChannelDiff: +maxDiff.toFixed(2), meanChannelDiff: +(sum / N).toFixed(4), p999ChannelDiff: +sorted[Math.floor(N * 0.999)].toFixed(2) },
    tilePixelsOutsideTheirGroup: outside, greenLeaningLitPixels: green, gutterPixels: gutterInk };
}

/* ---------- the browser (decode and encode WebP only) ---------- */

function findBrowser(){
  return [process.env.LOOP_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].find(p => p && fs.existsSync(p));
}
async function openBrowser(){
  const exe = findBrowser();
  if(!exe) throw new Error('no Chromium browser found — set LOOP_BROWSER');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-muscle-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for(let i = 0; i < 100 && !targets; i++){
    try{ targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); }
    catch(e){ await new Promise(r => setTimeout(r, 200)); }
  }
  if(!targets) throw new Error('browser did not start');
  const ws = new WebSocket(targets.find(tg => tg.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if(m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if(r.exceptionDetails) throw new Error('browser: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  /* bytes cross the protocol in base64 pieces small enough for any message limit */
  const put = async (name, buf) => {
    const b64 = Buffer.from(buf.buffer ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : buf).toString('base64');
    await evaluate('globalThis.' + name + ' = []');
    for(let i = 0; i < b64.length; i += 4000000) await evaluate('globalThis.' + name + '.push(' + JSON.stringify(b64.slice(i, i + 4000000)) + ')');
    await evaluate('(() => { const s = atob(globalThis.' + name + '.join("")); const u = new Uint8Array(s.length); for(let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); globalThis.' + name + ' = u; return u.length; })()');
  };
  const take = async name => {
    const len = await evaluate('(() => { const u = globalThis.' + name + '; let s = ""; for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); globalThis.' + name + '_b64 = btoa(s); return globalThis.' + name + '_b64.length; })()');
    let b64 = '';
    for(let i = 0; i < len; i += 4000000) b64 += await evaluate('globalThis.' + name + '_b64.slice(' + i + ',' + (i + 4000000) + ')');
    return Buffer.from(b64, 'base64');
  };
  return {
    async decode(bytes){
      await put('src', bytes);
      const dims = await evaluate(`(async () => {
        const bmp = await createImageBitmap(new Blob([globalThis.src]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(bmp, 0, 0); globalThis.px = new Uint8Array(x.getImageData(0, 0, bmp.width, bmp.height).data.buffer);
        return [bmp.width, bmp.height]; })()`);
      return { width: dims[0], height: dims[1], rgba: new Uint8Array(await take('px')) };
    },
    async encodeWebP(width, height, rgba, quality){
      await put('raw', rgba);
      await evaluate(`(async () => {
        const c = new OffscreenCanvas(${width}, ${height}); const x = c.getContext('2d');
        x.putImageData(new ImageData(new Uint8ClampedArray(globalThis.raw.buffer), ${width}, ${height}), 0, 0);
        const blob = await c.convertToBlob({ type: 'image/webp', quality: ${quality} });
        if(blob.type !== 'image/webp') throw new Error('this browser cannot encode WebP');
        globalThis.out = new Uint8Array(await blob.arrayBuffer()); return globalThis.out.length; })()`);
      return take('out');
    },
    async close(){
      try{ await Promise.race([send('Browser.close'), new Promise(r => setTimeout(r, 2000))]); }catch(e){}
      try{ ws.close(); }catch(e){}
      await new Promise(r => setTimeout(r, 600));
      if(process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else{ try{ proc.kill(); }catch(e){} }
      try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
    }
  };
}

/* ---------- the table index.html carries ---------- */

function tableSource(record){
  const tiles = {};
  for(const g of GROUPS) tiles[g] = record.tiles.filter(tl => tl.group === g).map(tl => [tl.x, tl.y, tl.w, tl.h, tl.ax, tl.ay]);
  return 'const MUSCLE_ATLAS = ' + JSON.stringify({ src: record.atlas.file, w: record.atlas.width, h: record.atlas.height,
    baseW: record.base.width, baseH: record.base.height, tiles }) + ';';
}

/* ---------- build ---------- */

async function main(){
  const masterBytes = fs.readFileSync(path.join(ROOT, MASTER));
  const browser = await openBrowser();
  let record;
  try{
    const decoded = await browser.decode(masterBytes);
    const master = { width: decoded.width, height: decoded.height, rgba: decoded.rgba };
    const built = derive(master);
    const before = checks(built, master, built.atlas, 'as derived');
    const webp = await browser.encodeWebP(built.AW, built.AH, built.atlas, PARAMS.quality);
    const back = await browser.decode(webp);
    if(back.width !== built.AW || back.height !== built.AH) throw new Error('encoded atlas decoded at ' + back.width + 'x' + back.height);
    const after = checks(built, master, back.rgba, 'as encoded');
    let encMax = 0, encSum = 0, encN = 0;
    for(let p = 0; p < built.AW * built.AH; p++){ const a = built.atlas[p * 4 + 3]; if(a < 32) continue;
      for(let k = 0; k < 3; k++){ const d = Math.abs(back.rgba[p * 4 + k] - built.atlas[p * 4 + k]); encSum += d; encN++; if(d > encMax) encMax = d; } }
    const regions = encodeGreyPNG(built.W, built.H, built.region);
    fs.writeFileSync(path.join(ROOT, ATLAS), webp);
    fs.writeFileSync(path.join(ROOT, REGIONS), regions);
    record = {
      note: 'Derived from muscle-map.webp by build-muscle-map.js. Rebuild after changing the master or the shapes it names.',
      master: { file: MASTER, sha256: sha256(masterBytes), width: master.width, height: master.height },
      atlas: { file: ATLAS, sha256: sha256(webp), width: built.AW, height: built.AH, bytes: webp.length, quality: PARAMS.quality, grid: PARAMS.grid },
      regions: { file: REGIONS, sha256: sha256(regions), values: 'pixel = 1 + index of the owning group in groups, 0 = no group' },
      base: { x: 0, y: 0, width: built.W, height: built.H },
      groups: GROUPS,
      viewSplitX: VIEW_SPLIT_X,
      tiles: built.tiles.map(tl => ({ group: tl.group, view: tl.view, x: tl.x, y: tl.y, w: tl.w, h: tl.h, ax: tl.ax, ay: tl.ay })),
      shapes: built.shapeTable,
      tones: built.T, navy: built.NAVY,
      checks: { derived: before, encoded: Object.assign(after, { encodeMaxChannelDiff: encMax, encodeMeanChannelDiff: +(encSum / encN).toFixed(4) }),
        symmetry: built.symmetry, haloPixels: built.haloPixels }
    };
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(ROOT, RECORD), JSON.stringify(record, null, 2) + NL);

  const raw = fs.readFileSync(path.join(ROOT, APP), 'utf8');
  const crlf = raw.indexOf('\r\n') !== -1;
  let app = raw.split('\r\n').join(NL);
  const a = app.indexOf(OPEN), b = app.indexOf(CLOSE);
  if(a === -1 || b === -1 || b < a) throw new Error('MUSCLE-ATLAS markers not found in index.html');
  app = app.slice(0, a + OPEN.length) + NL + tableSource(record) + NL + app.slice(b);
  fs.writeFileSync(path.join(ROOT, APP), crlf ? app.split(NL).join('\r\n') : app);

  console.log('  ' + ATLAS + '  ' + record.atlas.width + 'x' + record.atlas.height + '  ' + record.atlas.bytes + ' bytes  q' + PARAMS.quality);
  console.log('  ' + REGIONS + '  ' + fs.statSync(path.join(ROOT, REGIONS)).size + ' bytes');
  console.log('  tiles ' + record.tiles.length + ', halo pixels ' + record.checks.haloPixels);
  console.log('  derived: ' + JSON.stringify(record.checks.derived));
  console.log('  encoded: ' + JSON.stringify(record.checks.encoded));
  console.log('recorded in ' + RECORD + '; table written to index.html');
}

module.exports = { GROUP_SHAPES, GROUPS, VIEW_SPLIT_X, PARAMS, OPEN, CLOSE, ATLAS, REGIONS, RECORD, MASTER, tableSource, decodeGreyPNG, sha256, derive, checks };
if(require.main === module){
  main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
}
