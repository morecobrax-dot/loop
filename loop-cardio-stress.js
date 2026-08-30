/* D32 lifecycle stress — 20 sessions of start/pause/resume/finish against the
   real functions, counting every resource the session is supposed to release. */
const path = 'C:/Users/Jacob/Desktop/Claude Coding Projects/loop/';
const H = require(path + 'loop-test-harness.js');
const api = (H.loadApp || H.load || H.buildApp || H.default)();
const A = api.app || api.ctx || api;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if(c) { pass++; } else { fail++; console.log('  FAIL ' + n + (d ? ' :: ' + d : '')); } };

/* Instrumented navigator: every watch and lock is counted, never faked away. */
let watchId = 0, live = new Set(), lockCount = 0, lockLive = 0;
let onPos = null;
const g = A.globalThis || A;
g.navigator = {
  geolocation: {
    watchPosition(cb) { onPos = cb; const id = ++watchId; live.add(id); return id; },
    clearWatch(id) { live.delete(id); },
    getCurrentPosition(cb) { cb({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: Date.now() }); }
  },
  wakeLock: { request() { lockCount++; lockLive++;
    return Promise.resolve({ release() { lockLive--; }, addEventListener() {} }); } }
};
g.document = g.document || {};
g.document.visibilityState = 'visible';

/* Each activity moves at a speed it could actually move at — a walker at a
   runner's pace is correctly rejected as a spike, and that is the filter
   working, not a bug to engineer around. */
const ids = ['run_outdoor', 'cycle_outdoor', 'walk_outdoor', 'hiking', 'rucking', 'run_treadmill'];
const MPS = { run_outdoor:3.1, cycle_outdoor:7.5, walk_outdoor:1.4, hiking:1.1, rucking:1.3, run_treadmill:3 };
let maxWatches = 0;

for (let i = 0; i < 20; i++) {
  const id = ids[i % ids.length];
  A.cardioSession = null;
  A.startCardioActivity(id);
  ok('s' + i + ' session created', !!A.cardioSession, id);
  const gps = A.cardioIsGpsActivity(id);
  ok('s' + i + ' watch iff outdoor', (live.size > 0) === gps, id + ' watches=' + live.size);
  maxWatches = Math.max(maxWatches, live.size);

  if (gps && onPos) {
    const t0 = Date.now();
    for (let k = 0; k < 12; k++)
      onPos({ coords: { latitude: 40 + k * (MPS[id] * 3 / 111320), longitude: -74, accuracy: 6 }, timestamp: t0 + k * 3000 });
  }
  const before = A.cardioGpsMetrics(A.cardioSession);
  const mBefore = before ? before.meters : 0;

  A.toggleCardioPause();
  ok('s' + i + ' paused', A.cardioSession.state === 'paused');
  ok('s' + i + ' no watch while paused', live.size === 0, 'watches=' + live.size);

  /* A fix arriving while paused must change nothing at all. */
  if (gps && onPos) onPos({ coords: { latitude: 41, longitude: -75, accuracy: 6 }, timestamp: Date.now() });
  const during = A.cardioGpsMetrics(A.cardioSession);
  ok('s' + i + ' paused adds no distance', (during ? during.meters : 0) === mBefore,
    (during ? during.meters : 0) + ' vs ' + mBefore);

  A.toggleCardioPause();
  ok('s' + i + ' resumed', A.cardioSession.state === 'running');
  ok('s' + i + ' one watch on resume', live.size === (gps ? 1 : 0), 'watches=' + live.size);
  maxWatches = Math.max(maxWatches, live.size);

  if (gps && onPos) {
    const t1 = Date.now() + 600000;   // ten minutes later: the pause is a break
    for (let k = 0; k < 6; k++)
      onPos({ coords: { latitude: 41 + k * (MPS[id] * 3 / 111320), longitude: -75, accuracy: 6 }, timestamp: t1 + k * 3000 });
    const after = A.cardioGpsMetrics(A.cardioSession);
    ok('s' + i + ' pause not bridged', after.meters < mBefore + 400,
      'meters=' + Math.round(after.meters) + ' before=' + Math.round(mBefore));
  }

  A.finishCardioSession();
  ok('s' + i + ' finished', A.cardioSession.state === 'finished');
  ok('s' + i + ' watch released', live.size === 0, 'watches=' + live.size);

  const rec = A.cardioSessionToRecord();
  ok('s' + i + ' record saved', !!rec && !!rec.duration);
  if (gps) {
    ok('s' + i + ' measured source', rec.distanceSource === 'gps', String(rec.distanceSource));
    ok('s' + i + ' route stored', Array.isArray(rec.route) && rec.route.length > 1);
  } else {
    ok('s' + i + ' indoor never gps', !rec.distanceSource || rec.distanceSource === 'manual');
    ok('s' + i + ' indoor no route', !rec.route);
  }
}

/* The wake-lock request is asynchronous. Asserting without letting the
   microtask queue drain would measure the queue, not the invariant. */
(async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  ok('never more than one watcher', maxWatches <= 1, 'peak=' + maxWatches);
  ok('no watcher leaked', live.size === 0, 'live=' + live.size);
  ok('no wake lock leaked', lockLive === 0, 'held=' + lockLive);
  ok('wake locks were taken', lockCount > 0, 'count=' + lockCount);
  
  console.log('\n  passed: ' + pass + ' | failed: ' + fail);
  process.exit(fail ? 1 : 0);
})();