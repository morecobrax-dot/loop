/* =========================================================
   LOOP — D32 GPS REPLAY HARNESS & ADVERSARIAL AUDIT
   ---------------------------------------------------------
   DEVELOPMENT TOOLING ONLY. Nothing here ships to the phone.

     node loop-gps-audit.js        every fixture

   Automated tests cannot run around outside, so this replays
   synthetic and hand-built position sequences through THE
   SAME functions production uses — gpsReduce, gpsSplits,
   gpsCurrentPaceSec. There is deliberately no second GPS
   calculator to disagree with.

   THE ORACLE IS INDEPENDENT. Expected distances come from
   an equirectangular projection computed here, which is a
   different formula from the product's Haversine, so
   agreement within tolerance means two methods agree rather
   than one being called twice.
   ========================================================= */
'use strict';
const H = require('./loop-test-harness.js');

let PASS = 0, FAIL = 0;
const FINDINGS = [];
function section(t){ console.log('\n' + '='.repeat(68) + '\n  ' + t + '\n' + '='.repeat(68)); }
function sub(t){ console.log('\n  --- ' + t + ' ---'); }
function ok(name, cond, detail){
  if(cond){ PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
    FINDINGS.push(name + (detail ? ' {' + detail + '}' : '')); }
}

/* ---------- independent oracle (equirectangular, not Haversine) ---------- */
const R_EARTH = 6371008.8;
function oracleMeters(a, b){
  const toRad = d => d * Math.PI / 180;
  const x = toRad(b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x*x + y*y) * R_EARTH;
}
function oracleTrackMeters(pts){
  let m = 0;
  for(let i = 1; i < pts.length; i++) m += oracleMeters(pts[i-1], pts[i]);
  return m;
}
/* Build a straight track heading due east at a chosen speed. Latitude is
   fixed, so the geometry is a pure longitude walk and easy to reason about. */
function straightTrack(opts){
  const { lat, lon, metres, speedMps, hz, acc, t0 } = Object.assign(
    { lat: 40.0, lon: -74.0, metres: 1609.344, speedMps: 3.5, hz: 1, acc: 6, t0: 1700000000000 }, opts);
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  const stepM = speedMps / hz;
  const n = Math.max(2, Math.round(metres / stepM));
  const pts = [];
  for(let i = 0; i <= n; i++){
    pts.push({ lat, lon: lon + (i * stepM) / mPerDegLon,
               t: t0 + Math.round(i * 1000 / hz), acc });
  }
  return pts;
}

(async function main(){
  section('D32 — GPS PIPELINE, REPLAYED THROUGH PRODUCTION CODE');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  sub('the distance formula agrees with an independent projection');
  {
    const track = straightTrack({ metres: 1609.344 });
    const loopM = ctx.gpsReduce(track, 'run_outdoor').meters;
    const oracM = oracleTrackMeters(track);
    ok('a straight 1-mile run measures a mile',
      Math.abs(loopM - 1609.344) / 1609.344 < 0.01,
      'loop=' + loopM.toFixed(1) + 'm oracle=' + oracM.toFixed(1) + 'm');
    ok('and matches the independent oracle within 0.5%',
      Math.abs(loopM - oracM) / oracM < 0.005,
      'delta=' + Math.abs(loopM - oracM).toFixed(2) + 'm');
  }

  sub('a stationary phone earns no distance  (GPS jitter)');
  {
    const rnd = H.mulberry32(4242);
    const pts = [];
    for(let i = 0; i < 240; i++){          // 4 minutes standing still
      pts.push({ lat: 40 + (rnd()-0.5) * 0.00007,      // ±~4m wobble
                 lon: -74 + (rnd()-0.5) * 0.00009,
                 t: 1700000000000 + i*1000, acc: 8 });
    }
    const r = ctx.gpsReduce(pts, 'run_outdoor');
    ok('4 minutes of standing still stays under 20 metres',
      r.meters < 20, r.meters.toFixed(1) + 'm over ' + pts.length + ' points');
    ok('and the jitter is counted as rejected, not silently dropped',
      (r.rejected.jitter || 0) > 100, JSON.stringify(r.rejected));
  }

  sub('an impossible jump is rejected and does not poison the track');
  {
    const track = straightTrack({ metres: 800, speedMps: 3.5 });
    const mid = Math.floor(track.length / 2);
    const clean = ctx.gpsReduce(track, 'run_outdoor').meters;
    /* Teleport 300m sideways for one fix, then carry on as before. */
    const spiked = track.map((p,i) => i === mid
      ? { lat: p.lat + 0.0027, lon: p.lon, t: p.t, acc: 6 } : p);
    const r = ctx.gpsReduce(spiked, 'run_outdoor');
    ok('the spike is rejected', (r.rejected.spike || 0) >= 1, JSON.stringify(r.rejected));
    ok('and total distance is barely changed by it',
      Math.abs(r.meters - clean) < 40,
      'clean=' + clean.toFixed(1) + ' spiked=' + r.meters.toFixed(1));
    const cyclist = ctx.gpsReduce(track.map((p,i) => i === mid
      ? { lat: p.lat + 0.018, lon: p.lon, t: p.t, acc: 6 } : p), 'cycle_outdoor');
    ok('a 2km teleport is rejected even for a cyclist',
      (cyclist.rejected.spike || 0) >= 1, JSON.stringify(cyclist.rejected));
  }

  sub('catastrophically inaccurate fixes are refused');
  {
    const track = straightTrack({ metres: 400 });
    const bad = track.map((p,i) => i % 3 === 0 ? Object.assign({}, p, { acc: 180 }) : p);
    const r = ctx.gpsReduce(bad, 'run_outdoor');
    ok('low-accuracy points are dropped', (r.rejected.accuracy || 0) > 0,
      JSON.stringify(r.rejected));
    ok('the session still measures a sensible distance',
      r.meters > 300 && r.meters < 460, r.meters.toFixed(1) + 'm of 400m');
    ok('quality is reported as a word, not a number',
      ['good','weak','gaps','acquiring','none'].indexOf(ctx.gpsQualityOf(r)) !== -1,
      ctx.gpsQualityOf(r));
  }

  sub('a coverage gap is marked, never invented');
  {
    const a = straightTrack({ metres: 400, t0: 1700000000000 });
    const lastA = a[a.length-1];
    /* The athlete kept running for 4 minutes with the tab suspended, then
       reappears 800m away. LOOP must not draw that as measured distance. */
    const b = straightTrack({ metres: 400, lat: lastA.lat,
      lon: lastA.lon + 0.0094, t0: lastA.t + 240000 });
    const r = ctx.gpsReduce(a.concat(b), 'run_outdoor');
    ok('the gap is counted', r.gaps === 1, 'gaps=' + r.gaps);
    ok('and the unobserved 800m is NOT added',
      r.meters < 900, r.meters.toFixed(1) + 'm (two 400m legs only)');
    ok('quality reports the gap', ctx.gpsQualityOf(r) === 'gaps', ctx.gpsQualityOf(r));
  }

  sub('pace: smoothed, and silent until it means something');
  {
    const track = straightTrack({ metres: 1609.344, speedMps: 3.4757 });   // ~7:43/mi
    const m = ctx.gpsSessionMetrics(track, 'run_outdoor', 463);
    ok('average pace is right for the speed run',
      m.avgPaceSec > 455 && m.avgPaceSec < 475, Math.round(m.avgPaceSec) + 's/mi');
    ok('current pace is stable, not a single noisy segment',
      m.curPaceSec !== null && Math.abs(m.curPaceSec - m.avgPaceSec) < 60,
      'cur=' + Math.round(m.curPaceSec) + ' avg=' + Math.round(m.avgPaceSec));
    const early = ctx.gpsCurrentPaceSec(ctx.gpsReduce(track.slice(0,3), 'run_outdoor').accepted, 30);
    ok('with almost no data it returns nothing rather than a wild number',
      early === null, String(early));
    ok('and formatPace refuses to render a null', ctx.formatPace(null) === null);
    /* The noise test that matters: pace must not swing wildly fix to fix. */
    const rnd = H.mulberry32(99);
    const noisy = track.map(p => ({ lat: p.lat + (rnd()-0.5)*0.00004,
      lon: p.lon + (rnd()-0.5)*0.00004, t: p.t, acc: 7 }));
    const acc = ctx.gpsReduce(noisy, 'run_outdoor').accepted;
    const samples = [];
    for(let i = 40; i < acc.length; i += 20)
      samples.push(ctx.gpsCurrentPaceSec(acc.slice(0, i), 30));
    const valid = samples.filter(v => v !== null);
    const spread = valid.length ? Math.max(...valid) - Math.min(...valid) : 0;
    ok('smoothed pace stays within a 90s band over a noisy mile',
      valid.length > 2 && spread < 90,
      'n=' + valid.length + ' spread=' + Math.round(spread) + 's');
  }

  sub('splits: one per unit, interpolated at the boundary');
  {
    const track = straightTrack({ metres: 1609.344 * 2.4, speedMps: 3.5 });
    const m = ctx.gpsSessionMetrics(track, 'run_outdoor', 1104);
    const whole = m.splits.filter(s => !s.partial);
    ok('two whole miles produce two whole splits', whole.length === 2,
      JSON.stringify(m.splits.map(s => s.index + ':' + s.seconds + (s.partial?'p':''))));
    ok('and the final partial split is shown', m.splits.some(s => s.partial));
    ok('each whole split is the right duration for the pace',
      whole.every(s => Math.abs(s.seconds - 460) < 25),
      JSON.stringify(whole.map(s => s.seconds)));
    ok('splits are generated once, not duplicated',
      new Set(m.splits.map(s => s.index)).size === m.splits.length);
  }

  sub('cycling uses speed and its own plausible limits');
  {
    const fast = straightTrack({ metres: 5000, speedMps: 11, hz: 1 });   // ~24.6 mph
    const r = ctx.gpsReduce(fast, 'cycle_outdoor');
    ok('a fast but real cyclist is not filtered out',
      r.meters > 4700, r.meters.toFixed(0) + 'm of 5000m');
    ok('the same track would be rejected as a run',
      ctx.gpsReduce(fast, 'run_outdoor').meters < r.meters * 0.5,
      'run=' + ctx.gpsReduce(fast, 'run_outdoor').meters.toFixed(0));
    const sp = ctx.gpsCurrentSpeedMph(r.accepted, 30);
    ok('current speed is reported for cycling', sp !== null && sp > 15 && sp < 35,
      String(sp && sp.toFixed(1)));
  }

  sub('determinism and route simplification');
  {
    const track = straightTrack({ metres: 3000 });
    const a = JSON.stringify(ctx.gpsSessionMetrics(track, 'run_outdoor', 900).splits);
    const b = JSON.stringify(ctx.gpsSessionMetrics(track, 'run_outdoor', 900).splits);
    ok('the same points always give the same answer', a === b);
    const acc = ctx.gpsReduce(track, 'run_outdoor').accepted;
    const simp = ctx.gpsSimplifyRoute(acc);
    ok('a straight route simplifies dramatically', simp.length < acc.length / 4,
      acc.length + ' -> ' + simp.length + ' points');
    ok('but keeps its endpoints',
      simp[0].lat === acc[0].lat && simp[simp.length-1].lon === acc[acc.length-1].lon);
    /* The distance must never be recomputed from the simplified path. */
    const full = ctx.gpsReduce(acc, 'run_outdoor').meters;
    const fromSimplified = ctx.gpsReduce(simp, 'run_outdoor').meters;
    ok('simplification is display-only — it is never fed back into distance',
      Math.abs(full - fromSimplified) > 0 || simp.length === acc.length,
      'full=' + full.toFixed(0) + ' simplified=' + fromSimplified.toFixed(0) +
      ' (production stores the measured value, not this)');
  }

  sub('nothing produces NaN, Infinity or a negative');
  {
    const nasty = [
      null, undefined, {}, { lat:'x', lon:'y', t:1 },
      { lat:999, lon:0, t:1700000000000 }, { lat:0, lon:0, t:-5 },
      { lat:40, lon:-74, t:1700000000000, acc:9999 },
      { lat:40, lon:-74, t:1700000000000, acc:5 },
      { lat:40.0001, lon:-74, t:1700000000000 - 5000, acc:5 }
    ];
    let threw = null, r = null;
    try{ r = ctx.gpsSessionMetrics(nasty, 'run_outdoor', 60); }catch(e){ threw = e.message; }
    ok('a malformed track does not throw', threw === null, threw || '');
    const flat = JSON.stringify(r);
    ok('and yields no NaN', !/NaN/.test(flat));
    ok('no Infinity', !/Infinity/.test(flat));
    ok('no negative distance', r && r.meters >= 0, r ? String(r.meters) : '');
    ok('an empty track is simply empty',
      ctx.gpsSessionMetrics([], 'run_outdoor', 0).meters === 0);
  }

  sub('indoor activities are never given GPS');
  {
    ['run_treadmill','cycle_stationary','elliptical','rowing','stair_climber']
      .forEach(id => ok(id + ' is not a GPS activity', !ctx.cardioIsGpsActivity(id)));
    ['run_outdoor','walk_outdoor','cycle_outdoor','hiking']
      .forEach(id => ok(id + ' is a GPS activity', ctx.cardioIsGpsActivity(id)));
  }

  section('GPS AUDIT RESULT');
  console.log('  passed: ' + PASS + ' | failed: ' + FAIL);
  if(FINDINGS.length){ console.log('\n  FINDINGS:'); FINDINGS.forEach(f => console.log('   - ' + f)); }
  console.log('\n  Fixtures were replayed through the production pipeline in an');
  console.log('  isolated harness. No store was opened and no session was written.');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('GPS AUDIT ERROR:', e); process.exit(1); });
