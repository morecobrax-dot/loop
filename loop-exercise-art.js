/* =========================================================
   LOOP — EXERCISE ART  (Phase B)
   ---------------------------------------------------------
   One drawing for every exercise LOOP can prescribe, and one
   renderer that draws all of them. Source of truth for the
   copy vendored into index.html between the
   LOOP-EXERCISE-ART-BEGIN / END markers — edit here, then run

       node sync-exercise-art.js

   A contract holds the two copies byte-identical, and
   exercise-art.html reviews exactly what the app draws.

   WHAT IS IN HERE, AND WHAT IS NOT. Drawings, the names that
   reach them, and the one-to-three cues shown beside them.
   Nothing here decides what an athlete trains: the plan
   libraries, the program generator and the substitution
   engine own that, and this file reads none of them. It
   reads no user data, writes none, and makes no request.

   KEYS. A canonical exercise is drawn under its canonical id,
   so the drawing follows the same identity history uses.
   Names LOOP prescribes that the registry does not catalogue
   are listed by normalised name in byName, along with the
   handful of aliases that share an id for history but are a
   visibly different movement (a Pendlay row is not a bent-
   over row, a glute bridge is not a hip thrust). Nothing is
   guessed: a name that reaches no drawing gets no picture.
   ========================================================= */

/* ---------------------------------------------------------
   THE RENDERER
   ---------------------------------------------------------
   A movement is DATA — two poses, the equipment it uses and the
   joint whose path tells the story — and this turns it into a small
   inline SVG in LOOP's own figure language: rounded neutral limbs
   with a lighter edge (the same mannequin the warm-up figures use),
   steel-toned equipment, and one restrained cyan stroke for the
   motion. No raster, no network, no copied art.

   THE FIGURE IS SOLVED, NOT DRAWN. Every pose is a set of segment
   ANGLES on fixed bone lengths, so no drawing can grow a long arm
   or a short shin — the failure of the discarded anatomy work was
   geometry placed point by point. One contact is PINNED (feet on
   the floor, hips on a bench, hands on a bar) and the rest of the
   body hangs from it.

   ANGLES. 0 points down, 90 points the way the figure faces, 180
   points up, -90 points behind. The same for every segment, so a
   pose reads the way a coach would describe it. Front views use
   the same numbers, with 90 meaning "out to the side".

   TWO POSITIONS. The key pose is drawn solid; the other is a faint
   ghost, and the cyan path traces the working joint from start to
   finish with an arrowhead, so the direction of effort is never
   ambiguous. A thumbnail keeps only limb ghosts — a whole second
   body at 44 pixels is noise.
   --------------------------------------------------------- */
var ExerciseArt = (function(){
'use strict';

var G = 106;                                   // floor
var B = { torso:25, neck:3.2, head:5.4, ua:14, fa:12.5, th:19.5, sh:18.5, ft:7.4 };
var W = { torso:12.4, torsoF:16.5, neck:5, ua:6.4, fa:5.4, th:8.8, sh:6.8, ft:4, edge:1.6 };
var C = {
  nearCore:'#4F5A6B', nearEdge:'#7A879C',
  farCore:'#313946',  farEdge:'#4B5566',
  torsoCore:'#485365', torsoEdge:'#727F95',
  metal:'#A7B1C1', metalDim:'#6C7788',
  plate:'#232A34', plateEdge:'#8C97A8',
  pad:'#2A313C', padEdge:'#586478',
  frame:'#39424F', frameEdge:'#5C6879',
  cable:'#A3B3CA', band:'#8193AE',
  ground:'#2A313B', accent:'#4CC2FF'
};

function rad(a){ return a * Math.PI / 180; }
function mv(p, a, l){ return [p[0] + Math.sin(rad(a)) * l, p[1] + Math.cos(rad(a)) * l]; }
function n1(v){ return Math.round(v * 10) / 10; }
/* Tenths as text, built from integers: the same characters n1() prints, without
   converting a fractional number to a string for every point of every path. */
function f1(t){
  if(t < 0) return '-' + f1(-t);
  var r = t % 10;
  return r ? ((t - r) / 10) + '.' + r : '' + (t / 10);
}
function P(p){ return f1(Math.round(p[0] * 10)) + ' ' + f1(Math.round(p[1] * 10)); }
/* A body path's point: formatted exactly as P() formats it, and recorded in
   the extent of the chain being drawn (see chainPath), so the frame can take
   the figure's size without parsing its markup back out. */
var CHAIN_BOX = [Infinity, Infinity, -Infinity, -Infinity], FIG_BOX = null;
function PB(p){
  var tx = Math.round(p[0] * 10), ty = Math.round(p[1] * 10), x = tx / 10, y = ty / 10, b = CHAIN_BOX;
  if(x < b[0]) b[0] = x; if(x > b[2]) b[2] = x;
  if(y < b[1]) b[1] = y; if(y > b[3]) b[3] = y;
  return f1(tx) + ' ' + f1(ty);
}
function growFigure(x0, y0, x1, y1){
  if(!FIG_BOX) return;
  if(x0 < FIG_BOX[0]) FIG_BOX[0] = x0; if(y0 < FIG_BOX[1]) FIG_BOX[1] = y0;
  if(x1 > FIG_BOX[2]) FIG_BOX[2] = x1; if(y1 > FIG_BOX[3]) FIG_BOX[3] = y1;
}
function lerp(a, b, t){ return a + (b - a) * t; }
function lerpAng(a, b, t){ var d = b - a; while(d > 180) d -= 360; while(d < -180) d += 360; return a + d * t; }
function angleOf(a, b){ return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; }

/* ---------- poses ---------- */
var SIDE_DEFAULT = { hip:[58, 66], trunk:180, nua:4, nfa:2, fua:-4, ffa:-2,
  nth:0, nsh:0, fth:0, fsh:0, nft:90, fft:90 };
var FRONT_DEFAULT = { cx:60, hipY:66, lean:0, la:8, lfa:6, ra:8, rfa:6,
  lth:5, lsh:2, rth:5, rsh:2 };

function merged(base, p){
  var q = {}; var k;
  for(k in base) q[k] = base[k];
  for(k in p) q[k] = p[k];
  return q;
}
function sideJoints(p){
  var q = merged(SIDE_DEFAULT, p);
  var J = { view:'side' };
  J.hip = q.hip.slice();
  J.sh = mv(J.hip, q.trunk, B.torso);
  var na = q.neck == null ? q.trunk : q.neck;
  J.nk = mv(J.sh, na, B.neck);
  J.head = mv(J.nk, na, B.head + 0.6);
  J.nE = mv(J.sh, q.nua, B.ua * (q.nuaS || 1));  J.nW = mv(J.nE, q.nfa, B.fa * (q.nfaS || 1));
  J.fE = mv(J.sh, q.fua, B.ua * (q.fuaS || 1));  J.fW = mv(J.fE, q.ffa, B.fa * (q.ffaS || 1));
  J.nK = mv(J.hip, q.nth, B.th); J.nA = mv(J.nK, q.nsh, B.sh); J.nT = mv(J.nA, q.nft, B.ft);
  J.fK = mv(J.hip, q.fth, B.th); J.fA = mv(J.fK, q.fsh, B.sh); J.fT = mv(J.fA, q.fft, B.ft);
  /* Contact points equipment sits on, all relative to the torso's own angle. */
  J.back  = mv(J.sh, q.trunk + 90, 5.6);                        // a bar across the upper back
  J.rack  = mv(mv(J.sh, q.trunk - 90, 5.2), q.trunk, -1.5);    // a bar in the front rack
  J.chest = mv(mv(J.hip, q.trunk, B.torso * 0.62), q.trunk - 90, 6.4);
  J.lap   = mv(mv(J.hip, q.trunk, 2), q.trunk - 90, 6.6);      // across the hips, front side
  J.belt  = mv(J.hip, q.trunk + 180, 7);                        // a plate hanging from a belt
  J.mid = [(J.nW[0] + J.fW[0]) / 2, (J.nW[1] + J.fW[1]) / 2];
  J.q = q;
  return pinned(J, q.pin);
}
function frontJoints(p){
  var q = merged(FRONT_DEFAULT, p);
  var J = { view:'front' };
  var hc = [q.cx, q.hipY];
  var sc = mv(hc, 180 - q.lean, B.torso * (q.torsoScale || 1));
  J.hc = hc; J.sc = sc;
  var sw = q.sw || 8.2, hw = q.hw || 4.8;
  J.lS = [sc[0] - sw, sc[1] + 1 - (q.shrug || 0)]; J.rS = [sc[0] + sw, sc[1] + 1 - (q.shrug || 0)];
  J.lH = [hc[0] - hw, hc[1]];     J.rH = [hc[0] + hw, hc[1]];
  J.nk = mv(sc, 180 - q.lean + (q.neckTilt || 0), B.neck);
  J.head = mv(J.nk, 180 - q.lean + (q.neckTilt || 0), B.head + 0.6);
  /* Outward is negative x on the viewer's left and positive on the right. */
  var ua = B.ua * (q.uaScale || 1), fa = B.fa * (q.faScale || 1);
  J.lE = mv(J.lS, -q.la, ua);  J.lW = mv(J.lE, -q.lfa, B.fa * (q.lfaS || q.faScale || 1));
  J.rE = mv(J.rS,  q.ra, ua);  J.rW = mv(J.rE,  q.rfa, B.fa * (q.rfaS || q.faScale || 1));
  var th = B.th * (q.thighScale || 1);
  var sh = B.sh * (q.shinScale || 1);
  J.lK = mv(J.lH, -q.lth, th); J.lA = mv(J.lK, -q.lsh, sh);
  J.rK = mv(J.rH,  q.rth, th); J.rA = mv(J.rK,  q.rsh, sh);
  J.lT = [J.lA[0] - 4.2, J.lA[1] + 0.6]; J.rT = [J.rA[0] + 4.2, J.rA[1] + 0.6];
  J.mid = [(J.lW[0] + J.rW[0]) / 2, (J.lW[1] + J.rW[1]) / 2];
  J.lap = [hc[0], hc[1] - 3];
  J.chest = mv(hc, 180 - q.lean, B.torso * 0.72);
  J.q = q;
  if(q.rot) rotated(J, hc, q.rot);
  return pinned(J, q.pin);
}
/* A pose names ONE contact that must not move — feet on the floor, hands on a
   bar, hips on a bench — and the whole figure is translated to honour it. The
   angles decide the shape; the pin decides where it is. */
function pinned(J, pin){
  if(!pin) return J;
  var at = J[pin[0]]; if(!at) return J;
  var dx = pin[1][0] - at[0], dy = pin[1][1] - at[1];
  for(var k in J){ var v = J[k]; if(Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') J[k] = [v[0] + dx, v[1] + dy]; }
  return J;
}
/* Top-down views of a lying athlete are the front view turned on its side. */
function rotated(J, c, deg){
  var r = rad(deg), cs = Math.cos(r), sn = Math.sin(r);
  for(var k in J){ var v = J[k]; if(Array.isArray(v) && v.length === 2 && typeof v[0] === 'number'){
    var x = v[0] - c[0], y = v[1] - c[1]; J[k] = [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; } }
  J.rot = deg;
  return J;
}
function solve(view, pose){ return view === 'front' ? frontJoints(pose) : sideJoints(pose); }

/* In-between poses mix ANGLES, so a traced joint follows the arc it really
   travels and every bone keeps its length along the way. */
/* Pose keys that are lengths or positions, mixed straight rather than round the circle. */
var LINEAR_KEYS = { cx:1, hipY:1, sw:1, hw:1, shrug:1, torsoScale:1, thighScale:1, shinScale:1, uaScale:1, faScale:1, lfaS:1, rfaS:1, nuaS:1, nfaS:1, fuaS:1, ffaS:1 };
function mixPose(view, a, b, t){
  var base = view === 'front' ? FRONT_DEFAULT : SIDE_DEFAULT;
  var out = {}; var k, keys = {};
  for(k in base) keys[k] = 1; for(k in a) keys[k] = 1; for(k in b) keys[k] = 1;
  for(k in keys){
    var va = a[k] != null ? a[k] : base[k], vb = b[k] != null ? b[k] : base[k];
    if(va == null || vb == null){ out[k] = va != null ? va : vb; continue; }
    if(k === 'pin') out[k] = [va[0], [lerp(va[1][0], vb[1][0], t), lerp(va[1][1], vb[1][1], t)]];
    else if(Array.isArray(va)) out[k] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
    else if(typeof va === 'number' && LINEAR_KEYS[k] === 1) out[k] = lerp(va, vb, t);
    else if(typeof va === 'number') out[k] = lerpAng(va, vb, t);
    else out[k] = t < 0.5 ? va : vb;
  }
  return out;
}

/* ---------- body ---------- */
/* THE FIGURE IS DRAWN FROM SHAPES (D59). Phase B drew every bone as a stroke
   of one width with a round end and its own outline: a knee, an ankle or an
   elbow showed as a circle, an ankle was as thick as a calf and a wrist as
   thick as a forearm — people assembled from capsules.

   Each segment is now a closed silhouette laid along its bone from a short
   PROFILE: how far the body reaches on either side of the bone at a few
   stations. A thigh carries its mass high and narrows into the knee, a calf
   swells behind the shin and thins to a small ankle, an upper arm tapers from
   the shoulder to the elbow and a forearm to the wrist; the trunk has a chest,
   a waist and a seat.

   A chain — a leg, an arm, the trunk and neck — is ONE path. Its outline is
   painted under its fill, so the fill covers every seam inside the chain and
   only the outside edge shows: a limb reads as one limb, with no bubble at the
   joint. Bone lengths, poses and every joint are exactly what they were; this
   changes how a body is drawn, never where it is. */

/* [t along the bone, +90 side, -90 side]. In the side view the +90 side of a
   limb is the front of the body, of the trunk and neck the back, of the foot
   its top. Front-view profiles are [t, outer, inner]. Values are half-widths. */
var PROFILE = {
  trunk: [[0, 5.6, 4.4], [0.13, 6.4, 4.7], [0.42, 4.8, 4.8], [0.72, 5.6, 6.1], [0.9, 5.9, 6.3], [1, 5.3, 5.4]],
  neck:  [[0, 2.7, 2.5], [1, 2.2, 2.1]],
  th:    [[0, 4.5, 5.1], [0.3, 5.0, 4.6], [0.72, 3.9, 3.6], [1, 3.2, 3.15]],
  sh:    [[0, 3.1, 3.3], [0.3, 2.9, 4.5], [0.68, 2.2, 2.8], [1, 1.55, 1.8]],
  foot:  [[0, 1.3, 1.7], [0.22, 2.4, 1.7], [0.72, 1.45, 1.7], [1, 0.95, 1.35]],
  ua:    [[0, 3.4, 3.5], [0.3, 3.35, 3.55], [0.64, 3.0, 2.8], [1, 2.2, 2.3]],
  fa:    [[0, 2.3, 2.35], [0.3, 2.7, 2.5], [1, 1.35, 1.4]]
};
var PROFILE_FRONT = {
  th:   [[0, 3.2, 3.8], [0.25, 4.1, 4.1], [0.72, 3.6, 3.3], [1, 3.2, 3.0]],
  sh:   [[0, 3.2, 3.1], [0.32, 3.9, 4.1], [0.72, 2.5, 2.6], [1, 1.6, 1.6]],
  ua:   [[0, 3.8, 2.8], [0.28, 3.9, 3.1], [0.66, 2.9, 2.8], [1, 2.4, 2.3]],
  fa:   [[0, 2.5, 2.3], [0.3, 2.85, 2.5], [1, 1.45, 1.4]],
  foot: [[0, 1.9, 1.9], [0.7, 1.55, 1.55], [1, 1.1, 1.1]],
  neck: [[0, 2.7, 2.7], [1, 2.2, 2.2]]
};
var HAND_R = 1.95;

/* One segment's silhouette, clockwise, as quadratic curves only — every number
   in the path is a point, which is what bounds() reads. `plusFirst` puts the
   profile's first width on the +90 side of the bone; `capA`/`capB` flatten the
   round ends (1 is a half circle). */
function segmentPath(a, b, prof, plusFirst, capA, capB, scale){
  var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
  if(L < 0.05) return '';
  var ux = dx / L, uy = dy / L, nx = uy, ny = -ux, k = prof.length, plus = [], minus = [], i;
  for(i = 0; i < k; i++){
    var t = prof[i][0], wp = (plusFirst ? prof[i][1] : prof[i][2]) * scale, wm = (plusFirst ? prof[i][2] : prof[i][1]) * scale;
    var cx = a[0] + dx * t, cy = a[1] + dy * t;
    plus.push([cx + nx * wp, cy + ny * wp]);
    minus.push([cx - nx * wm, cy - ny * wm]);
  }
  var c0 = (prof[0][1] + prof[0][2]) / 2 * scale * capA, c1 = (prof[k - 1][1] + prof[k - 1][2]) / 2 * scale * capB;
  return 'M' + PB(plus[0]) + sidePath(plus) + capPath(plus[k - 1], minus[k - 1], ux, uy, c1) +
    sidePath(minus.slice().reverse()) + capPath(minus[0], plus[0], -ux, -uy, c0) + 'Z';
}
/* A smooth side through the stations: the inner stations are control points
   and the curve passes through the midpoints between them. */
function sidePath(q){
  var n = q.length, s = '';
  if(n === 2) return 'L' + PB(q[1]);
  for(var i = 1; i < n - 1; i++){
    var end = i === n - 2 ? q[n - 1] : [(q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2];
    s += 'Q' + PB(q[i]) + ' ' + PB(end);
  }
  return s;
}
/* The round end of a segment, from one side to the other, reaching `c` past it. */
function capPath(from, to, ux, uy, c){
  var tip = [(from[0] + to[0]) / 2 + ux * c, (from[1] + to[1]) / 2 + uy * c];
  return 'Q' + PB([from[0] + ux * c, from[1] + uy * c]) + ' ' + PB(tip) + 'T' + PB(to);
}
/* A small closed round (a hand), clockwise, in quadratic curves. */
function roundPath(c, r){
  var x = c[0], y = c[1];
  return 'M' + PB([x - r, y]) + 'Q' + PB([x - r, y - r]) + ' ' + PB([x, y - r]) + 'T' + PB([x + r, y]) + 'T' + PB([x, y + r]) + 'T' + PB([x - r, y]) + 'Z';
}
/* The foot runs from behind the ankle (the heel) to the toe. */
function footPath(ankle, toe, prof, plusFirst, scale){
  var dx = toe[0] - ankle[0], dy = toe[1] - ankle[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
  var heel = [ankle[0] - dx / L * 2, ankle[1] - dy / L * 2];
  return segmentPath(heel, toe, prof, plusFirst, 1, 0.85, scale);
}
/* The trunk seen from the front: shoulders, lats, waist, hips and seat, laid
   on the actual shoulder and hip joints so a lean, a shrug, a foreshortened
   hinge or a figure lying on the floor all carry it with them. */
function torsoFrontPath(J){
  var hc = J.hc, sc = J.sc, lS = J.lS, rS = J.rS, lH = J.lH, rH = J.rH;
  var ux = sc[0] - hc[0], uy = sc[1] - hc[1], U = Math.sqrt(ux * ux + uy * uy) || 1;
  var vx = rS[0] - lS[0], vy = rS[1] - lS[1], V = Math.sqrt(vx * vx + vy * vy) || 1;
  ux /= U; uy /= U; vx /= V; vy /= V;
  var at = function(p, up, right){ return [p[0] + ux * up + vx * right, p[1] + uy * up + vy * right]; };
  var mix = function(p, q, t){ return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
  var q = [
    at(lS, 1.6, 1.3), at(sc, 2.4, 0), at(rS, 1.6, -1.3), at(rS, -0.8, 2.3),
    at(mix(rS, rH, 0.36), 0, 1.2), at(mix(rS, rH, 0.7), 0, 1.4), at(rH, -0.8, 2.8), at(rH, -3.2, 1.6),
    at(hc, -3.8, 0),
    at(lH, -3.2, -1.6), at(lH, -0.8, -2.8), at(mix(lS, lH, 0.7), 0, -1.4), at(mix(lS, lH, 0.36), 0, -1.2), at(lS, -0.8, -2.3)
  ];
  var n = q.length, mid = function(i){ var a = q[i % n], b = q[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  var s = 'M' + PB(mid(n - 1));
  for(var i = 0; i < n; i++) s += 'Q' + PB(q[i]) + ' ' + PB(mid(i));
  return s + 'Z';
}
/* A chain is drawn once: fill over its own outline. A second position is one
   flat silhouette. */
function chainPath(d, core, edge, ghost){
  var b = CHAIN_BOX, w = ghost ? 0.4 : 0.8;          // half the outline's width
  CHAIN_BOX = [Infinity, Infinity, -Infinity, -Infinity];
  if(!d) return '';
  growFigure(b[0] - w, b[1] - w, b[2] + w, b[3] + w);
  return ghost
    ? '<path d="' + d + '" fill="' + edge + '" stroke="' + edge + '" stroke-width="0.8"/>'
    : '<path d="' + d + '" fill="' + core + '" stroke="' + edge + '" stroke-width="1.6" paint-order="stroke"/>';
}
function headDot(c, core, edge){
  var x = n1(c[0]), y = n1(c[1]), r = B.head + 0.8;
  growFigure(x - r, y - r, x + r, y + r);
  return '<circle cx="' + x + '" cy="' + y + '" r="' + B.head + '" fill="' + core +
    '" stroke="' + edge + '" stroke-width="1.5"/>';
}
/* parts: 'all' | 'arms' | 'legs' | 'nearArm' */
function figure(J, tone, parts){
  parts = parts || 'all';
  var ghost = tone === 'ghost';
  var all = parts === 'all', arms = all || parts === 'arms' || parts === 'nearArm', legs = all || parts === 'legs';
  var s = '', near = [C.nearCore, C.nearEdge], far = [C.farCore, C.farEdge], tor = [C.torsoCore, C.torsoEdge];
  var draw = function(d, tone2){ return chainPath(d, tone2[0], tone2[1], ghost); };
  if(J.view === 'side'){
    /* A face-down drawing mirrors front and back, so a calf stays behind a shin. */
    var pf = !J.flip, F = PROFILE;
    var arm = function(E, Wr, sc){
      return segmentPath(J.sh, E, F.ua, pf, 0.9, 1, sc) + segmentPath(E, Wr, F.fa, pf, 1, 1, sc) + roundPath(Wr, HAND_R * sc);
    };
    var leg = function(K, A, T, sc){
      return segmentPath(J.hip, K, F.th, pf, 0.8, 1, sc) + segmentPath(K, A, F.sh, pf, 1, 1, sc) + footPath(A, T, F.foot, pf, sc);
    };
    if(arms && parts !== 'nearArm') s += draw(arm(J.fE, J.fW, 0.96), far);
    if(legs) s += draw(leg(J.fK, J.fA, J.fT, 0.96), far);
    if(all){
      s += draw(segmentPath(J.hip, J.sh, F.trunk, pf, 0.62, 0.34, 1) + segmentPath(J.sh, J.nk, F.neck, pf, 1, 1, 1), tor);
      s += ghost ? headDot(J.head, C.nearEdge, C.nearEdge) : headDot(J.head, near[0], near[1]);
    }
    if(legs) s += draw(leg(J.nK, J.nA, J.nT, 1), near);
    if(arms) s += draw(arm(J.nE, J.nW, 1), near);
  } else {
    var FF = PROFILE_FRONT;
    /* Which side of a front-view limb is its outer side: away from the body's midline. */
    var outerFirst = function(a, b, centre){
      var dx = b[0] - a[0], dy = b[1] - a[1];
      return dy * ((a[0] + b[0]) / 2 - centre[0]) - dx * ((a[1] + b[1]) / 2 - centre[1]) >= 0;
    };
    var limb = function(a, b, prof, centre, capA){ return segmentPath(a, b, prof, outerFirst(a, b, centre), capA, 1, 1); };
    var armF = function(S, E, Wr){ return limb(S, E, FF.ua, J.sc, 0.9) + limb(E, Wr, FF.fa, J.sc, 1) + roundPath(Wr, HAND_R + 0.05); };
    var legF = function(H, K, A, T){ return limb(H, K, FF.th, J.hc, 0.8) + limb(K, A, FF.sh, J.hc, 1) + segmentPath(A, T, FF.foot, true, 1, 0.85, 1); };
    if(legs) s += draw(legF(J.lH, J.lK, J.lA, J.lT), near) + draw(legF(J.rH, J.rK, J.rA, J.rT), near);
    if(all){
      s += draw(torsoFrontPath(J) + segmentPath(J.sc, J.nk, FF.neck, true, 1, 1, 1), tor);
      s += ghost ? headDot(J.head, C.nearEdge, C.nearEdge) : headDot(J.head, near[0], near[1]);
    }
    if(arms) s += draw(armF(J.lS, J.lE, J.lW), near) + draw(armF(J.rS, J.rE, J.rW), near);
  }
  return s;
}

/* ---------- equipment ---------- */
/* A point equipment attaches to: a joint by name, a fixed [x, y], or a place
   ON a limb — { seg:['nK', 'nA'], t:0.8, n:6 } is 80% of the way from knee
   to ankle and 6 off the limb to its left, so a roller or an arm pad turns
   with the limb it rests on. */
function jp(J, ref){
  if(typeof ref === 'string') return J[ref];
  if(ref && ref.seg){
    var a = J[ref.seg[0]], b = J[ref.seg[1]], t = ref.t == null ? 0.5 : ref.t;
    var p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    return ref.n ? mv(p, angleOf(a, b) + 90, ref.n) : p;
  }
  return ref;
}
/* The two ends of a straight piece. `off` moves it sideways off its own line
   (positive is to the right of a->b, so behind a back drawn hip->shoulder);
   `extA`/`extB` stretch it past either end. */
function ends(J, o){
  var a = off(jp(J, o.a), o.adx, o.ady), b = off(jp(J, o.b), o.bdx, o.bdy);
  var ang = angleOf(a, b);
  if(o.off){ a = mv(a, ang + 90, o.off); b = mv(b, ang + 90, o.off); }
  if(o.extA) a = mv(a, ang + 180, o.extA);
  if(o.extB) b = mv(b, ang, o.extB);
  return [a, b];
}
function off(p, dx, dy){ return [p[0] + (dx || 0), p[1] + (dy || 0)]; }
function circle(c, r, fill, stroke, sw){
  return '<circle cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + n1(r) + '" fill="' + fill + '"' +
    (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1.4) + '"' : '') + '/>';
}
function line(a, b, stroke, w){
  return '<path d="M' + P(a) + 'L' + P(b) + '" stroke="' + stroke + '" stroke-width="' + n1(w) + '"/>';
}
function rect(x, y, w, h, fill, stroke, rx){
  return '<rect x="' + n1(x) + '" y="' + n1(y) + '" width="' + n1(w) + '" height="' + n1(h) + '" rx="' + (rx == null ? 1.6 : rx) +
    '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.2"/>';
}
var PROPS = {
  /* From the side a barbell is its plate: a disc centred on the bar. */
  plate: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy), r = o.r || 8.4;
    return circle(c, r, C.plate, C.plateEdge, 1.5) + circle(c, 1.7, C.metal);
  },
  /* A small change plate held in the hands or lying on the body. */
  disc: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy), r = o.r || 5;
    return circle(c, r, C.plate, C.plateEdge, 1.4) + circle(c, 1.2, C.metal);
  },
  /* From the front: the bar across both hands, plates at its ends. */
  barFront: function(J, o){
    var c = o.at ? off(jp(J, o.at), o.dx, o.dy) : off(J.mid, o.dx, o.dy);
    var half = o.half || 30, pr = o.pr || 9, a = 90 + (J.rot || 0);
    var s = line(mv(c, a, half), mv(c, a + 180, half), C.metal, 2.2);
    if(o.plates !== false) [-1, 1].forEach(function(sd){
      var pc = mv(c, a, sd * (half - 3));
      s += line(mv(pc, a + 90, pr), mv(pc, a - 90, pr), C.plateEdge, 5.6) + line(mv(pc, a + 90, pr - 0.8), mv(pc, a - 90, pr - 0.8), C.plate, 3.4);
    });
    return s;
  },
  /* A dumbbell whose handle runs into the page shows one round head. */
  dbFace: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy);
    return circle(c, o.r || 4.4, C.plate, C.metal, 1.5);
  },
  /* A dumbbell seen along its length. `a` is the handle's angle. */
  db: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy), L = o.len || 5.6, hw = o.hw || 6.2;
    var a = o.along ? J.q[o.along] + (o.aoff || 0) : (o.a == null ? 90 : o.a);
    if(o.ahead) c = mv(c, a, o.ahead);
    var p1 = mv(c, a, L), p2 = mv(c, a + 180, L);
    var head = function(p){
      var d = 'M' + P(mv(p, a, 1.6)) + 'L' + P(mv(p, a + 180, 1.6));
      return '<path d="' + d + '" stroke="' + C.metal + '" stroke-width="' + hw + '"/>' +
             '<path d="' + d + '" stroke="' + C.plate + '" stroke-width="' + n1(hw - 2.6) + '"/>';
    };
    return line(p1, p2, C.metal, 1.8) + head(p1) + head(p2);
  },
  kettlebell: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy);
    var down = o.inverted ? -1 : 1;
    var b = [c[0], c[1] + 6.6 * down];
    return '<path d="M' + P([c[0] - 3.4, c[1] + 3 * down]) + 'Q' + P([c[0], c[1] - 3.6 * down]) + ' ' + P([c[0] + 3.4, c[1] + 3 * down]) +
      '" stroke="' + C.metal + '" stroke-width="1.8"/>' + circle(b, 5.2, C.plate, C.metal, 1.5);
  },
  medball: function(J, o){
    var c = off(jp(J, o.at), o.dx, o.dy), r = o.r || 5.6;
    return circle(c, r, C.plate, C.metal, 1.5) +
      '<path d="M' + P([c[0] - r, c[1]]) + 'Q' + P([c[0], c[1] - r * 0.6]) + ' ' + P([c[0] + r, c[1]]) + '" stroke="' + C.metalDim + '" stroke-width="1"/>';
  },
  /* A cable machine column, its pulley and the line to the hands. */
  column: function(J, o){
    var top = o.top != null ? o.top : 14;
    return rect(o.x - 4, top, 8, G - top, C.frame, C.frameEdge, 1.5);
  },
  cable: function(J, o){
    var a = o.from, h = off(jp(J, o.to), o.dx, o.dy);
    var s = circle(a, 2.6, C.frame, C.metal, 1.3) + line(a, h, C.cable, 1.1);
    var ang = angleOf(a, h);
    if(o.grip === 'rope') s += line(h, mv(h, ang + 26, 5), C.metal, 1.8) + line(h, mv(h, ang - 26, 5), C.metal, 1.8);
    else if(o.grip === 'bar') s += line(mv(h, ang + 90, 5.5), mv(h, ang - 90, 5.5), C.metal, 2.1);
    else s += circle(h, 2, 'none', C.metal, 1.4);
    return s;
  },
  band: function(J, o){
    var a = off(jp(J, o.from), o.fdx, o.fdy), h = off(jp(J, o.to), o.dx, o.dy);
    var mid = [(a[0] + h[0]) / 2 + (o.bowX || 0), (a[1] + h[1]) / 2 + (o.bowY || 0)];
    return '<path d="M' + P(a) + 'Q' + P(mid) + ' ' + P(h) + '" stroke="' + C.band + '" stroke-width="1.9"/>';
  },
  anchor: function(J, o){ return circle(o.at, 2, C.metal); },
  strap: function(J, o){
    var a = o.from, h = off(jp(J, o.to), o.dx, o.dy);
    return line(a, h, C.band, 1.6) + circle(a, 1.9, C.metal);
  },
  /* A flat bench: pad on two legs. */
  bench: function(J, o){
    var h = o.h || 4.6;
    var s = line([o.x1 + 4, o.y + h], [o.x1 + 4, G], C.frameEdge, 2) + line([o.x2 - 4, o.y + h], [o.x2 - 4, G], C.frameEdge, 2);
    return s + rect(o.x1, o.y, o.x2 - o.x1, h, C.pad, C.padEdge, 2);
  },
  /* A pad between two points — incline backs, preacher pads, machine seats. */
  pad: function(J, o){
    var e = ends(J, o), a = e[0], b = e[1], w = o.w || 4.8;
    return '<path d="M' + P(a) + 'L' + P(b) + '" stroke="' + C.padEdge + '" stroke-width="' + n1(w + 1.4) + '"/>' +
           '<path d="M' + P(a) + 'L' + P(b) + '" stroke="' + C.pad + '" stroke-width="' + n1(w) + '"/>';
  },
  post: function(J, o){ var e = ends(J, o); return line(e[0], e[1], C.frameEdge, o.w || 2.2); },
  rail: function(J, o){ var e = ends(J, o); return line(e[0], e[1], C.frame, o.w || 3); },
  box: function(J, o){ return rect(o.x, o.y, o.w, o.h, C.pad, C.padEdge, 1.6); },
  /* A lever from a fixed pivot to a moving contact, with an optional roller. */
  lever: function(J, o){
    var a = o.pivot, h = off(jp(J, o.to), o.dx, o.dy);
    return line(a, h, C.metalDim, 2.4) + circle(a, 2.2, C.frame, C.metal, 1.2) +
      (o.roller ? circle(h, o.roller, C.pad, C.padEdge, 1.2) : '') +
      (o.handle ? circle(h, 1.9, C.metal) : '');
  },
  stack: function(J, o){
    var w = o.w || 9;
    return rect(o.x, o.y, w, G - o.y, C.frame, C.frameEdge, 1.4) +
      line([o.x + 2, o.y + 6], [o.x + w - 2, o.y + 6], C.frameEdge, 1) + line([o.x + 2, o.y + 10], [o.x + w - 2, o.y + 10], C.frameEdge, 1);
  },
  /* A fixed bar seen end-on: pull-up bar, dip handle. */
  bar: function(J, o){ return circle(jp(J, o.at), o.r || 2.5, C.metal); },
  rod: function(J, o){ var e = ends(J, o); return line(e[0], e[1], o.c === 'dim' ? C.metalDim : C.metal, o.w || 2); },
  rope: function(J, o){
    var h = jp(J, o.from), a = o.to, amp = o.amp || 4, steps = o.steps || 6, d = 'M' + P(h);
    for(var i = 1; i <= steps; i++){
      var t = i / steps;
      d += 'L' + P([lerp(h[0], a[0], t), lerp(h[1], a[1], t) + (i % 2 ? -amp : amp) * (1 - t * 0.55)]);
    }
    return '<path d="' + d + '" stroke="' + C.band + '" stroke-width="2"/>' + circle(a, 2, C.metal);
  },
  sled: function(J, o){
    var x = o.x, y = o.y || G - 9;
    return rect(x, y, o.w || 16, 9, C.pad, C.padEdge, 1.2) + line([x + 3, y], [x + 1, y - 18], C.metalDim, 2.4) +
      line([x + 13, y], [x + 11, y - 18], C.metalDim, 2.4) + rect(x + 3, y - 6, 9, 6, C.plate, C.plateEdge, 1);
  },
  wheel: function(J, o){ var c = off(jp(J, o.at), o.dx, o.dy); return circle(c, 4.4, C.plate, C.metal, 1.6) + circle(c, 1.2, C.metal); },
  wall: function(J, o){ return rect(o.x, o.top || 20, 5, G - (o.top || 20), C.frame, C.frameEdge, 0.8); },
  mat: function(J, o){ return rect(o.x, o.y, o.w, o.h, C.pad, C.padEdge, 3); },
  step: function(J, o){ return rect(o.x, G - (o.h || 5), o.w || 14, o.h || 5, C.pad, C.padEdge, 1); },
  /* A box or plinth whose top sits under a joint (box squats, step-ups, seats). */
  plinth: function(J, o){
    var p = off(jp(J, o.at), o.dx, o.dy), w = o.w || 16;
    return rect(p[0] - w / 2, p[1], w, G - p[1], C.pad, C.padEdge, 1.6);
  },
  /* A vertical guide rail through a joint (Smith machine). */
  guide: function(J, o){
    var x = jp(J, o.at)[0] + (o.dx || 0);
    return line([x, o.top == null ? 8 : o.top], [x, G], C.frameEdge, o.w || 2.6);
  }
};
/* Draw a list of props; `kept`, when given, collects each prop's markup by
   type so the arrow's safe zones can be read from what was actually drawn. */
function drawProps(J, list, kept){
  var s = '';
  (list || []).forEach(function(pr){
    var fn = PROPS[pr[0]]; if(!fn) return;
    var m = fn(J, pr[1] || {});
    if(kept) kept.push([pr[0], m]);
    s += m;
  });
  return s;
}

/* ---------- motion ---------- */
/* ARCHETYPES. The kind of movement decides how its arrow is drawn, so the
   same kind of lift is annotated the same way on every drawing.

     press       a load driven in a line — presses, rows, pulls: a straight
                 arrow beside the line the load travels
     hinge       the hips carry a load up and down the legs: a straight arrow
                 beside the load path, clear of the legs
     arc         a limb turning about one joint — curls, raises, flys,
                 extensions: a curved arrow outside the arc
     cable       the same, where a cable or band carries the load: the arrow
                 keeps clear of the line as well as the limb
     machine     a handle, pad or sled the machine guides: the arrow follows
                 the machine's own path
     dynamic     the body itself moves — push-ups, squats, crunches, jumps:
                 the arrow follows the joint that tells the story
     locomotion  the athlete travels: one arrow at ground level ahead of
                 whatever leads, never over the head
     hold        a position held still: no arrow at all, only a small hold
                 mark in a clear corner

   `arch` names it on every definition. `path` can override the geometry it
   implies: 'trace' (the joint's true arc, angles mixed), 'line' (straight,
   start to finish), 'pivot' (an arc about a fixed machine pivot) or
   'flight' (take-off to landing). */
var ARCH_PATH = { press:'line', hinge:'line', arc:'trace', cable:'trace', machine:'line', dynamic:'trace', locomotion:null, hold:null };
function archetypeOf(def){
  if(def.arch && ARCH_PATH.hasOwnProperty(def.arch)) return def.arch;
  if(def.hold) return 'hold';
  if(def.travel) return 'locomotion';
  return 'dynamic';
}
function dist(a, b){ var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
function trackAt(def, pose){
  var p = jp(solve(def.view, pose), def.track);
  return def.trackOffset ? off(p, def.trackOffset[0], def.trackOffset[1]) : p;
}
/* The path's shape and direction, before it is placed. */
function pathShape(def){
  var mode = def.path || ARCH_PATH[archetypeOf(def)] || 'trace';
  var a = trackAt(def, def.start), b = trackAt(def, def.end), pts = [], i, u, v;
  if(mode === 'line') return [a, b];
  if(mode === 'pivot'){
    var c = def.pivot, r = dist(c, a);
    var t0 = Math.atan2(a[1] - c[1], a[0] - c[0]), dt = Math.atan2(b[1] - c[1], b[0] - c[0]) - t0;
    while(dt > Math.PI) dt -= 2 * Math.PI;
    while(dt < -Math.PI) dt += 2 * Math.PI;
    for(i = 0; i <= 12; i++) pts.push([c[0] + Math.cos(t0 + dt * i / 12) * r, c[1] + Math.sin(t0 + dt * i / 12) * r]);
    return pts;
  }
  if(mode === 'flight'){
    var m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - (def.flight || 14) * 2];
    for(i = 0; i <= 12; i++){ u = i / 12; v = 1 - u; pts.push([v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]); }
    return pts;
  }
  for(i = 0; i <= 12; i++) pts.push(trackAt(def, mixPose(def.view, def.start, def.end, i / 12)));
  return pts;
}

/* Polylines by arc length. */
function cumul(p){ var c = [0]; for(var i = 1; i < p.length; i++) c.push(c[i - 1] + dist(p[i - 1], p[i])); return c; }
function pointAt(p, c, s){
  var i = 1;
  while(i < p.length - 1 && c[i] < s) i++;
  var span = c[i] - c[i - 1], t = span ? (s - c[i - 1]) / span : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [lerp(p[i - 1][0], p[i][0], t), lerp(p[i - 1][1], p[i][1], t)];
}
function between(p, c, s0, s1, n){
  var out = [];
  for(var k = 0; k < n; k++) out.push(pointAt(p, c, s0 + (s1 - s0) * k / (n - 1)));
  return out;
}
/* A movement too small to carry an arrowhead is drawn at the shortest length
   that can: the path grows along its own ends, so it still points true. */
function lengthened(p, want){
  var L = cumul(p)[p.length - 1];
  if(L >= want || L < 0.3) return p;
  var e = (want - L) / 2, a = p[0], a2 = p[1], b = p[p.length - 1], b2 = p[p.length - 2];
  var da = dist(a2, a) || 1, db = dist(b2, b) || 1;
  return [[a[0] + (a[0] - a2[0]) / da * e, a[1] + (a[1] - a2[1]) / da * e]].concat(p,
    [[b[0] + (b[0] - b2[0]) / db * e, b[1] + (b[1] - b2[1]) / db * e]]);
}
/* Slide a path sideways along its own normal. A curve pushed past its own
   centre folds over itself, and that candidate is refused. */
function shifted(p, d){
  if(!d) return p;
  var out = [], i;
  for(i = 0; i < p.length; i++){
    var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
    out.push([p[i][0] - ty / l * d, p[i][1] + tx / l * d]);
  }
  for(i = 1; i < p.length; i++){
    if((out[i][0] - out[i - 1][0]) * (p[i][0] - p[i - 1][0]) + (out[i][1] - out[i - 1][1]) * (p[i][1] - p[i - 1][1]) <= 0) return null;
  }
  return out;
}

/* SAFE ZONES. What an arrow must keep clear of, each with a weight: the face
   most of all, then the load and the working joint, the torso, the machine,
   the limbs, and the faint second position least. Equipment is read from the
   drawing itself, so a new prop is protected the moment it is drawn. */
var PROP_WEIGHT = { plate:4, disc:4, dbFace:4, db:4, kettlebell:4, medball:4, wheel:4,
  pad:2.6, lever:2.6, bar:2.6, bench:2.2, sled:2.2, rod:2.2,
  column:1.8, stack:1.8, rail:1.8, box:1.8, plinth:1.8, post:1.6, step:1.6, wall:1.6, guide:1.4, mat:1,
  cable:1.6, band:1.6, strap:1.4, rope:1.4, anchor:1.4 };
function shapesOf(markup, w, list){
  var m, i, re = /<path d="([^"]+)"[^>]*?stroke-width="([\d.]+)"/g;
  while((m = re.exec(markup))){
    var nums = (m[1].match(/-?\d+(\.\d+)?/g) || []).map(parseFloat), r = parseFloat(m[2]) / 2 + 0.4;
    if(nums.length === 2) list.push({ a:[nums[0], nums[1]], b:[nums[0], nums[1]], r:r, w:w });
    for(i = 2; i + 1 < nums.length; i += 2) list.push({ a:[nums[i - 2], nums[i - 1]], b:[nums[i], nums[i + 1]], r:r, w:w });
  }
  re = /<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g;
  while((m = re.exec(markup))){ var c = [parseFloat(m[1]), parseFloat(m[2])]; list.push({ a:c, b:c, r:parseFloat(m[3]) + 0.7, w:w }); }
  re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  while((m = re.exec(markup))){
    var x = parseFloat(m[1]), y = parseFloat(m[2]);
    list.push({ box:[x - 0.6, y - 0.6, x + parseFloat(m[3]) + 0.6, y + parseFloat(m[4]) + 0.6], w:w });
  }
}
function propShapes(drawn, scale, list){
  drawn.forEach(function(d){ shapesOf(d[1], (PROP_WEIGHT[d[0]] || 1.6) * scale, list); });
}
function bodyShapes(J, parts, scale, list){
  function cap(a, b, width, w){ list.push({ a:a, b:b, r:width / 2 + 0.8, w:w * scale }); }
  var all = parts === 'all', arms = all || parts === 'arms', legs = all || parts === 'legs';
  if(J.view === 'side'){
    if(arms){ cap(J.sh, J.nE, W.ua, 2.4); cap(J.nE, J.nW, W.fa, 2.4); cap(J.sh, J.fE, W.ua, 1.8); cap(J.fE, J.fW, W.fa, 1.8); }
    if(legs){
      cap(J.hip, J.nK, W.th, 2); cap(J.nK, J.nA, W.sh, 2); cap(J.nA, J.nT, W.ft, 1.2);
      cap(J.hip, J.fK, W.th, 1.6); cap(J.fK, J.fA, W.sh, 1.6); cap(J.fA, J.fT, W.ft, 1);
    }
    if(all){ cap(J.hip, J.sh, W.torso, 3); cap(J.sh, J.head, W.neck, 3); cap(J.head, J.head, B.head * 2, 7); }
  } else {
    if(arms){ cap(J.lS, J.lE, W.ua, 2.4); cap(J.lE, J.lW, W.fa, 2.4); cap(J.rS, J.rE, W.ua, 2.4); cap(J.rE, J.rW, W.fa, 2.4); }
    if(legs){
      cap(J.lH, J.lK, W.th, 2); cap(J.lK, J.lA, W.sh, 2); cap(J.lA, J.lT, W.ft, 1.2);
      cap(J.rH, J.rK, W.th, 2); cap(J.rK, J.rA, W.sh, 2); cap(J.rA, J.rT, W.ft, 1.2);
    }
    if(all){ cap(J.hc, J.sc, W.torsoF, 3); cap(J.lS, J.rS, 7.2, 3); cap(J.lH, J.rH, 8, 3); cap(J.sc, J.head, W.neck, 3); cap(J.head, J.head, B.head * 2, 7); }
  }
}
function sceneShapes(def, J, O, ghostParts, drawn, ghostDrawn){
  var list = [];
  propShapes(drawn, 1, list);
  bodyShapes(J, 'all', 1, list);
  if(O && ghostParts !== 'none'){ bodyShapes(O, ghostParts, 0.35, list); propShapes(ghostDrawn, 0.35, list); }
  if(def.track) [J, O].forEach(function(X){ if(X){ var p = jp(X, def.track); list.push({ a:p, b:p, r:2.6, w:3 }); } });
  list.forEach(function(sh){
    sh.bb = sh.box ? sh.box : [Math.min(sh.a[0], sh.b[0]) - sh.r, Math.min(sh.a[1], sh.b[1]) - sh.r, Math.max(sh.a[0], sh.b[0]) + sh.r, Math.max(sh.a[1], sh.b[1]) + sh.r];
  });
  return list;
}
/* Only the shapes near a candidate can touch it. */
function nearby(pts, shapes, gap){
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, out = [];
  for(i = 0; i < pts.length; i++){
    if(pts[i][0] < x0) x0 = pts[i][0]; if(pts[i][0] > x1) x1 = pts[i][0];
    if(pts[i][1] < y0) y0 = pts[i][1]; if(pts[i][1] > y1) y1 = pts[i][1];
  }
  x0 -= gap; y0 -= gap; x1 += gap; y1 += gap;
  for(i = 0; i < shapes.length; i++){
    var b = shapes[i].bb;
    if(b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0) out.push(shapes[i]);
  }
  return out;
}
function clearanceTo(p, sh){
  if(sh.box){
    var bx = Math.max(sh.box[0] - p[0], 0, p[0] - sh.box[2]), by = Math.max(sh.box[1] - p[1], 0, p[1] - sh.box[3]);
    return Math.sqrt(bx * bx + by * by);
  }
  var ax = sh.a[0], ay = sh.a[1], vx = sh.b[0] - ax, vy = sh.b[1] - ay, wx = p[0] - ax, wy = p[1] - ay, L = vx * vx + vy * vy;
  var t = L ? (wx * vx + wy * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  var ex = wx - vx * t, ey = wy - vy * t;
  return Math.sqrt(ex * ex + ey * ey) - sh.r;
}
/* Mean weighted intrusion of a set of points into the protected shapes. */
function intrusion(pts, shapes, gap){
  var s = 0;
  for(var i = 0; i < pts.length; i++){
    for(var j = 0; j < shapes.length; j++){
      var d = clearanceTo(pts[i], shapes[j]);
      if(d < gap) s += shapes[j].w * (gap - d);
    }
  }
  return s / pts.length;
}

/* The arrow's own proportions, per size. `gap` is the clear space it keeps. */
var ARROW = {
  full:  { w:1.9, head:3, gap:3.4, min:15, max:44, pad:7 },
  thumb: { w:3,   head:3.8, gap:2.4, min:17, max:48, pad:3 }
};
function arrowHead(b, ang, hw){
  var tip = mv(b, ang, hw), l = mv(b, ang + 150, hw * 1.2), r = mv(b, ang - 150, hw * 1.2);
  return '<path d="M' + P(l) + 'L' + P(tip) + 'L' + P(r) + 'Z" fill="' + C.accent + '" stroke="' + C.accent + '" stroke-width="0.8"/>';
}
function headPoints(q, both, hw){
  var n = q.length, e = q[n - 1], a = angleOf(q[Math.max(0, n - 3)], e), pts = [mv(e, a, hw), mv(e, a + 150, hw * 1.2), mv(e, a - 150, hw * 1.2)];
  if(both){ var s0 = q[0], b = angleOf(q[Math.min(n - 1, 2)], s0); pts.push(mv(s0, b, hw), mv(s0, b + 150, hw * 1.2), mv(s0, b - 150, hw * 1.2)); }
  return pts;
}
function arrowMarkup(q, both, size){
  var S = ARROW[size], n = q.length, straight = true, i;
  for(i = 1; i < n - 1 && straight; i++){
    var ax = q[n - 1][0] - q[0][0], ay = q[n - 1][1] - q[0][1], l = Math.sqrt(ax * ax + ay * ay) || 1;
    if(Math.abs((q[i][0] - q[0][0]) * ay - (q[i][1] - q[0][1]) * ax) / l > 0.35) straight = false;
  }
  var pts = straight ? [q[0], q[n - 1]] : q, d = 'M' + P(pts[0]);
  for(i = 1; i < pts.length; i++) d += 'L' + P(pts[i]);
  var s = '<path d="' + d + '" stroke="' + C.accent + '" stroke-width="' + S.w + '"/>' + arrowHead(q[n - 1], angleOf(q[Math.max(0, n - 3)], q[n - 1]), S.head);
  if(both) s += arrowHead(q[0], angleOf(q[Math.min(n - 1, 2)], q[0]), S.head);
  return s;
}
/* How far a point strays outside the frame the drawing already needs. */
function outside(p, frame){
  var m = frame.inset, x0 = frame.x + m, y0 = frame.y + m, x1 = frame.x + frame.side - m, y1 = frame.y + frame.side - m;
  return Math.max(x0 - p[0], 0, p[0] - x1) + Math.max(y0 - p[1], 0, p[1] - y1);
}
/* Place the arrow: every trim of the path's length and every sideways slide,
   scored on what it would cover, how far it moved from the true path, how
   much of the path it gave up, and whether it would widen the frame. The
   smallest honest change wins. A definition may pin the side, the slide or
   the trim when the movement needs saying one particular way. */
function placeArrow(def, shapes, frame, size){
  var S = ARROW[size], o = def.arrow || {};
  var p = lengthened(pathShape(def), S.min), c = cumul(p), L = c[c.length - 1];
  if(!(L > 0.5)) return '';
  var both = !!def.both, keepMax = Math.min(1, S.max / L), wins = [], seen = {};
  var trims = o.trim ? [o.trim] : [[0, 1], [0.1, 0.9], [0.2, 0.8], [0, 0.75], [0.25, 1], [0.4, 1]];
  /* A long sweep keeps its middle and its finish, at a length that still reads. */
  if(!o.trim && keepMax < 1) trims = trims.concat([[0.5 - keepMax * 0.38, 0.5 + keepMax * 0.38], [1 - keepMax * 0.76, 1]]);
  trims.forEach(function(w){
    var k = Math.min(w[1] - w[0], keepMax), mid = (w[0] + w[1]) / 2;
    var s0 = Math.max(0, Math.min(1 - k, mid - k / 2)), key = s0.toFixed(3) + ':' + k.toFixed(3);
    if(k * L < Math.min(S.min, L) - 0.01 || seen[key]) return;
    seen[key] = 1; wins.push([s0, s0 + k]);
  });
  if(!wins.length) wins.push([0, 1]);          // a trim that would leave too little to carry a head
  var sides = o.side ? [o.side] : [1, -1], floor = def.ground !== false;
  var best = null, bestScore = Infinity, bestAt = null, bases = {};
  /* Candidates are scored on nine points; the winner is drawn from sixteen. */
  function baseFor(wi, n){
    var key = wi + ':' + (n || 9);
    if(bases[key]) return bases[key];
    var w = wins[wi], base = between(p, c, w[0] * L, w[1] * L, n || 9);
    if(o.shift) base = base.map(function(pt){ return [pt[0] + o.shift[0], pt[1] + o.shift[1]]; });
    return (bases[key] = base);
  }
  function tryOne(wi, d, sd){
    if(d < 0 || (!d && sd < 0)) return;
    var w = wins[wi], fixed = 0.012 * d * d + 3 * (1 - (w[1] - w[0]));
    if(fixed >= bestScore) return;
    var q = shifted(baseFor(wi), d * sd);
    if(!q) return;
    var pts = q.concat(headPoints(q, both, S.head)), out = 0, n = pts.length, i, j, len = 0;
    for(i = 0; i < n; i++) out += outside(pts[i], frame) + (floor ? 40 * Math.max(0, pts[i][1] - (G - 3)) : 0);
    for(i = 1; i < q.length; i++) len += dist(q[i - 1], q[i]);
    /* Sliding a curve outward lengthens it; past the cap it costs. */
    var score = fixed + 3 * out / n + (len > S.max ? 0.6 * (len - S.max) : 0);
    if(score >= bestScore) return;
    /* The scene's cost, point by point, abandoned as soon as it cannot win. */
    var near = nearby(pts, shapes, S.gap), k = 11 / n;
    for(i = 0; i < n && score < bestScore; i++){
      for(j = 0; j < near.length; j++){
        var dd = clearanceTo(pts[i], near[j]);
        if(dd < S.gap) score += k * near[j].w * (S.gap - dd);
      }
    }
    if(score < bestScore - 1e-9){ bestScore = score; best = q; bestAt = [wi, d, sd]; }
  }
  /* Coarse: a few trims and slides on both sides. Fine: every trim, and the
     slides either side of the coarse winner. */
  var slides = o.slide != null ? [].concat(o.slide) : [0, 5, 10, 16, 23];
  var coarseWins = [0, 2, 4].filter(function(i){ return i < wins.length; });
  if(!coarseWins.length) coarseWins = [0];
  coarseWins.forEach(function(wi){ slides.forEach(function(d){ sides.forEach(function(sd){ tryOne(wi, d, sd); }); }); });
  if(bestAt && o.slide == null){
    var d0 = bestAt[1], sd0 = bestAt[2] || 1;
    wins.forEach(function(w, wi){ [d0 - 2.5, d0, d0 + 2.5, d0 + 5].forEach(function(d){ tryOne(wi, d, sd0); }); });
  }
  if(!best) return '';
  var fine = shifted(baseFor(bestAt[0], 16), bestAt[1] * (bestAt[2] || 1));
  return arrowMarkup(fine || best, both, size);
}
/* Locomotion: the athlete, or the sled, travels. The arrow sits at ground
   level ahead of whatever leads in the direction of travel. */
function travelArrow(def, shapes, size){
  var t = def.travel || {}, S = ARROW[size], dir = t.dir < 0 ? -1 : 1, y = t.y != null ? t.y : G - 6;
  var len = t.len || 18, gap = (t.gap || 5) + S.head, lead = null;
  shapes.forEach(function(sh){
    var xs;
    if(sh.box){ if(sh.box[3] < y - 4 || sh.box[1] > y + 4) return; xs = [sh.box[0], sh.box[2]]; }
    else {
      if(Math.max(sh.a[1], sh.b[1]) + sh.r < y - 4 || Math.min(sh.a[1], sh.b[1]) - sh.r > y + 4) return;
      xs = [Math.min(sh.a[0], sh.b[0]) - sh.r, Math.max(sh.a[0], sh.b[0]) + sh.r];
    }
    var x = dir > 0 ? xs[1] : xs[0];
    if(lead === null || (dir > 0 ? x > lead : x < lead)) lead = x;
  });
  if(lead === null) lead = 60;
  return arrowMarkup([[lead + dir * gap, y], [lead + dir * (gap + len), y]], false, size);
}
/* A static hold: a small hold mark beside the figure, in the nearest clear
   space above or beside it — never against the face, never adrift in a corner. */
function holdMark(frame, shapes, size){
  var thumb = size === 'thumb', h = thumb ? 9 : 7, g = thumb ? 4.6 : 4.4, b = frame.box, lift = thumb ? 4 : 6;
  var spots = [[(b[0] + b[2]) / 2 - g / 2, b[1] - h - lift], [b[2] - g - 6, b[1] - h - lift], [b[0] + 6, b[1] - h - lift], [b[2] + lift, b[1]], [b[0] - g - lift, b[1]],
    [frame.x + frame.side - frame.inset - g, frame.y + frame.inset]];
  var best = spots[0], bestPen = Infinity;
  spots.forEach(function(s, i){
    var pts = [[s[0], s[1]], [s[0], s[1] + h], [s[0] + g, s[1]], [s[0] + g, s[1] + h]], out = 0;
    pts.forEach(function(p){ out += outside(p, frame); });
    var pen = 10 * intrusion(pts, shapes, 4.5) + 3 * out / 4 + i * 0.05;
    if(pen < bestPen - 1e-9){ bestPen = pen; best = s; }
  });
  return '<path d="M' + P(best) + 'L' + P([best[0], best[1] + h]) + 'M' + P([best[0] + g, best[1]]) + 'L' + P([best[0] + g, best[1] + h]) +
    '" stroke="' + C.accent + '" stroke-width="' + (thumb ? 2.8 : 2.2) + '"/>';
}

/* ---------- framing ---------- */
function bounds(markup, seed){
  var x0 = seed ? seed[0] : Infinity, y0 = seed ? seed[1] : Infinity, x1 = seed ? seed[2] : -Infinity, y1 = seed ? seed[3] : -Infinity;
  function take(x, y, r){ r = r || 0; if(x - r < x0) x0 = x - r; if(y - r < y0) y0 = y - r; if(x + r > x1) x1 = x + r; if(y + r > y1) y1 = y + r; }
  var m, re = /<path d="([^"]+)"[^>]*?stroke-width="([\d.]+)"/g;
  while((m = re.exec(markup))){
    var nums = m[1].match(/-?\d+(\.\d+)?/g) || [], w = parseFloat(m[2]) / 2;
    for(var i = 0; i + 1 < nums.length; i += 2) take(parseFloat(nums[i]), parseFloat(nums[i + 1]), w);
  }
  re = /<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g;
  while((m = re.exec(markup))) take(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]) + 0.8);
  re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  while((m = re.exec(markup))){ take(parseFloat(m[1]), parseFloat(m[2]), 0.8); take(parseFloat(m[1]) + parseFloat(m[3]), parseFloat(m[2]) + parseFloat(m[4]), 0.8); }
  if(x0 === Infinity) return [0, 0, 120, 120];
  return [x0, y0, x1, y1];
}
/* A square frame around a box, padded. A thumbnail of arm work frames the
   upper body: the legs carry no information there and cost the arms half
   their size. */
function framed(box, def, J, size){
  var thumb = size === 'thumb', b = box.slice();
  if(thumb && def.crop === 'upper') b[3] = Math.min(b[3], (J.view === 'side' ? J.hip[1] : J.hc[1]) + 14);
  if(thumb && def.crop === 'lower') b[1] = Math.max(b[1], (J.view === 'side' ? J.hip[1] : J.hc[1]) - 8);
  var pad = ARROW[size].pad, side = Math.max(b[2] - b[0], b[3] - b[1], thumb ? 40 : 58) + pad * 2;
  return { x:(b[0] + b[2]) / 2 - side / 2, y:(b[1] + b[3]) / 2 - side / 2, side:side, inset:pad + 1.5, box:b };
}

/* ---------- the one public entry ---------- */
/* The arrow and hold mark depend only on the drawing and the size, so each
   is placed once and remembered. */
var PLACED = typeof WeakMap === 'function' ? new WeakMap() : null;
function render(def, opts){
  opts = opts || {};
  var size = opts.size === 'full' ? 'full' : 'thumb';
  var thumb = size === 'thumb';
  var keyIsStart = def.key === 'start' && def.start;
  var solidPose = keyIsStart ? def.start : def.end;
  var otherPose = def.start ? (keyIsStart ? def.end : def.start) : null;
  var J = solve(def.view, solidPose);
  var O = otherPose ? solve(def.view, otherPose) : null;
  J.size = size; if(O) O.size = size;
  J.flip = !!def.flip; if(O) O.flip = J.flip;
  var ghost = def.ghost || 'all';
  if(thumb && ghost === 'all') ghost = def.thumbGhost || 'none';     // whole-body ghosts only at full size
  if(!O) ghost = 'none';
  /* Props are framed by reading their markup; the figure reports its own
     extent while it is drawn (FIG_BOX), which is the same numbers without
     re-parsing every body path. */
  var drawn = [], ghostDrawn = [], props = '', part;
  FIG_BOX = [Infinity, Infinity, -Infinity, -Infinity];
  var s = (part = drawProps(J, def.scene, drawn)); props += part;
  if(ghost !== 'none'){
    part = drawProps(O, def.gear, ghostDrawn); props += part;
    s += '<g opacity="' + (thumb ? 0.26 : 0.22) + '">' + part + figure(O, 'ghost', ghost) + '</g>';
  }
  s += (part = drawProps(J, def.behind, drawn)); props += part;
  if(!def.gearFront){ s += (part = drawProps(J, def.gear, drawn)); props += part; }
  s += figure(J, 'solid');
  if(def.gearFront){ s += (part = drawProps(J, def.gear, drawn)); props += part; }
  s += (part = drawProps(J, def.front, drawn)); props += part;
  if(def.armOver) s += figure(J, 'solid', 'nearArm');
  var figBox = FIG_BOX; FIG_BOX = null;
  var frame = framed(bounds(props, figBox), def, J, size);
  var memo = PLACED && PLACED.get(def), marks = memo && memo[size];
  if(marks == null){
    var arch = archetypeOf(def), shapes = null;
    marks = '';
    if(arch === 'locomotion' || arch === 'hold' || (def.track && def.start)) shapes = sceneShapes(def, J, O, ghost, drawn, ghostDrawn);
    if(arch === 'locomotion') marks = travelArrow(def, shapes, size);
    else if(arch !== 'hold' && !def.depth && def.track && def.start) marks = placeArrow(def, shapes, frame, size);
    if(arch === 'hold') marks = { hold:true, shapes:shapes };
    if(PLACED && typeof marks === 'string'){ memo = memo || {}; memo[size] = marks; PLACED.set(def, memo); }
  }
  if(marks && typeof marks === 'string'){
    var bx = bounds(marks), fb = frame.box;
    frame = framed([Math.min(fb[0], bx[0]), Math.min(fb[1], bx[1]), Math.max(fb[2], bx[2]), Math.max(fb[3], bx[3])], def, J, size);
    s += marks;
  } else if(marks && marks.hold){
    s += holdMark(frame, marks.shapes, size);
  }
  var vx = n1(frame.x), vy = n1(frame.y), side = frame.side;
  var ground = def.ground === false ? '' :
    '<path d="M' + n1(vx) + ' ' + (G + 0.9) + 'L' + n1(vx + side) + ' ' + (G + 0.9) + '" stroke="' + C.ground + '" stroke-width="1.8"/>';
  var label = opts.label ? ' role="img" aria-label="' + String(opts.label).replace(/[<>&"]/g, '') + '"' : ' aria-hidden="true"';
  return '<svg viewBox="' + vx + ' ' + vy + ' ' + n1(side) + ' ' + n1(side) + '" xmlns="http://www.w3.org/2000/svg" focusable="false"' + label +
    ' fill="none" stroke-linecap="round" stroke-linejoin="round">' + ground + s + '</svg>';
}

function fit(view, make, lo, hi, joint, targetY){
  /* Scan for the first crossing, then bisect inside it — a plain bisection
     over the whole range can settle on the wrong side of a fold. */
  var f = function(v){ return solve(view, make(v))[joint][1] - targetY; };
  var steps = 72, a = lo, fa = f(lo), found = false;
  for(var i = 1; i <= steps; i++){
    var b = lo + (hi - lo) * i / steps, fb = f(b);
    if(fa * fb <= 0){ lo = a; hi = b; found = true; break; }
    a = b; fa = fb;
  }
  if(!found) throw new Error('fit: no solution for ' + joint + ' in range');
  for(var j = 0; j < 40; j++){
    var m = (lo + hi) / 2;
    if(f(lo) * f(m) <= 0) hi = m; else lo = m;
  }
  return make((lo + hi) / 2);
}
return { render: render, solve: solve, fit: fit, G: G, B: B, PROFILE: PROFILE, PROFILE_FRONT: PROFILE_FRONT, HAND_R: HAND_R, _mix: mixPose };
})();

/* The drawings, the names that reach them, and the cues.

   Built on first use rather than at load. A few poses are SOLVED — the
   body angle that lands a plank's toes, the knee that keeps a planted
   foot still — and none of that work should sit in front of the app
   opening. definitions() returns the same object every time after. */
var EXERCISE_ART = (function(){
'use strict';
var built = null;
function build(){
  /* Shared stances for exercise definitions. */
  var EXV_DEFS = {};
  var EXV = (function(){
    var G = 106;
    var FOOT = [58, 104.3];                 // near ankle, standing
    function extend(base, o){ var r = {}, k; for(k in base) r[k] = base[k]; for(k in o) r[k] = o[k]; return r; }
    /* Standing, near ankle planted. */
    function S(o){ return extend({ pin:['nA', FOOT] }, o || {}); }
    /* Lying on a flat bench top at y=78, head to the left, feet on the floor. */
    var BENCH_TOP = 78;
    function supineBench(o){
      return extend({ pin:['hip', [72, BENCH_TOP - 6.2]], trunk:-90, neck:-90, nth:44, nsh:0, fth:36, fsh:-24 }, o || {});
    }
    /* Seated upright on a seat whose top is at y=92, feet on the floor. */
    function seated(o){
      return extend({ pin:['hip', [50, 86]], trunk:176, nth:90, nsh:-8, fth:88, fsh:-12 }, o || {});
    }
    /* Two-bone leg: the thigh and shin angles that put the ankle exactly at `ankle`
       from `hip`, the knee bending forward (or backward when `back`). */
    function legTo(hip, ankle, back){
      var th = ExerciseArt.B.th, sh = ExerciseArt.B.sh;
      var dx = ankle[0] - hip[0], dy = ankle[1] - hip[1];
      var d = Math.min(Math.sqrt(dx * dx + dy * dy), th + sh - 0.01);
      var base = Math.atan2(dx, dy) * 180 / Math.PI;
      var a = Math.acos((th * th + d * d - sh * sh) / (2 * th * d)) * 180 / Math.PI;
      var t = back ? base - a : base + a;
      var k = [hip[0] + Math.sin(t * Math.PI / 180) * th, hip[1] + Math.cos(t * Math.PI / 180) * th];
      return [t, Math.atan2(ankle[0] - k[0], ankle[1] - k[1]) * 180 / Math.PI];
    }
    /* A side pose whose feet stay where they are planted while the body moves. */
    function planted(pose, nAt, fAt, back){
      var J = ExerciseArt.solve('side', pose), r = extend({}, pose), s;
      if(nAt){ s = legTo(J.hip, nAt, back); r.nth = s[0]; r.nsh = s[1]; }
      if(fAt){ s = legTo(J.hip, fAt, back); r.fth = s[0]; r.fsh = s[1]; }
      return r;
    }
    /* Upper-arm and forearm angles that put a hand at `hand` from `shoulder`; the
       elbow bends to the `bend` side (+1 or -1) of the shoulder-hand line. */
    function armTo(shoulder, hand, bend, uaScale, faScale){
      var ua = ExerciseArt.B.ua * (uaScale || 1), fa = ExerciseArt.B.fa * (faScale || 1);
      var dx = hand[0] - shoulder[0], dy = hand[1] - shoulder[1];
      var d = Math.max(Math.min(Math.sqrt(dx * dx + dy * dy), ua + fa - 0.01), Math.abs(ua - fa) + 0.01);
      var base = Math.atan2(dx, dy) * 180 / Math.PI;
      var a = Math.acos((ua * ua + d * d - fa * fa) / (2 * ua * d)) * 180 / Math.PI;
      var t = base + (bend < 0 ? -a : a);
      var e = [shoulder[0] + Math.sin(t * Math.PI / 180) * ua, shoulder[1] + Math.cos(t * Math.PI / 180) * ua];
      return [t, Math.atan2(hand[0] - e[0], hand[1] - e[1]) * 180 / Math.PI];
    }
    /* A front pose whose two hands meet exactly at `hand`, honouring any
       foreshortening the pose gives the arms (an arm reaching toward the
       viewer is drawn shorter). */
    function handsAt(pose, hand, bendL, bendR){
      var J = ExerciseArt.solve('front', pose), r = extend({}, pose), us = pose.uaScale, fs = pose.faScale;
      var L = armTo(J.lS, hand, bendL == null ? 1 : bendL, us, fs), R = armTo(J.rS, hand, bendR == null ? -1 : bendR, us, fs);
      r.la = -L[0]; r.lfa = -L[1]; r.ra = R[0]; r.rfa = R[1];
      return r;
    }
    /* A side pose whose near and far hands land exactly where given. */
    function sideHands(pose, nAt, fAt, bend){
      var J = ExerciseArt.solve('side', pose), r = extend({}, pose), s;
      if(nAt){ s = armTo(J.sh, nAt, bend == null ? -1 : bend); r.nua = s[0]; r.nfa = s[1]; }
      if(fAt){ s = armTo(J.sh, fAt, bend == null ? -1 : bend); r.fua = s[0]; r.ffa = s[1]; }
      return r;
    }
    /* Where a pose puts a joint. */
    function at(view, pose, joint){ return ExerciseArt.solve(view, pose)[joint]; }
    /* The pivot of a rigid lever that meets a contact at `a` in one position and
       `b` in the other: on the perpendicular bisector of the chord between them,
       `k` chord-lengths from its middle, the sign choosing the side. A lever
       drawn from anywhere else would have to stretch between the two drawings. */
    function pivotFor(a, b, k){
      var m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[0] - a[0], dy = b[1] - a[1];
      return [m[0] - dy * k, m[1] + dx * k];
    }
    function add(defs){ for(var k in defs) EXV_DEFS[k] = defs[k]; }
    return { G:G, FOOT:FOOT, S:S, supineBench:supineBench, seated:seated, BENCH_TOP:BENCH_TOP,
      legTo:legTo, planted:planted, armTo:armTo, handsAt:handsAt, sideHands:sideHands, at:at, pivotFor:pivotFor, add:add, extend:extend };
  })();

  /* Arms: elbow flexion and extension. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend, planted = H.planted, sideHands = H.sideHands, at = H.at, pivotFor = H.pivotFor;

  /* Arm machines: seated, the upper arms on a pad that slopes away from the
     chest and the elbows over the machine's cam. The handle turns about the
     elbow, so the lever is the same length in both positions. */
  var ARM_ELBOW = at('side', seat({ nua:60, nfa:66 }), 'nE');
  var ARM_SCENE = [['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }],
    ['post', { a:[66, 80], b:[70, G] }], ['column', { x:88, top:46 }], ['rail', { a:[88, 50], b:[ARM_ELBOW[0] + 2, ARM_ELBOW[1] + 1], w:2.6 }]];
  var ARM_PAD = [['pad', { a:[52.4, 64.8], b:[67.4, 73.6], w:7 }]];
  /* Seated dip machine: upright against the back pad, the handles on a lever
     that pivots behind the seat, level with the middle of their path. */
  var DIP_SEAT = { pin:['hip', [50, 86]], trunk:178, neck:180, nth:90, nsh:-8, fth:88, fsh:-12 };
  var DIP_TOP = [58, 72.5], DIP_LOW = [57, 86.5];
  var DIP_PIVOT = pivotFor(DIP_TOP, DIP_LOW, 2.1);

  H.add({

  /* ---- elbow flexion ---- */
  curl_barbell: { view:'side', arch:'arc', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:2, ffa:10 }),
    end:  S({ nua:18, nfa:152, fua:14, ffa:148 }),
    gear:[['plate', { at:'nW', r:7.4 }]], track:'nW' },

  curl_dumbbell: { view:'side', arch:'arc', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:-2, ffa:4 }),
    end:  S({ nua:18, nfa:152, fua:-2, ffa:4 }),
    gear:[['dbFace', { at:'fW' }], ['dbFace', { at:'nW' }]], track:'nW' },

  curl_hammer: { view:'side', arch:'arc', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:-2, ffa:4 }),
    end:  S({ nua:18, nfa:150, fua:-2, ffa:4 }),
    gear:[['db', { at:'fW', along:'ffa', aoff:90 }], ['db', { at:'nW', along:'nfa', aoff:90 }]], track:'nW' },

  curl_incline_db: { view:'side', arch:'arc', arrow:{ trim:[0.45, 1] }, crop:'upper', ghost:'arms',
    scene:[['pad', { a:[38, 91], b:[62, 91], w:5 }], ['post', { a:[50, 94], b:[50, G] }], ['pad', { a:[42, 90], b:[25, 63], w:5 }]],
    start:{ pin:['hip', [48, 85.5]], trunk:-148, neck:-162, nua:2, nfa:6, fua:-2, ffa:2, nth:90, nsh:-6, fth:90, fsh:-12 },
    end:  { pin:['hip', [48, 85.5]], trunk:-148, neck:-162, nua:2, nfa:158, fua:-2, ffa:2, nth:90, nsh:-6, fth:90, fsh:-12 },
    gear:[['dbFace', { at:'fW' }], ['dbFace', { at:'nW' }]], track:'nW' },

  curl_preacher: { view:'side', arch:'arc', crop:'upper', ghost:'arms', armOver:true,
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['post', { a:[62, 79], b:[60, G] }]],
    front:[['pad', { a:[52.4, 67.4], b:[64.6, 75.4], w:7 }]],
    start:seat({ trunk:176, nua:58, nfa:64, fua:54, ffa:60 }),
    end:  seat({ trunk:176, nua:58, nfa:158, fua:54, ffa:154 }),
    gear:[['plate', { at:'nW', r:6.6 }]], track:'nW' },

  curl_cable: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:44 }]],
    start:S({ trunk:176, nua:10, nfa:30, fua:6, ffa:26 }),
    end:  S({ trunk:176, nua:18, nfa:150, fua:14, ffa:146 }),
    gear:[['cable', { from:[92, 98], to:'nW', grip:'bar' }]], track:'nW' },

  cable_hammer_curl: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:44 }]],
    start:S({ trunk:176, nua:10, nfa:30, fua:6, ffa:26 }),
    end:  S({ trunk:176, nua:18, nfa:150, fua:14, ffa:146 }),
    gear:[['cable', { from:[92, 98], to:'nW', grip:'rope' }]], track:'nW' },

  concentration_curl: { view:'side', arch:'arc', crop:'upper', ghost:'arms',
    scene:[['bench', { x1:20, x2:58, y:92 }]],
    start:{ pin:['hip', [44, 86]], trunk:132, neck:142, nua:8, nfa:4, fua:44, ffa:34, nth:90, nsh:-8, fth:90, fsh:-12 },
    end:  { pin:['hip', [44, 86]], trunk:132, neck:142, nua:8, nfa:162, fua:44, ffa:34, nth:90, nsh:-8, fth:90, fsh:-12 },
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  curl_machine: { view:'side', arch:'machine', path:'pivot', pivot:ARM_ELBOW, crop:'upper', ghost:'arms', armOver:true,
    scene:ARM_SCENE, front:ARM_PAD,
    start:seat({ nua:60, nfa:66, fua:56, ffa:62 }),
    end:  seat({ nua:60, nfa:166, fua:56, ffa:162 }),
    gear:[['lever', { pivot:ARM_ELBOW, to:{ seg:['nE', 'nW'], t:1.12 }, handle:true }]], track:'nW' },

  band_curl: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:2, ffa:10 }),
    end:  S({ nua:18, nfa:152, fua:14, ffa:148 }),
    gear:[['band', { from:'nA', fdx:3, fdy:1, to:'nW', bowX:3 }]], track:'nW' },

  /* ---- elbow extension ---- */
  triceps_pushdown: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:12 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:10, fua:8, ffa:6 }),
    gear:[['cable', { from:[92, 18], to:'nW', grip:'bar' }]], track:'nW' },

  rope_pushdown: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:12 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:6, fua:8, ffa:2 }),
    gear:[['cable', { from:[92, 18], to:'nW', grip:'rope' }]], track:'nW' },

  band_pushdown: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['wall', { x:94, top:10 }], ['anchor', { at:[92, 22] }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:10, fua:8, ffa:6 }),
    gear:[['band', { from:[92, 22], to:'nW', bowX:2 }]], track:'nW' },

  /* Overhead cable extension: facing away from a pulley set at chest height,
     elbows high beside the head. The rope starts behind the head and the
     forearms extend forward and up while the upper arms stay put. */
  overhead_ext_cable: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:20, top:30 }]],
    start:S({ pin:['nA', [66, 104.3]], trunk:160, neck:166, nua:170, nfa:-20, fua:166, ffa:-24, nth:-12, nsh:4, fth:18, fsh:-6 }),
    end:  S({ pin:['nA', [66, 104.3]], trunk:160, neck:166, nua:170, nfa:166, fua:166, ffa:162, nth:-12, nsh:4, fth:18, fsh:-6 }),
    gear:[['cable', { from:[24, 50], to:'nW', grip:'bar' }]], track:'nW' },

  overhead_rope_ext: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    scene:[['column', { x:20, top:30 }]],
    start:S({ pin:['nA', [66, 104.3]], trunk:160, neck:166, nua:170, nfa:-20, fua:166, ffa:-24, nth:-12, nsh:4, fth:18, fsh:-6 }),
    end:  S({ pin:['nA', [66, 104.3]], trunk:160, neck:166, nua:170, nfa:166, fua:166, ffa:162, nth:-12, nsh:4, fth:18, fsh:-6 }),
    gear:[['cable', { from:[24, 50], to:'nW', grip:'rope' }]], track:'nW' },

  overhead_ext_triceps: { view:'side', arch:'arc', crop:'upper', ghost:'arms',
    start:S({ nua:176, nfa:-14, fua:172, ffa:-18 }),
    end:  S({ nua:176, nfa:178, fua:172, ffa:174 }),
    gear:[['db', { at:'nW', along:'nfa', ahead:3.4, len:4.2 }]], track:'nW' },

  band_triceps_ext: { view:'side', arch:'cable', crop:'upper', ghost:'arms',
    start:S({ nua:176, nfa:-14, fua:172, ffa:-18 }),
    end:  S({ nua:176, nfa:178, fua:172, ffa:174 }),
    gear:[['band', { from:'nA', fdx:-2, to:'nW', bowX:-7 }]], track:'nW' },

  skullcrusher: { view:'side', arch:'arc', ghost:'arms',
    scene:[['bench', { x1:24, x2:84, y:78 }]],
    start:sup({ nua:190, nfa:-26, fua:188, ffa:-30 }),
    end:  sup({ nua:190, nfa:182, fua:188, ffa:180 }),
    gear:[['plate', { at:'nW', r:6.6 }]], track:'nW' },

  triceps_kickback: { view:'side', arch:'arc', arrow:{ trim:[0.35, 1], slide:[4, 7, 10] }, ghost:'arms',
    scene:[['bench', { x1:24, x2:82, y:90 }]],
    start:{ pin:['fW', [74, 90]], trunk:100, neck:104, fua:0, ffa:0, fth:8, fsh:-90, fft:0, nth:24, nsh:-16, nua:-80, nfa:2 },
    end:  { pin:['fW', [74, 90]], trunk:100, neck:104, fua:0, ffa:0, fth:8, fsh:-90, fft:0, nth:24, nsh:-16, nua:-80, nfa:-78 },
    gear:[['db', { at:'nW', along:'nfa', aoff:90, len:4.4 }]], track:'nW' },

  /* Machine triceps extension: the curl machine's frame used the other way.
     The forearms start bent up and extend down the line of the pad, a roller
     against the wrists. */
  triceps_extension_machine: { view:'side', arch:'machine', path:'pivot', pivot:ARM_ELBOW, crop:'upper', ghost:'arms', armOver:true,
    scene:ARM_SCENE, front:ARM_PAD,
    start:seat({ nua:60, nfa:170, fua:56, ffa:166 }),
    end:  seat({ nua:60, nfa:70, fua:56, ffa:66 }),
    gear:[['lever', { pivot:ARM_ELBOW, to:{ seg:['nE', 'nW'], t:1, n:4.2 }, roller:3 }]], track:'nW' },

  dip: { view:'side', arch:'dynamic', path:'line', key:'start',
    scene:[['rail', { a:[40, 54.5], b:[84, 54.5], w:3.2 }], ['post', { a:[42, 55], b:[42, G] }], ['post', { a:[82, 55], b:[82, G] }]],
    start:{ pin:['nW', [62, 52.4]], trunk:160, neck:168, nua:-95, nfa:20, fua:-99, ffa:16, nth:22, nsh:-56, fth:14, fsh:-62 },
    end:  { pin:['nW', [62, 52.4]], trunk:172, neck:176, nua:4, nfa:2, fua:0, ffa:-2, nth:14, nsh:-48, fth:8, fsh:-54 },
    track:'sh' },

  dip_weighted: { view:'side', arch:'dynamic', path:'line', key:'start',
    scene:[['rail', { a:[40, 54.5], b:[84, 54.5], w:3.2 }], ['post', { a:[42, 55], b:[42, G] }], ['post', { a:[82, 55], b:[82, G] }]],
    start:{ pin:['nW', [62, 52.4]], trunk:160, neck:168, nua:-95, nfa:20, fua:-99, ffa:16, nth:22, nsh:-56, fth:14, fsh:-62 },
    end:  { pin:['nW', [62, 52.4]], trunk:172, neck:176, nua:4, nfa:2, fua:0, ffa:-2, nth:14, nsh:-48, fth:8, fsh:-54 },
    gear:[['rod', { a:'hip', b:'belt', c:'dim', w:1.2 }], ['disc', { at:'belt', dy:4, r:5.2 }]],
    track:'sh' },

  bench_dip: { view:'side', arch:'dynamic', path:'line', key:'start',
    scene:[['bench', { x1:20, x2:54, y:80 }]],
    start:planted({ pin:['nW', [52, 80]], trunk:178, neck:180, nua:-100, nfa:10, fua:-104, ffa:6, nft:90, fft:90 }, [86, 103.4], [82, 103.6]),
    end:  planted({ pin:['nW', [52, 80]], trunk:178, neck:180, nua:-14, nfa:-12, fua:-18, ffa:-16, nft:90, fft:90 }, [86, 103.4], [82, 103.6]),
    track:'sh' },

  /* Seated dip machine: the handles pressed down from beside the ribs to
     straight arms at the hips. */
  dip_machine: { view:'side', arch:'machine', path:'pivot', pivot:DIP_PIVOT, ghost:'arms',
    scene:[['column', { x:DIP_PIVOT[0] - 5, top:36 }], ['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['pad', { a:[42, 90], b:[42, 54], w:5.4 }]],
    start:sideHands(DIP_SEAT, DIP_TOP, [57.4, 73], -1),
    end:  sideHands(DIP_SEAT, DIP_LOW, [56.4, 87], -1),
    gear:[['lever', { pivot:DIP_PIVOT, to:'nW', handle:true }], ['rod', { a:'nW', adx:-2.2, b:'nW', bdx:4.6, w:2.4 }]], gearFront:true, track:'nW' },

  bench_press_close_grip: { view:'side', arch:'press', ghost:'arms',
    scene:[['bench', { x1:24, x2:84, y:78 }]],
    start:sup({ nua:24, nfa:176, fua:20, ffa:174 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' }
  });
  })(EXV);

  /* Chest and shoulders: presses, flys, push-ups, raises. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend, handsAt = H.handsAt, sideHands = H.sideHands, at = H.at, pivotFor = H.pivotFor;
  var BENCH = ['bench', { x1:24, x2:84, y:78 }];

  /* Reclined on an incline bench, seat top at y=86. */
  function incline(o){ return ext({ pin:['hip', [62, 80]], trunk:-132, neck:-142, nth:72, nsh:-12, fth:70, fsh:-20 }, o); }
  var INCLINE_SCENE = [['pad', { a:[50, 86], b:[72, 86], w:5 }], ['post', { a:[61, 89], b:[61, G] }], ['pad', { a:[58, 86.5], b:[33, 63], w:5.2 }], ['post', { a:[40, 72], b:[48, G] }]];

  /* Lying on the floor, knees bent, feet flat. */
  function floor(o){ return ext({ pin:['hip', [70, G - 6.2]], trunk:-90, neck:-94, nth:140, nsh:10, fth:136, fsh:6 }, o); }

  /* A straight body from hands to toes: find the body angle that lands the toes. */
  function plank(armN, armF, handAt, bodyLift){
    return ExerciseArt.fit('side', function(a){
      return { pin:['nW', handAt], trunk:a, neck:a - 8, nth:a - 180 + (bodyLift || 0), nsh:a - 180 + (bodyLift || 0),
        fth:a - 180 + (bodyLift || 0), fsh:a - 180 + (bodyLift || 0), nft:0, fft:0,
        nua:armN[0], nfa:armN[1], fua:armF[0], ffa:armF[1] };
    }, 60, 150, 'nT', G - 1.2);
  }

  /* Front view standing, feet apart. */
  function F(o){ return ext({ pin:['lA', [51.5, 104.3]], lth:8, lsh:4, rth:8, rsh:4 }, o); }
  /* Front view seated: thighs toward the viewer. */
  function FS(o){ return ext({ pin:['hc', [60, 79.5]], thighScale:0.34, lth:18, lsh:4, rth:18, rsh:4 }, o); }

  /* Machine shoulder press: the handles rise from shoulder height to overhead
     on a lever that pivots behind the seat. */
  var SP_LOW = [53, 59.5], SP_TOP = [58.5, 36];
  var SP_PIVOT = pivotFor(SP_LOW, SP_TOP, -1.15);
  /* Incline machine press: up and forward from the upper chest, on a lever
     that pivots behind and above the backrest. */
  var IP_START = seat({ pin:['hip', [52, 86]], trunk:-162, neck:-170, nua:-40, nfa:130, fua:-44, ffa:126 });
  var IP_END = seat({ pin:['hip', [52, 86]], trunk:-162, neck:-170, nua:138, nfa:136, fua:134, ffa:132 });
  var IP_PIVOT = pivotFor(at('side', IP_START, 'nW'), at('side', IP_END, 'nW'), -1.5);
  /* Smith presses: the bar rides two vertical rails, so the hands travel a
     vertical line between them. */
  function smithRails(x, top){ return [['rail', { a:[x - 2.2, top], b:[x - 2.2, G], w:2.4 }], ['rail', { a:[x + 2.2, top], b:[x + 2.2, G], w:2.4 }]]; }
  var SMITH_INCLINE_X = 50.5, SMITH_PRESS_X = 56.5;
  var SMITH_SEAT = { pin:['hip', [46, 86]], trunk:180, neck:180, nth:90, nsh:-8, fth:88, fsh:-12 };
  /* Machine lateral raise, from the front: seated, pads on the outer upper
     arms, the levers turning about pivots in line with the shoulders. */
  var LR_START = FS({ la:12, lfa:4, ra:12, rfa:4 }), LR_END = FS({ la:88, lfa:62, ra:88, rfa:62 });
  var LR_LS = at('front', LR_START, 'lS'), LR_RS = at('front', LR_START, 'rS');

  H.add({

  /* ---- barbell and dumbbell presses ---- */
  bench_press_barbell: { view:'side', arch:'press', ghost:'arms', scene:[BENCH],
    start:sup({ nua:40, nfa:185, fua:36, ffa:182 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  bench_press_smith: { view:'side', arch:'machine', ghost:'arms', scene:[['rail', { a:[49, 14], b:[49, G], w:2.4 }], ['rail', { a:[53, 14], b:[53, G], w:2.4 }], BENCH],
    start:sup({ nua:40, nfa:185, fua:36, ffa:182 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  bench_press_incline_smith: { view:'side', arch:'machine', ghost:'arms', scene:smithRails(SMITH_INCLINE_X, 24).concat(INCLINE_SCENE),
    start:sideHands(incline({}), [SMITH_INCLINE_X, 57.5], [SMITH_INCLINE_X - 0.6, 58.1], 1),
    end:  sideHands(incline({}), [SMITH_INCLINE_X, 38.2], [SMITH_INCLINE_X - 0.6, 38.8], 1),
    gear:[['plate', { at:'nW', r:7.8 }]], track:'nW' },

  bench_press_db: { view:'side', arch:'press', ghost:'arms', scene:[BENCH],
    start:sup({ nua:44, nfa:186, fua:40, ffa:183 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  bench_press_incline_bb: { view:'side', arch:'press', ghost:'arms', scene:INCLINE_SCENE,
    start:incline({ nua:22, nfa:175, fua:18, ffa:172 }),
    end:  incline({ nua:178, nfa:180, fua:174, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  incline_press_db: { view:'side', arch:'press', ghost:'arms', scene:INCLINE_SCENE,
    start:incline({ nua:26, nfa:176, fua:22, ffa:173 }),
    end:  incline({ nua:178, nfa:180, fua:174, ffa:176 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  db_floor_press: { view:'side', arch:'press', ghost:'arms',
    start:floor({ nua:76, nfa:180, fua:72, ffa:178 }),
    end:  floor({ nua:180, nfa:180, fua:176, ffa:178 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  /* ---- machines ---- */
  chest_press_machine: { view:'side', arch:'machine', ghost:'arms',
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['pad', { a:[42, 90], b:[42, 56], w:5.4 }], ['column', { x:94, top:26 }]],
    start:seat({ trunk:178, nua:-68, nfa:88, fua:-72, ffa:84 }),
    end:  seat({ trunk:178, nua:84, nfa:88, fua:80, ffa:84 }),
    gear:[['lever', { pivot:[90, 34], to:'nW', handle:true }]], track:'nW' },

  incline_press_machine: { view:'side', arch:'machine', path:'pivot', pivot:IP_PIVOT, ghost:'arms',
    scene:[['column', { x:IP_PIVOT[0], top:IP_PIVOT[1] - 8 }], ['pad', { a:[40, 92], b:[62, 92], w:5 }], ['post', { a:[51, 95], b:[51, G] }], ['pad', { a:[42, 89], b:[30, 58], w:5.4 }]],
    start:IP_START, end:IP_END,
    gear:[['lever', { pivot:IP_PIVOT, to:'nW', handle:true }]], track:'nW' },

  shoulder_press_machine: { view:'side', arch:'machine', path:'pivot', pivot:SP_PIVOT, ghost:'arms',
    scene:[['column', { x:SP_PIVOT[0], top:SP_PIVOT[1] - 10 }], ['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['pad', { a:[42, 90], b:[42, 54], w:5.4 }]],
    start:sideHands(seat({ trunk:178 }), SP_LOW, [52.4, 60.1], 1),
    end:  sideHands(seat({ trunk:178 }), SP_TOP, [57.9, 36.6], 1),
    gear:[['lever', { pivot:SP_PIVOT, to:'nW', handle:true }]], track:'nW' },

  shoulder_press_smith: { view:'side', arch:'machine', ghost:'arms', crop:'upper',
    scene:smithRails(SMITH_PRESS_X, 20).concat([['pad', { a:[34, 92], b:[58, 92], w:5 }], ['post', { a:[46, 95], b:[46, G] }], ['pad', { a:[38.4, 90], b:[38.4, 50], w:5.4 }]]),
    start:sideHands(SMITH_SEAT, [SMITH_PRESS_X, 58.5], [SMITH_PRESS_X - 0.6, 59.1], -1),
    end:  sideHands(SMITH_SEAT, [SMITH_PRESS_X, 36.2], [SMITH_PRESS_X - 0.6, 36.8], -1),
    gear:[['plate', { at:'nW', r:7.4 }]], track:'nW' },

  /* ---- flys (front and top-down views: the arms move across the body) ---- */
  chest_fly_cable: { view:'front', arch:'cable', ghost:'arms',
    scene:[['column', { x:12, top:8 }], ['column', { x:108, top:8 }]],
    start:F({ la:104, lfa:98, ra:104, rfa:98 }),
    end:  F({ la:14, lfa:-46, ra:14, rfa:-46 }),
    gear:[['cable', { from:[16, 15], to:'lW' }], ['cable', { from:[104, 15], to:'rW' }]], track:'rW' },

  /* Low-to-high cable fly: from the low pulleys the hands sweep up and in to
     meet in front of the upper chest — not overhead. Reaching forward, the
     arms are drawn foreshortened. */
  chest_fly_incline_cable: { view:'front', arch:'cable', path:'line', arrow:{ trim:[0, 0.7] }, ghost:'arms',
    scene:[['column', { x:12, top:60 }], ['column', { x:108, top:60 }]],
    start:F({ la:36, lfa:40, ra:36, rfa:40 }),
    end:  handsAt(F({ uaScale:0.62, faScale:0.62 }), [60.3, 52]),
    gear:[['cable', { from:[16, 98], to:'lW' }], ['cable', { from:[104, 98], to:'rW' }]], track:'rW' },

  /* Pec deck: back on the pad, upper arms level, forearms against upright pads
     that swing from pivots overhead. The open stretch is the drawing; the pads
     meeting in front of the chest is the ghost, and the arrow closes inward. */
  pec_deck: { view:'front', arch:'machine', path:'line', key:'start', ghost:'all', thumbGhost:'none',
    scene:[['box', { x:49, y:30, w:22, h:52 }], ['pad', { a:[46, 83], b:[74, 83], w:5 }], ['post', { a:[60, 86], b:[60, G] }],
      ['rail', { a:[36, 20], b:[84, 20], w:3 }]],
    start:FS({ la:92, lfa:180, ra:92, rfa:180 }),
    end:  FS({ la:-90, lfa:180, ra:-90, rfa:180, uaScale:0.32 }),
    gear:[['lever', { pivot:[55, 20], to:'lW', dy:-3 }], ['lever', { pivot:[65, 20], to:'rW', dy:-3 }],
      ['pad', { a:'lE', b:'lW', extA:1, extB:3, w:7 }], ['pad', { a:'rE', b:'rW', extA:1, extB:3, w:7 }]],
    track:'rW' },

  /* DB floor fly, seen from above: arms open wide on the floor with a soft
     bend (the drawing); the weights meet over the chest (the ghost). */
  db_floor_fly: { view:'front', arch:'arc', key:'start', ghost:'all', thumbGhost:'none', ground:false,
    scene:[['mat', { x:6, y:30, w:108, h:60 }]],
    start:{ pin:['hc', [74, 60]], rot:-90, la:84, lfa:70, ra:84, rfa:70, lth:4, lsh:4, rth:4, rsh:4 },
    end:  { pin:['hc', [74, 60]], rot:-90, la:24, lfa:-40, ra:24, rfa:-40, uaScale:0.45, faScale:0.45, lth:4, lsh:4, rth:4, rsh:4 },
    gear:[['dbFace', { at:'lW', r:3.8 }], ['dbFace', { at:'rW', r:3.8 }]], track:'rW' },

  /* ---- push-ups ---- */
  pushup: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:plank([-100, 8], [-104, 4], [82, 103.2]),
    end:  plank([2, 0], [-2, -2], [82, 103.2]),
    track:'sh' },

  pushup_close: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:plank([-118, 4], [-122, 0], [78, 103.2]),
    end:  plank([-10, -8], [-14, -12], [78, 103.2]),
    track:'sh' },

  pushup_incline: { view:'side', arch:'dynamic', path:'line', key:'end',
    scene:[['bench', { x1:74, x2:104, y:80 }]],
    start:ExerciseArt.fit('side', function(a){ return { pin:['nW', [82, 79.4]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:-120, nfa:26, fua:-124, ffa:22 }; }, 60, 170, 'nT', G - 1.2),
    end:  ExerciseArt.fit('side', function(a){ return { pin:['nW', [82, 79.4]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:6, nfa:6, fua:2, ffa:2 }; }, 60, 170, 'nT', G - 1.2),
    track:'sh' },

  pushup_plyo: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:plank([-100, 8], [-104, 4], [82, 103.2]),
    end:  plank([10, 12], [6, 8], [84, 95], 0),
    track:'sh' },

  pushup_plyo_box: { view:'side', arch:'dynamic', path:'line', key:'end',
    scene:[['box', { x:76, y:96, w:14, h:10 }]],
    start:plank([-100, 8], [-104, 4], [70, 103.2]),
    end:  ExerciseArt.fit('side', function(a){ return { pin:['nW', [83, 95.2]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:2, nfa:2, fua:-2, ffa:-2 }; }, 60, 160, 'nT', G - 1.2),
    track:'sh' },

  pike_pushup: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:sideHands({ pin:['nT', [18.1, 104.8]], trunk:58.5, neck:48.5, nth:-54, nsh:-54, fth:-54, fsh:-54, nft:0, fft:0 }, [82, 103.2], [81.2, 103.4], -1),
    end:  { pin:['nW', [82, 103.2]], trunk:48.5, neck:40.5, nth:-41.8, nsh:-41.8, fth:-41.8, fsh:-41.8, nft:0, fft:0, nua:48.5, nfa:48.5, fua:46.5, ffa:46.5 },
    track:'sh' },

  band_chest_press: { view:'side', arch:'cable', path:'line', ghost:'arms', crop:'upper', gearFront:true,
    start:S({ nua:-66, nfa:88, fua:-70, ffa:84, nth:-6, fth:10, fsh:-4 }),
    end:  S({ nua:88, nfa:90, fua:84, ffa:86, nth:-6, fth:10, fsh:-4 }),
    gear:[['band', { from:'sh', fdx:-5, fdy:2, to:'nW', bowY:-3 }]], track:'nW' },

  med_ball_chest_pass: { view:'side', arch:'press', ghost:'arms', crop:'upper',
    start:S({ nua:-40, nfa:96, fua:-44, ffa:92, nth:-8, fth:14, fsh:-6 }),
    end:  S({ trunk:172, nua:84, nfa:86, fua:80, ffa:82, nth:-10, fth:16, fsh:-8 }),
    gear:[['medball', { at:'nW', dx:5 }]], track:'nW' },

  /* ---- overhead presses ---- */
  overhead_press_bb: { view:'side', arch:'press', ghost:'arms', crop:'upper',
    start:S({ nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  push_press: { view:'side', arch:'press', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  db_push_press: { view:'side', arch:'press', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:30, nfa:170, fua:26, ffa:168 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  kb_push_press: { view:'side', arch:'press', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:28, nfa:170, fua:-4, ffa:-2 }),
    end:  S({ nua:178, nfa:180, fua:-4, ffa:-2 }),
    gear:[['kettlebell', { at:'nW', inverted:true, dx:-2 }]], track:'nW' },

  shoulder_press_db: { view:'front', arch:'press', ghost:'arms',
    scene:[['box', { x:48, y:31.5, w:24, h:52 }]],
    start:FS({ la:92, lfa:178, ra:92, rfa:178 }),
    end:  FS({ la:156, lfa:170, ra:156, rfa:170 }),
    gear:[['db', { at:'lW', a:90, len:4.4 }], ['db', { at:'rW', a:90, len:4.4 }]], track:'rW' },

  shoulder_press_arnold: { view:'front', arch:'press', ghost:'arms', key:'start',
    scene:[['box', { x:48, y:31.5, w:24, h:52 }]],
    start:FS({ la:-12, lfa:176, ra:-12, rfa:176, uaScale:0.75 }),
    end:  FS({ la:168, lfa:176, ra:168, rfa:176 }),
    gear:[['db', { at:'lW', a:0, len:4.4 }], ['db', { at:'rW', a:0, len:4.4 }]], track:'rW' },

  landmine_press: { view:'side', arch:'press', ghost:'arms',
    start:H.planted({ pin:['fK', [58, G - 4]], trunk:172, neck:176, fth:0, fsh:-90, fft:-80, nua:26, nfa:160, fua:-4, ffa:-2, nft:90 }, [77.5, 104.3], null),
    end:  H.planted({ pin:['fK', [58, G - 4]], trunk:168, neck:172, fth:0, fsh:-90, fft:-80, nua:140, nfa:140, fua:-4, ffa:-2, nft:90 }, [77.5, 104.3], null),
    gear:[['rod', { a:[14, G - 1], b:'nW', w:2.4 }], ['plate', { at:'nW', r:4.6, dx:-4, dy:2 }]], track:'nW' },

  band_shoulder_press: { view:'side', arch:'cable', path:'line', ghost:'arms', crop:'upper',
    start:S({ nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['band', { from:'nA', fdx:3, to:'nW', bowX:10 }]], track:'nW' },

  /* ---- raises and rear delts ---- */
  /* Lateral raise: a soft bend held in the elbows, the weights rise out to
     the sides until the arms are level with the shoulders. */
  lateral_raise: { view:'front', arch:'arc', ghost:'arms',
    start:F({ la:12, lfa:4, ra:12, rfa:4 }),
    end:  F({ la:86, lfa:74, ra:86, rfa:74 }),
    gear:[['dbFace', { at:'lW', r:4.2 }], ['dbFace', { at:'rW', r:4.2 }]], track:'rW' },

  lateral_raise_cable: { view:'front', arch:'cable', ghost:'arms',
    scene:[['column', { x:12, top:60 }]],
    start:F({ la:-14, lfa:-16, ra:10, rfa:4 }),
    end:  F({ la:-14, lfa:-16, ra:86, rfa:76 }),
    gear:[['cable', { from:[16, 98], to:'rW' }]], track:'rW' },

  lateral_raise_machine: { view:'front', arch:'machine', path:'trace', ghost:'arms',
    scene:[['box', { x:49, y:34, w:22, h:46 }], ['pad', { a:[46, 83], b:[74, 83], w:5 }], ['post', { a:[60, 86], b:[60, G] }],
      ['post', { a:LR_LS, b:[LR_LS[0], 30] }], ['post', { a:LR_RS, b:[LR_RS[0], 30] }], ['rail', { a:[LR_LS[0] - 1, 30], b:[LR_RS[0] + 1, 30], w:3 }]],
    behind:[['lever', { pivot:LR_LS, to:{ seg:['lS', 'lE'], t:0.9, n:-4.6 } }], ['lever', { pivot:LR_RS, to:{ seg:['rS', 'rE'], t:0.9, n:4.6 } }]],
    start:LR_START, end:LR_END,
    gear:[['pad', { a:{ seg:['lS', 'lE'], t:0.6, n:-4.4 }, b:{ seg:['lS', 'lE'], t:1.02, n:-4.4 }, w:5 }],
      ['pad', { a:{ seg:['rS', 'rE'], t:0.6, n:4.4 }, b:{ seg:['rS', 'rE'], t:1.02, n:4.4 }, w:5 }]],
    gearFront:true, track:'rE' },

  front_raise: { view:'side', arch:'arc', ghost:'arms', crop:'upper',
    start:S({ nua:4, nfa:4, fua:0, ffa:0 }),
    end:  S({ nua:92, nfa:92, fua:0, ffa:0 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  upright_row: { view:'front', arch:'press', ghost:'arms',
    start:F({ la:8, lfa:-26, ra:8, rfa:-26 }),
    end:  F({ la:104, lfa:-52, ra:104, rfa:-52 }),
    gear:[['barFront', { half:26, pr:7.6 }]], track:'rW' },

  /* Rear delt fly, from the front: hinged forward with soft knees, so the
     torso all but disappears behind the shoulders and the head hangs below
     them, looking at the floor; the arms rise out wide to level. */
  rear_delt_fly: { view:'front', arch:'arc', ghost:'arms',
    start:F({ torsoScale:0.22, neckTilt:180, lth:12, lsh:-8, rth:12, rsh:-8, la:4, lfa:0, ra:4, rfa:0 }),
    end:  F({ torsoScale:0.22, neckTilt:180, lth:12, lsh:-8, rth:12, rsh:-8, la:84, lfa:74, ra:84, rfa:74 }),
    gear:[['dbFace', { at:'lW', r:4 }], ['dbFace', { at:'rW', r:4 }]], track:'rW' },

  /* Reverse pec deck, from behind: chest on the pad (its edges show either
     side of the back), the arms sweep from in front of the chest out to a T
     on handles that swing from pivots overhead. */
  reverse_pec_deck: { view:'front', arch:'machine', path:'line', ghost:'all', thumbGhost:'none',
    scene:[['box', { x:46, y:44, w:28, h:34 }], ['pad', { a:[46, 83], b:[74, 83], w:5 }], ['post', { a:[60, 86], b:[60, G] }],
      ['rail', { a:[28, 24], b:[92, 24], w:3 }]],
    start:FS({ la:90, lfa:90, ra:90, rfa:90, uaScale:0.3, faScale:0.3 }),
    end:  FS({ la:90, lfa:90, ra:90, rfa:90 }),
    gear:[['lever', { pivot:[54, 24], to:'lW', dy:-4.5 }], ['lever', { pivot:[66, 24], to:'rW', dy:-4.5 }],
      ['rod', { a:'lW', ady:-4.5, b:'lW', bdy:4.5, w:2.6 }], ['rod', { a:'rW', ady:-4.5, b:'rW', bdy:4.5, w:2.6 }]],
    track:'rW' },

  face_pull: { view:'side', arch:'cable', path:'line', ghost:'arms', crop:'upper',
    scene:[['column', { x:98, top:12 }]],
    start:S({ trunk:176, nua:106, nfa:104, fua:102, ffa:100 }),
    end:  S({ trunk:178, nua:-78, nfa:150, fua:-82, ffa:146 }),
    gear:[['cable', { from:[94, 24], to:'nW', grip:'rope' }]], track:'nW' },

  band_face_pull: { view:'side', arch:'cable', path:'line', ghost:'arms', crop:'upper',
    scene:[['wall', { x:96, top:12 }], ['anchor', { at:[94, 30] }]],
    start:S({ trunk:176, nua:104, nfa:102, fua:100, ffa:98 }),
    end:  S({ trunk:178, nua:-78, nfa:150, fua:-82, ffa:146 }),
    gear:[['band', { from:[94, 30], to:'nW' }]], track:'nW' },

  /* Band pull-apart: arms straight at shoulder height, from in front of the
     chest out to a T with the band stretched across the chest. */
  band_pull_apart: { view:'front', arch:'cable', path:'line', ghost:'all', thumbGhost:'none', gearFront:true,
    start:F({ la:90, lfa:90, ra:90, rfa:90, uaScale:0.3, faScale:0.3 }),
    end:  F({ la:90, lfa:90, ra:90, rfa:90 }),
    gear:[['band', { from:'lW', to:'rW', bowY:3 }]], track:'rW' },

  reverse_snow_angel: { view:'front', arch:'arc', ghost:'arms', ground:false,
    scene:[['mat', { x:6, y:40, w:108, h:40 }]],
    start:{ pin:['hc', [48, 60]], rot:90, la:10, lfa:8, ra:10, rfa:8, lth:4, lsh:2, rth:4, rsh:2 },
    end:  { pin:['hc', [48, 60]], rot:90, la:160, lfa:166, ra:160, rfa:166, lth:4, lsh:2, rth:4, rsh:2 },
    track:'rW' },

  shrug: { view:'front', arch:'press', ghost:'none',
    start:F({ la:4, lfa:2, ra:4, rfa:2 }),
    end:  F({ la:4, lfa:2, ra:4, rfa:2, shrug:5 }),
    gear:[['barFront', { half:28, pr:8.4, dy:0 }]], track:'rS', trackOffset:[4, -3] }
  });
  })(EXV);

  /* Back and posterior chain: rows, pulldowns, pull-ups, hinges, bridges. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend, planted = H.planted, sideHands = H.sideHands, at = H.at, pivotFor = H.pivotFor;

  /* Front views. */
  function FS(o){ return ext({ pin:['hc', [60, 79.5]], thighScale:0.34, lth:18, lsh:4, rth:18, rsh:4 }, o); }
  /* HINGES are solved from where the hips and the load must be, not from joint
     angles. Both feet stay planted; the hips travel BACK behind the heels while
     the knees stay soft, so a bar that hangs from the hands stays over mid-foot
     (the ankle is at x 58, mid-foot about 61.5) and close to the legs. */
  var HINGE_FEET = [[58, 104.3], [55, 104.5]];
  function hinge(hip, o){ return planted(ext({ pin:['hip', hip] }, o), HINGE_FEET[0], HINGE_FEET[1]); }
  /* Standing tall at the top of a hinge: soft knees, hips over the heels. */
  function hingeTop(o){ return hinge([57, 66.6], ext({ trunk:180, neck:180 }, o)); }
  /* Bent-over row stance: torso about 35 degrees above level, hips back, the
     hanging bar over mid-foot. */
  function bent(o){ return hinge([44, 70.5], ext({ trunk:125, neck:136 }, o)); }
  /* Bench-supported single-arm position (far knee and hand on the bench). */
  function braced(o){ return ext({ pin:['fW', [74, 90]], trunk:100, neck:104, fua:0, ffa:0, fth:8, fsh:-90, fft:0, nth:24, nsh:-16 }, o); }
  var BRACE_BENCH = ['bench', { x1:24, x2:82, y:90 }];
  /* A plank from a pinned hand: solve the body angle that lands the toes. */
  function plankFrom(hand, armN, armF){
    return ExerciseArt.fit('side', function(a){
      return { pin:[hand[0], hand[1]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0,
        nua:armN[0], nfa:armN[1], fua:armF[0], ffa:armF[1] };
    }, 60, 150, 'nT', G - 1.2);
  }
  /* Seated at the pulldown: thighs level under the pad, a slight lean back. */
  function pulldownSeat(o){ return ext({ pin:['hip', [46, 84.5]], trunk:172, neck:176, nth:90, nsh:-4, fth:88, fsh:-8 }, o); }
  /* Hanging from a bar seen end-on at (60, 16). */
  function hang(o){ return ext({ pin:['nW', [60, 16]], nth:4, nsh:-8, fth:8, fsh:-4 }, o); }
  /* A straight line of body leaning back from planted feet (TRX, towel rows). */
  function leanBack(angle, arms, anchorFoot){
    return ext({ pin:['nA', anchorFoot || [80, 104.3]], trunk:angle, neck:angle, nth:angle - 180, nsh:angle - 180, fth:angle - 180, fsh:angle - 180 }, arms);
  }
  /* Arms folded across the chest, turned with the torso. */
  function folded(trunk){ var r = trunk - 180; return { nua:20 + r, nfa:150 + r, fua:16 + r, ffa:146 + r }; }

  /* Hip thrust: upper back on a low bench edge, feet planted, hips rise to a straight line. */
  var HT_FEET = [[81, 104.3], [77, 104.5]];
  var HT_BOTTOM = planted({ pin:['sh', [36, 85.8]], trunk:-117, neck:-128, nua:112, nfa:96, fua:108, ffa:92 }, HT_FEET[0], HT_FEET[1]);
  var HT_TOP    = planted({ pin:['sh', [36, 85.8]], trunk:-90, neck:-112, nua:96, nfa:84, fua:92, ffa:80 }, HT_FEET[0], HT_FEET[1]);
  /* Glute bridge: shoulders on the floor, feet planted. */
  var GB_FEET = [[74, 104.3], [70, 104.5]];
  var GB_BOTTOM = planted({ pin:['sh', [34, G - 6.2]], trunk:-90, neck:-94, nua:82.5, nfa:82.5, fua:82.3, ffa:82.3 }, GB_FEET[0], GB_FEET[1]);
  var GB_TOP    = planted({ pin:['sh', [34, G - 6.2]], trunk:-62, neck:-80, nua:82.5, nfa:82.5, fua:82.3, ffa:82.3 }, GB_FEET[0], GB_FEET[1]);
  /* The hip thrust machine's pad turns on a lever from the far post: its pivot
     keeps the roller the same distance away at the bottom and the top. */
  var HT_PIVOT = (function(){
    var a = at('side', HT_BOTTOM, 'lap'), b = at('side', HT_TOP, 'lap');
    a = [a[0], a[1] - 2]; b = [b[0], b[1] - 2];
    return pivotFor(a, b, ((a[0] + b[0]) / 2 - 100) / (b[1] - a[1]));
  })();
  /* Seated leg curl: thighs level under a hold-down pad, the knees just past
     the seat and in line with the pivot; the roller sits behind the ankles and
     curls them down and back under the seat, ankles flexed so the feet hang
     clear of the floor. */
  function legCurlSeat(nsh, fsh){ return { pin:['hip', [48, 80]], trunk:172, neck:176, nth:90, fth:88, nsh:nsh, fsh:fsh, nft:nsh + 108, fft:fsh + 108, nua:14, nfa:70, fua:10, ffa:66 }; }
  var LEG_CURL_KNEE = at('side', legCurlSeat(80, 76), 'nK');

  H.add({

  /* ---- rows ---- */
  row_barbell: { view:'side', arch:'press', arrow:{ side:1, shift:[6, 4] }, ghost:'arms',
    start:bent({ nua:0, nfa:0, fua:-4, ffa:-4 }),
    end:  sideHands(bent({}), [57.6, 70.6], [56.8, 71.2], -1),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  /* Pendlay row: torso level, every rep starts and ends with the bar on the floor. */
  pendlay_row: { view:'side', arch:'press', arrow:{ side:1 }, ghost:'arms', key:'start',
    start:sideHands(hinge([42, 74], { trunk:96, neck:104 }), [64, 96.8], [63.2, 97.2], -1),
    end:  sideHands(hinge([42, 74], { trunk:96, neck:104 }), [57.5, 81], [56.7, 81.6], -1),
    gear:[['plate', { at:'nW', dy:0.8 }]], track:'nW' },

  seal_row: { view:'side', arch:'press', ghost:'arms',
    scene:[['bench', { x1:30, x2:86, y:62, h:5 }]],
    start:{ pin:['hip', [48, 55.8]], trunk:90, neck:96, nth:-90, nsh:-90, fth:-90, fsh:-90, nft:0, fft:0, nua:2, nfa:0, fua:-2, ffa:-2 },
    end:  { pin:['hip', [48, 55.8]], trunk:90, neck:96, nth:-90, nsh:-90, fth:-90, fsh:-90, nft:0, fft:0, nua:-122, nfa:4, fua:-126, ffa:0 },
    gear:[['plate', { at:'nW', r:7.4, dy:6 }]], gearFront:true, track:'nW' },

  row_meadows: { view:'side', arch:'press', ghost:'arms',
    start:planted(S({ trunk:116, neck:132, nua:2, nfa:0, fua:40, ffa:30, nth:-10, nsh:-4 }), null, [67.2, 104.5]),
    end:  planted(S({ trunk:116, neck:132, nua:-80, nfa:34, fua:40, ffa:30, nth:-10, nsh:-4 }), null, [67.2, 104.5]),
    gear:[['rod', { a:[10, G - 1], b:'nW', extB:5, w:2.4 }], ['plate', { at:'nW', r:5.4, dx:5.6, dy:-2.2 }]], track:'nW' },

  row_dumbbell: { view:'side', arch:'press', ghost:'arms', scene:[BRACE_BENCH],
    start:braced({ nua:0, nfa:0 }),
    end:  braced({ nua:-120, nfa:22 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  kb_row: { view:'side', arch:'press', ghost:'arms', scene:[BRACE_BENCH],
    start:braced({ nua:0, nfa:0 }),
    end:  braced({ nua:-120, nfa:22 }),
    gear:[['kettlebell', { at:'nW', dy:-2 }]], track:'nW' },

  renegade_row: { view:'side', arch:'press', ghost:'arms',
    start:plankFrom(['fW', [80, 98.6]], [2, 0], [0, 0]),
    end:  plankFrom(['fW', [80, 98.6]], [-128, 24], [0, 0]),
    gear:[['db', { at:'fW', a:90, len:4.6 }], ['db', { at:'nW', a:90, len:4.6 }]], track:'nW' },

  row_cable_seated: { view:'side', arch:'cable', path:'line', ghost:'arms',
    scene:[['pad', { a:[26, 96], b:[52, 96], w:5 }], ['post', { a:[39, 99], b:[39, G] }], ['post', { a:[92, 88], b:[92, G] }], ['column', { x:102, top:60 }]],
    start:{ pin:['hip', [44, 90]], trunk:164, neck:170, nth:80, nsh:62, fth:78, fsh:60, nft:170, fft:170, nua:84, nfa:84, fua:80, ffa:80 },
    end:  { pin:['hip', [44, 90]], trunk:178, neck:180, nth:80, nsh:62, fth:78, fsh:60, nft:170, fft:170, nua:-58, nfa:86, fua:-62, ffa:82 },
    gear:[['cable', { from:[98, 78], to:'nW', grip:'bar' }]], track:'nW' },

  row_machine: { view:'side', arch:'machine', ghost:'arms',
    scene:[['pad', { a:[36, 92], b:[58, 92], w:5 }], ['post', { a:[47, 95], b:[47, G] }], ['post', { a:[74, 78], b:[74, G] }], ['column', { x:96, top:40 }]],
    front:[['pad', { a:[66, 58], b:[66, 80], w:6.4 }]],
    start:seat({ pin:['hip', [48, 86]], trunk:168, neck:172, nua:84, nfa:86, fua:80, ffa:82 }),
    end:  seat({ pin:['hip', [48, 86]], trunk:168, neck:172, nua:-64, nfa:86, fua:-68, ffa:82 }),
    gear:[['lever', { pivot:[92, 46], to:'nW', handle:true }]], track:'nW' },

  tbar_row: { view:'side', arch:'press', ghost:'arms',
    start:bent({ nua:4, nfa:2, fua:0, ffa:-2 }),
    end:  sideHands(bent({}), [58.4, 69.6], [57.6, 70.2], -1),
    gear:[['rod', { a:[14, G - 1], b:'nW', w:2.4 }], ['plate', { at:'nW', r:7.2, dx:4, dy:2 }], ['rod', { a:'nW', adx:-4, b:'nW', bdx:4, w:2.2 }]], track:'nW' },

  trx_row: { view:'side', arch:'dynamic', path:'line', ghost:'all',
    scene:[['anchor', { at:[98, 10] }]],
    start:leanBack(-138, { nua:136, nfa:136, fua:132, ffa:132 }),
    end:  leanBack(-150, { nua:-52, nfa:128, fua:-56, ffa:124 }),
    gear:[['strap', { from:[98, 10], to:'nW' }]], track:'sh' },

  band_row: { view:'side', arch:'cable', path:'line', ghost:'arms', crop:'upper',
    scene:[['wall', { x:98, top:10 }], ['anchor', { at:[96, 60] }]],
    start:S({ trunk:178, nua:84, nfa:86, fua:80, ffa:82 }),
    end:  S({ trunk:180, nua:-60, nfa:88, fua:-64, ffa:84 }),
    gear:[['band', { from:[96, 60], to:'nW', bowY:2 }]], track:'nW' },

  towel_door_row: { view:'side', arch:'dynamic', path:'line', ghost:'all',
    scene:[['wall', { x:100, top:6 }], ['anchor', { at:[98, 58] }]],
    start:leanBack(-155, { nua:96, nfa:96, fua:92, ffa:92 }, [76, 104.3]),
    end:  leanBack(-166, { nua:-56, nfa:106, fua:-60, ffa:102 }, [76, 104.3]),
    gear:[['strap', { from:[98, 58], to:'nW' }]], track:'sh' },

  /* ---- vertical pulls ---- */
  /* Lat pulldown: seated, thighs locked under the pad, the bar pulled from
     arm's length overhead straight down to the upper chest. The cable drops
     from a pulley above the bar; the machine's column stands in front. */
  lat_pulldown: { view:'side', arch:'cable', path:'line', ghost:'arms',
    scene:[['pad', { a:[34, 90.5], b:[56, 90.5], w:5 }], ['post', { a:[45, 93], b:[45, G] }],
      ['column', { x:88, top:14 }], ['rail', { a:[88, 17], b:[58, 17], w:3 }],
      ['pad', { a:[58, 77.4], b:[67, 77.4], w:6 }], ['post', { a:[72, 78], b:[72, G] }]],
    start:sideHands(pulldownSeat(), [57.5, 34], [56.7, 34.6], -1),
    end:  sideHands(pulldownSeat(), [57.5, 62.5], [56.7, 63], -1),
    gear:[['cable', { from:[60, 18], to:'nW', grip:'bar' }]], track:'nW' },

  /* One-arm pulldown: the same seat, one handle; the elbow drives down to the
     side while the free hand rests on the thigh. */
  lat_pulldown_single: { view:'side', arch:'cable', path:'line', ghost:'arms',
    scene:[['pad', { a:[34, 90.5], b:[56, 90.5], w:5 }], ['post', { a:[45, 93], b:[45, G] }],
      ['column', { x:88, top:14 }], ['rail', { a:[88, 17], b:[58, 17], w:3 }],
      ['pad', { a:[58, 77.4], b:[67, 77.4], w:6 }], ['post', { a:[72, 78], b:[72, G] }]],
    start:sideHands(pulldownSeat({ fua:18, ffa:74 }), [57.5, 34], null, -1),
    end:  sideHands(pulldownSeat({ fua:18, ffa:74 }), [56.5, 61], null, -1),
    gear:[['cable', { from:[60, 18], to:'nW' }]], track:'nW' },

  straight_arm_pulldown: { view:'side', arch:'cable', ghost:'arms',
    scene:[['column', { x:98, top:10 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:162, neck:164, nth:4, nsh:-6, fth:10, fsh:-8, nua:148, nfa:150, fua:144, ffa:146 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:162, neck:164, nth:4, nsh:-6, fth:10, fsh:-8, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    gear:[['cable', { from:[94, 16], to:'nW', grip:'bar' }]], track:'nW' },

  /* DB pullover, lying ACROSS a bench (seen end-on): upper back on the pad,
     hips dropped a little, feet flat. Straight arms lower the weight behind
     the head, then pull it back over the chest. */
  db_pullover: { view:'side', arch:'arc', ghost:'arms',
    scene:[['box', { x:25, y:79, w:20, h:5.5 }], ['post', { a:[35, 84.5], b:[35, G] }], ['rail', { a:[27, G - 1], b:[43, G - 1], w:2.2 }]],
    start:planted({ pin:['sh', [34, 73.8]], trunk:-97, neck:-96, nua:-94, nfa:-96, fua:-98, ffa:-100 }, [82, 104.3], [79, 104.5]),
    end:  planted({ pin:['sh', [34, 73.8]], trunk:-97, neck:-96, nua:178, nfa:178, fua:174, ffa:174 }, [82, 104.3], [79, 104.5]),
    gear:[['db', { at:'nW', along:'nfa', ahead:3.8, len:4.2 }]], track:'nW' },

  pullup: { view:'front', arch:'dynamic', path:'line', arrow:{ shift:[0, 24] }, ghost:'all', key:'end', ground:false,
    scene:[['rod', { a:[14, 18], b:[106, 18], w:2.6 }]],
    start:{ pin:['lW', [38, 18]], la:164, lfa:176, ra:164, rfa:176, lth:2, lsh:8, rth:2, rsh:8 },
    end:  { pin:['lW', [38, 18]], la:126, lfa:206, ra:126, rfa:206, lth:4, lsh:14, rth:4, rsh:14 },
    track:'head' },

  chinup: { view:'side', arch:'dynamic', path:'line', ghost:'all', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hang({ trunk:178, nua:178, nfa:180, fua:174, ffa:176 }),
    end:  hang({ trunk:168, neck:176, nua:-14, nfa:162, fua:-18, ffa:158, nth:24, nsh:-20, fth:28, fsh:-16 }),
    track:'head' },

  pullup_weighted: { view:'front', arch:'dynamic', path:'line', arrow:{ shift:[0, 24] }, ghost:'all', key:'end', ground:false,
    scene:[['rod', { a:[14, 18], b:[106, 18], w:2.6 }]],
    start:{ pin:['lW', [38, 18]], la:164, lfa:176, ra:164, rfa:176, lth:2, lsh:8, rth:2, rsh:8 },
    end:  { pin:['lW', [38, 18]], la:126, lfa:206, ra:126, rfa:206, lth:4, lsh:14, rth:4, rsh:14 },
    gear:[['rod', { a:'lap', b:'lap', bdy:14, c:'dim', w:1.2 }], ['disc', { at:'lap', dy:18, r:5.6 }]], gearFront:true,
    track:'head' },

  assisted_pullup: { view:'side', arch:'machine', ghost:'all', key:'end',
    scene:[['post', { a:[40, 10], b:[40, G] }], ['rod', { a:[40, 14], b:[65, 14], w:2.6 }], ['bar', { at:[60, 16], r:2.6 }]],
    start:hang({ trunk:178, nua:178, nfa:180, fua:174, ffa:176, nth:88, nsh:-2, fth:86, fsh:-4 }),
    end:  hang({ trunk:170, neck:176, nua:-14, nfa:162, fua:-18, ffa:158, nth:88, nsh:-2, fth:86, fsh:-4 }),
    gear:[['pad', { a:'nK', adx:-8, ady:3, b:'nK', bdx:6, bdy:3, w:4.6 }], ['rod', { a:'nK', adx:-6, ady:4, b:[40, 70], c:'dim', w:2 }]],
    track:'head' },

  /* ---- hinges ---- */
  deadlift_conventional: { view:'side', arch:'hinge', key:'start',
    start:S({ trunk:120, neck:136, nth:64, nsh:-22, fth:62, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW', dy:3 }]], track:'nW' },

  sumo_deadlift: { view:'front', arch:'hinge', key:'start',
    start:{ pin:['lA', [36, 104.3]], hipY:74, lth:62, lsh:6, rth:62, rsh:6, lean:0, la:-2, lfa:-4, ra:-2, rfa:-4, torsoScale:0.7 },
    end:  { pin:['lA', [36, 104.3]], lth:26, lsh:4, rth:26, rsh:4, la:4, lfa:2, ra:4, rfa:2 },
    gear:[['barFront', { half:40, pr:8.4 }]], track:'rW' },

  deficit_deadlift: { view:'side', arch:'hinge', key:'start',
    scene:[['step', { x:40, w:36, h:5 }]],
    start:S({ pin:['nA', [58, 99.3]], trunk:118, neck:134, nth:68, nsh:-24, fth:64, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ pin:['nA', [58, 99.3]], nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW', dy:3 }]], track:'nW' },

  trap_bar_deadlift: { view:'side', arch:'hinge', key:'start',
    start:S({ trunk:138, neck:150, nth:74, nsh:-30, fth:72, fsh:-34, nua:-2, nfa:0, fua:-6, ffa:-4 }),
    end:  S({ nua:2, nfa:0, fua:-2, ffa:-2 }),
    gear:[['plate', { at:'nW', r:7.8 }], ['rod', { a:'nW', adx:-15, b:'nW', bdx:15, w:2.4 }]], gearFront:true, track:'nW' },

  rack_pull: { view:'side', arch:'hinge', key:'start',
    scene:[['rail', { a:[76, 20], b:[76, G], w:2.8 }], ['rod', { a:[70, 76], b:[82, 76], w:2.4 }]],
    start:S({ trunk:140, neck:152, nth:30, nsh:-14, fth:26, fsh:-16, nua:-8, nfa:-6, fua:-12, ffa:-10 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  db_deadlift: { view:'side', arch:'hinge', key:'start',
    start:S({ trunk:124, neck:138, nth:62, nsh:-22, fth:60, fsh:-26, nua:-4, nfa:-2, fua:-8, ffa:-6 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['db', { at:'nW', a:90, len:5 }]], track:'nW' },

  /* Romanian deadlift: from standing, the hips push back with soft knees and
     the bar slides down the thighs to just below the knee, hanging over
     mid-foot. The hinged bottom is the drawing; standing tall is the ghost. */
  deadlift_romanian: { view:'side', arch:'hinge', arrow:{ side:-1 }, both:true,
    start:hingeTop({ nua:10, nfa:6, fua:6, ffa:2 }),
    end:  sideHands(hinge([47, 69], { trunk:104, neck:112 }), [61.5, 87.6], [60.7, 88], -1),
    gear:[['plate', { at:'nW', dy:2 }]], track:'nW' },

  db_rdl: { view:'side', arch:'hinge', arrow:{ side:-1 }, both:true,
    start:hingeTop({ nua:8, nfa:4, fua:4, ffa:0 }),
    end:  sideHands(hinge([47, 69], { trunk:104, neck:112 }), [62, 88.6], [61.2, 89], -1),
    gear:[['db', { at:'fW', a:90, len:5 }], ['db', { at:'nW', a:90, len:5 }]], track:'nW' },

  /* Single-leg RDL: the standing knee stays soft, the free leg rises in line
     with the torso, and the weight hangs in front of the standing shin. */
  single_leg_rdl: { view:'side', arch:'hinge', arrow:{ side:-1 }, both:true,
    start:planted({ pin:['hip', [57, 66.6]], trunk:180, neck:180, fth:-12, fsh:-36, fft:40, nua:6, nfa:4, fua:2, ffa:0 }, HINGE_FEET[0], null),
    end:  sideHands(planted({ pin:['hip', [53, 67.5]], trunk:108, neck:114, fth:-72, fsh:-72, fft:0 }, HINGE_FEET[0], null), [70.5, 88], [69.7, 88.4], -1),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  /* Good morning: bar on the upper back, soft knees, the hips travel back as
     the chest lowers toward level. */
  good_morning: { view:'side', arch:'hinge', path:'trace', both:true,
    start:hingeTop({ nua:-40, nfa:160, fua:-44, ffa:156 }),
    end:  hinge([46.5, 68.5], { trunk:102, neck:112, nua:-118, nfa:82, fua:-122, ffa:78 }),
    gear:[['plate', { at:'back', dy:-1 }]], track:'back' },

  /* 45-degree back extension: feet low behind, thighs on the pad, torso rises to a straight line. */
  back_extension: { view:'side', arch:'dynamic', key:'end',
    scene:[['pad', { a:'hip', b:'nK', off:7.6, extA:-2, extB:-8, w:6 }], ['post', { a:'hip', adx:6, ady:12, b:[70, G] }],
      ['rod', { a:'nT', adx:-2.7, ady:5.8, b:'nT', bdx:5.8, bdy:-2.7, w:2.6 }], ['post', { a:'nT', adx:1.6, ady:1.6, b:[34, G] }],
      ['bar', { at:'nA', r:2.4, dx:-3.4, dy:-3.4 }]],
    start:ext({ pin:['nA', [30, 90]], nth:-45, nsh:-45, fth:-45, fsh:-45, nft:45, fft:45, trunk:34, neck:30 }, folded(34)),
    end:  ext({ pin:['nA', [30, 90]], nth:-45, nsh:-45, fth:-45, fsh:-45, nft:45, fft:45, trunk:135, neck:138 }, folded(135)),
    track:'head' },


  superman_hold: { view:'side', arch:'hold',
    end:{ pin:['hip', [60, G - 5.1]], trunk:100, neck:106, nth:-100, nsh:-100, fth:-98, fsh:-98, nft:-90, fft:-90, nua:118, nfa:118, fua:114, ffa:114 } },

  kb_swing: { view:'side', arch:'hinge', path:'trace', key:'end',
    start:S({ trunk:118, neck:134, nth:26, nsh:-14, fth:22, fsh:-16, nua:-18, nfa:-20, fua:-22, ffa:-24 }),
    end:  S({ nua:92, nfa:92, fua:88, ffa:88 }),
    gear:[['kettlebell', { at:'nW', dx:2 }]], track:'nW' },

  cable_pull_through: { view:'side', arch:'hinge', key:'start',
    scene:[['column', { x:14, top:50 }]],
    start:S({ trunk:106, neck:118, nth:14, nsh:-12, fth:8, fsh:-14, nua:-24, nfa:-30, fua:-28, ffa:-34 }),
    end:  S({ nua:-4, nfa:-6, fua:-8, ffa:-10 }),
    gear:[['cable', { from:[18, 100], to:'nW', grip:'rope' }]], track:'hip' },

  hip_thrust: { view:'side', arch:'hinge', arrow:{ shift:[0, 3], slide:[0, 2.5, 5] }, key:'end',
    scene:[['bench', { x1:8, x2:38, y:91, h:5 }]],
    start:HT_BOTTOM, end:HT_TOP,
    gear:[['plate', { at:'lap' }]], gearFront:true, track:'hip' },

  hip_thrust_machine: { view:'side', arch:'machine', arrow:{ shift:[0, 3], slide:[0, 2.5, 5] }, key:'end',
    scene:[['pad', { a:[8, 93.4], b:[38, 93.4], w:5 }], ['post', { a:[22, 96], b:[22, G] }], ['post', { a:[100, HT_PIVOT[1] - 2], b:[100, G] }]],
    start:HT_BOTTOM, end:HT_TOP,
    gear:[['lever', { pivot:HT_PIVOT, to:'lap', dy:-2, roller:4.2 }]], gearFront:true, track:'hip' },

  glute_bridge: { view:'side', arch:'hinge', key:'end',
    start:GB_BOTTOM, end:GB_TOP, track:'hip' },

  single_leg_glute_bridge: { view:'side', arch:'hinge', key:'end',
    start:ext(GB_BOTTOM, { fth:104, fsh:104, fft:170 }),
    end:  ext(GB_TOP, { fth:118, fsh:118, fft:190 }),
    track:'hip' },

  nordic_curl: { view:'side', arch:'dynamic', key:'end',
    scene:[['mat', { x:30, y:103.6, w:42, h:2.4 }], ['pad', { a:[33, 93.4], b:[45, 93.4], w:5 }], ['post', { a:[34, 94], b:[28, G] }]],
    start:ext({ pin:['nK', [58, 100.2]], nth:0, nsh:-90, fth:0, fsh:-90, nft:-90, fft:-90, trunk:180, neck:180 }, folded(180)),
    end:  { pin:['nK', [58, 100.2]], nth:-58, nsh:-90, fth:-58, fsh:-90, nft:-90, fft:-90, trunk:122, neck:118, nua:84, nfa:96, fua:80, ffa:92 },
    track:'head' },

  /* Lying leg curl: face down on the pad, knees just past its end and in line
     with the machine's pivot, hands on the grips. The roller sits behind the
     ankles and travels round the knee as the heels curl toward the glutes. */
  leg_curl: { view:'side', arch:'machine', path:'trace', ghost:'legs', flip:true,
    scene:[['pad', { a:[14, 80], b:[64, 80], w:6 }], ['post', { a:[24, 83], b:[24, G] }], ['post', { a:[56, 83], b:[56, G] }],
      ['post', { a:[14, 83], b:[14, 90] }]],
    start:sideHands({ pin:['hip', [48, 74]], trunk:-90, neck:-96, nth:90, nsh:90, fth:90, fsh:90, nft:0, fft:0 }, [14, 88], [15, 88.5], 1),
    end:  sideHands({ pin:['hip', [48, 74]], trunk:-90, neck:-96, nth:90, nsh:-160, fth:90, fsh:-164, nft:-70, fft:-70 }, [14, 88], [15, 88.5], 1),
    gear:[['lever', { pivot:[67.5, 74], to:{ seg:['nK', 'nA'], t:0.86, n:7.6 }, roller:4.4 }]], track:'nA' },

  leg_curl_seated: { view:'side', arch:'machine', path:'trace', ghost:'legs', key:'end',
    scene:[['pad', { a:[30, 86.6], b:[60, 86.6], w:5 }], ['pad', { a:[36, 84], b:[31, 50], w:5.4 }], ['post', { a:[44, 89], b:[44, G] }], ['post', { a:[34, 89], b:[30, G] }],
      ['post', { a:LEG_CURL_KNEE, b:[LEG_CURL_KNEE[0] + 4, G] }]],
    front:[['pad', { a:{ seg:['hip', 'nK'], t:0.58, n:7.2 }, b:{ seg:['hip', 'nK'], t:0.96, n:7.2 }, w:5.4 }]],
    start:legCurlSeat(80, 76),
    end:  legCurlSeat(-34, -38),
    gear:[['lever', { pivot:LEG_CURL_KNEE, to:{ seg:['nK', 'nA'], t:0.86, n:-6.6 }, roller:3.6 }]], gearFront:true, track:'nA' },

  glute_kickback_cable: { view:'side', arch:'cable', ghost:'legs',
    scene:[['column', { x:96, top:20 }]],
    start:S({ pin:['fA', [62, 104.3]], trunk:130, neck:136, fth:10, fsh:-4, nth:0, nsh:-40, nft:80, nua:70, nfa:74, fua:66, ffa:70 }),
    end:  S({ pin:['fA', [62, 104.3]], trunk:130, neck:136, fth:10, fsh:-4, nth:-78, nsh:-70, nft:30, nua:70, nfa:74, fua:66, ffa:70 }),
    gear:[['cable', { from:[92, 100], to:'nA' }]], track:'nA' },

  farmers_carry: { view:'side', arch:'locomotion', ghost:'none',
    start:S({ pin:['nA', [50, 104.3]], nth:-20, nsh:-6, fth:20, fsh:-14, nua:2, nfa:0, fua:-2, ffa:-2 }),
    end:  S({ pin:['nA', [66, 104.3]], nth:20, nsh:-14, fth:-20, fsh:-6, nua:2, nfa:0, fua:-2, ffa:-2 }),
    gear:[['db', { at:'fW', a:90, len:5.4, hw:7 }], ['db', { at:'nW', a:90, len:5.4, hw:7 }]],
    travel:{ dir:1 } },

  power_clean: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:S({ trunk:120, neck:136, nth:64, nsh:-22, fth:62, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ trunk:176, nth:34, nsh:-30, fth:30, fsh:-32, nua:96, nfa:-84, fua:92, ffa:-88 }),
    gear:[['plate', { at:'nW', dx:2 }]], gearFront:true, track:'nW' }
  });
  })(EXV);

  /* Legs: squats, presses, lunges, step-ups, jumps, knee and calf isolation. */
  (function(H){
  var G = H.G, S = H.S, ext = H.extend, planted = H.planted, at = H.at;

  /* Standing squat stance: near ankle planted, far ankle just behind it. */
  var FAR_FOOT = [55, 104.5];
  function sq(o){ return planted(S(o), null, FAR_FOOT); }
  /* Hands on a bar across the upper back, turned with the torso. */
  function barBack(trunk){ var r = trunk - 180; return { nua:-40 + r, nfa:160 + r, fua:-44 + r, ffa:156 + r }; }
  /* Elbows high, bar resting in the front rack. */
  function rackArms(trunk){ var r = trunk - 180; return { nua:100 + r, nfa:-80 + r, fua:96 + r, ffa:-84 + r }; }
  /* Front views. */
  function F(o){ return ext({ pin:['lA', [51.5, 104.3]], lth:8, lsh:4, rth:8, rsh:4 }, o); }
  function FS(o){ return ext({ pin:['hc', [60, 79.5]], thighScale:0.34, lth:18, lsh:4, rth:18, rsh:4 }, o); }

  /* Hack squat: back on a sled that rides rails parallel to the torso, feet on a platform. */
  var HACK_FEET = [[74, 101], [71, 101.2]];
  function hack(hip){ return planted({ pin:['hip', hip], trunk:-160, neck:-172, nua:40, nfa:180, fua:36, ffa:176, nft:90, fft:90 }, HACK_FEET[0], HACK_FEET[1]); }
  /* 45-degree leg press: the ankle rides a line parallel to the rail, s units
     along it; the sole stays square to the plate. */
  function legPress(s){
    var ankle = [42.1 + 0.7071 * s, 92.1 - 0.7071 * s];
    return planted({ pin:['hip', [40, 88]], trunk:-125, neck:-140, nua:24, nfa:68, fua:20, ffa:64, nft:-135, fft:-135 }, ankle, [ankle[0] - 1.2, ankle[1] + 1.2]);
  }
  /* Lunges: split stance, front foot planted, rear heel up. */
  var LUNGE_FEET = [[72, 104.3], [20.5, 100.0]];
  function lunge(hip, arms){ return planted(ext({ pin:['hip', hip], trunk:178, neck:178, nft:90, fft:-49 }, arms), LUNGE_FEET[0], LUNGE_FEET[1]); }
  var DB_SIDES = { nua:2, nfa:0, fua:-2, ffa:-2 };
  var HANDS_ON_HIPS = { nua:-30, nfa:60, fua:-34, ffa:56 };
  /* Bulgarian split squat: rear instep on a bench. */
  var BSS_FEET = [[72, 104.3], [19, 83.2]];
  function bss(hip){ return planted({ pin:['hip', hip], trunk:172, neck:176, nft:90, fft:-90, nua:2, nfa:0, fua:-2, ffa:-2 }, BSS_FEET[0], BSS_FEET[1]); }
  /* Step-ups onto a box whose top is at y=84. */
  var STEP_BOX = ['step', { x:62, w:34, h:22 }];
  function stepStart(arms){ return planted(ext({ pin:['hip', [55, 72]], trunk:168, neck:174, nft:90, fft:90 }, arms), [74, 81.5], [48, 104.3]); }
  function stepTop(arms){
    var p = ext({ pin:['nA', [74, 81.5]], trunk:178, neck:180, nth:0, nsh:0, fth:84, fsh:-6, fft:80 }, arms);
    return ext(p, { pin:['hip', at('side', p, 'hip')] });
  }
  /* Jumps. */
  var LB_START = { pin:['lA', [30, 104.3]], lean:-8, thighScale:0.84, lth:-6, lsh:4, rth:-24, rsh:-64, la:-30, lfa:-50, ra:40, rfa:60 };
  var LB_END   = { pin:['rA', [90, 104.3]], lean:8, thighScale:0.84, rth:-6, rsh:4, lth:-24, lsh:-64, ra:-30, rfa:-50, la:40, lfa:60 };
  var BJ_START = S({ pin:['nA', [34, 104.3]], trunk:128, neck:140, nth:62, nsh:-26, fth:60, fsh:-28, nua:-56, nfa:-44, fua:-60, ffa:-48 });
  var BJ_END   = { pin:['nA', [80, 77.5]], trunk:140, neck:150, nth:84, nsh:-28, fth:82, fsh:-30, nua:80, nfa:84, fua:76, ffa:80 };
  var BR_START = S({ pin:['nA', [24, 104.3]], trunk:122, neck:136, nth:56, nsh:-24, fth:54, fsh:-26, nua:-60, nfa:-50, fua:-64, ffa:-54 });
  var BR_END   = S({ pin:['nA', [92, 104.3]], trunk:140, neck:150, nth:82, nsh:-30, fth:80, fsh:-32, nua:84, nfa:88, fua:80, ffa:84 });
  /* Seated calf raise: toes fixed on the block, the heel lifts the knee against the pad. */
  var CS_TOE = [76, 99.4];
  /* Leg press calf raise: the legs long and still, the balls of the feet on the
     lower edge of the footplate. The ankles alone move the sled a short way up
     the rail, so the plate, its bracket and the carriage are placed from the
     ball of the foot, along and across the rail. */
  var CALF_PRESS_ANKLE = [73.2, 71.1];
  var BALL = { seg:['nA', 'nT'], t:0.62 };
  function calfPress(foot){
    return planted({ pin:['hip', [40, 88]], trunk:-125, neck:-140, nua:24, nfa:68, fua:20, ffa:64, nft:foot, fft:foot },
      CALF_PRESS_ANKLE, [CALF_PRESS_ANKLE[0] - 1.2, CALF_PRESS_ANKLE[1] + 1.2]);
  }
  function seatedCalf(footAngle){
    var ankle = [CS_TOE[0] - Math.sin(footAngle * Math.PI / 180) * 7.4, CS_TOE[1] - Math.cos(footAngle * Math.PI / 180) * 7.4];
    return planted({ pin:['hip', [48, 84.9]], trunk:178, neck:180, nft:footAngle, fft:footAngle, nua:30, nfa:60, fua:26, ffa:56 }, ankle, [ankle[0] - 1, ankle[1]]);
  }

  H.add({

  /* ---- squats ---- */
  squat_back: { view:'side', arch:'dynamic', path:'line', both:true,
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:88, nsh:-28, trunk:142, neck:150 }, barBack(142))),
    gear:[['plate', { at:'back' }]], track:'hip', trackOffset:[-9, 0] },

  squat_front: { view:'side', arch:'dynamic', path:'line', both:true,
    start:sq(ext({ trunk:180 }, rackArms(180))),
    end:  sq(ext({ nth:92, nsh:-34, trunk:160, neck:166 }, rackArms(160))),
    gear:[['plate', { at:'rack' }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  box_squat: { view:'side', arch:'dynamic', path:'line', both:true,
    scene:[['plinth', { at:'hip', dx:-4, dy:5.2, w:16 }]],
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:80, nsh:-8, trunk:138, neck:146 }, barBack(138))),
    gear:[['plate', { at:'back' }]], track:'hip', trackOffset:[-12, -2] },

  squat_smith: { view:'side', arch:'machine', both:true,
    scene:[['guide', { at:'back', top:6 }]],
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:90, nsh:-20, trunk:150, neck:158 }, barBack(150))),
    gear:[['plate', { at:'back', r:7.4 }]], track:'hip', trackOffset:[-9, 0] },

  squat_goblet: { view:'side', arch:'dynamic', path:'line', both:true,
    start:sq({ nua:24, nfa:170, fua:20, ffa:166 }),
    end:  sq({ nth:92, nsh:-32, trunk:158, neck:164, nua:14, nfa:170, fua:10, ffa:166 }),
    gear:[['db', { at:'nW', a:180, len:4.2, hw:6.6 }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  squat_goblet_kb: { view:'side', arch:'dynamic', path:'line', both:true,
    start:sq({ nua:24, nfa:170, fua:20, ffa:166 }),
    end:  sq({ nth:92, nsh:-32, trunk:158, neck:164, nua:14, nfa:170, fua:10, ffa:166 }),
    gear:[['kettlebell', { at:'nW', dy:-1 }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  squat_hack: { view:'side', arch:'machine', ghost:'legs', both:true,
    scene:[['rail', { a:'hip', b:'sh', off:15, extA:12, extB:26, w:3 }], ['pad', { a:'hip', b:'sh', off:9.4, extA:3, extB:2, w:6 }], ['step', { x:62, w:30, h:3 }]],
    start:hack([58.8, 67.2]),
    end:  hack([64.84, 84.79]),
    track:'hip', trackOffset:[-4, 0] },

  /* 45-degree leg press. The sled rides a rail at 45 degrees and the
     footplate stands square to it. Back on the reclined pad, hips on the
     seat, feet flat on the plate: the knees come deep toward the chest, then
     the legs press the sled up the rail. */
  leg_press: { view:'side', arch:'machine', key:'start', both:true, ghost:'legs',
    scene:[['rail', { a:[50.6, 103.4], b:[101.5, 52.5], w:3.2 }], ['post', { a:[99, 55], b:[99, G] }],
      ['pad', { a:[30, 94.6], b:[50, 92.6], w:5 }], ['post', { a:[40, 96], b:[40, G] }],
      ['pad', { a:'hip', b:'sh', off:9.2, extA:-3, extB:5, w:6 }]],
    start:legPress(19.9),
    end:  legPress(38.9),
    gear:[['rod', { a:'nA', adx:1, ady:-3.8, b:'nA', bdx:12.3, bdy:7.5, w:2.4 }],
      ['pad', { a:'nA', adx:7.35, ady:12.45, b:'nA', bdx:17.25, bdy:2.55, w:5 }],
      ['pad', { a:'nA', adx:7.35, ady:2.55, b:'nA', bdx:-5.38, bdy:-10.18, w:4.6 }]],
    track:'nA' },

  bodyweight_squat: { view:'side', arch:'dynamic', path:'line', both:true,
    start:sq({ nua:4, nfa:2, fua:0, ffa:-2 }),
    end:  sq({ nth:92, nsh:-32, trunk:150, neck:158, nua:92, nfa:92, fua:88, ffa:88 }),
    track:'hip', trackOffset:[-9, 0] },

  band_squat: { view:'side', arch:'dynamic', path:'line', both:true, gearFront:true,
    start:sq({ nua:22, nfa:168, fua:18, ffa:164 }),
    end:  sq({ nth:92, nsh:-32, trunk:156, neck:162, nua:12, nfa:160, fua:8, ffa:156 }),
    gear:[['band', { from:'nT', fdx:-3, to:'nW', bowX:3 }]], track:'hip', trackOffset:[-9, 0] },

  wall_sit: { view:'side', arch:'hold',
    scene:[['wall', { x:24, top:30 }]],
    end:{ pin:['hip', [36.2, 85.8]], trunk:180, neck:180, nth:90, nsh:0, fth:90, fsh:-4, nft:90, fft:90, nua:14, nfa:84, fua:10, ffa:80 } },

  squat_to_press: { view:'side', arch:'press', key:'end', thumbGhost:'legs',
    start:sq({ nth:92, nsh:-32, trunk:156, neck:162, nua:30, nfa:176, fua:26, ffa:172 }),
    end:  sq({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['db', { at:'nW', a:90, len:4.6 }]], track:'nW' },

  /* ---- lunges and single-leg work ---- */
  lunge: { view:'side', arch:'dynamic', path:'line', arrow:{ side:1, slide:[9, 12, 15] }, both:true,
    start:lunge([46.6, 76], DB_SIDES),
    end:  lunge([52.5, 85.8], DB_SIDES),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[0, -8] },

  /* Walking lunge: one grounded lunge, and an arrow along the floor saying the
     athlete travels forward. D57 drew the next moment as a faint second body —
     standing over the front foot as the back leg swings through — but its only
     planted foot hid exactly behind the solid front foot and its other foot was
     in the air, so it read as a person hovering beside the lunge (D59). The
     front shin is vertical over a flat front foot, the rear knee is lowered to
     just above the floor and the rear toes are on it. */
  lunge_walking: { view:'side', arch:'locomotion',
    end:  lunge([52.5, 85.8], { nua:16, nfa:30, fua:-14, ffa:-6 }),
    travel:{ dir:1 } },

  bodyweight_lunge: { view:'side', arch:'dynamic', path:'line', arrow:{ side:1, slide:[9, 12, 15] }, both:true,
    start:lunge([46.6, 76], HANDS_ON_HIPS),
    end:  lunge([52.5, 85.8], HANDS_ON_HIPS),
    track:'hip', trackOffset:[0, -10] },

  split_squat_bulgarian: { view:'side', arch:'dynamic', path:'line', arrow:{ side:1, slide:[9, 12, 15] }, both:true,
    scene:[['bench', { x1:-2, x2:25, y:86 }]],
    start:bss([52, 73]),
    end:  bss([50, 86]),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[0, -9] },

  step_up: { view:'side', arch:'dynamic', path:'line', scene:[STEP_BOX],
    start:stepStart({ nua:-30, nfa:-10, fua:30, ffa:60 }),
    end:  stepTop({ nua:30, nfa:60, fua:-30, ffa:-10 }),
    track:'hip', trackOffset:[-8, 0] },

  db_step_up: { view:'side', arch:'dynamic', path:'line', scene:[STEP_BOX],
    start:stepStart(DB_SIDES),
    end:  stepTop(DB_SIDES),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[-8, 0] },

  /* ---- jumps ---- */
  lateral_bound: { view:'front', arch:'dynamic', path:'flight',
    start:LB_START, end:LB_END,
    track:'hc', flight:14 },

  box_jump: { view:'side', arch:'dynamic', path:'flight',
    scene:[['step', { x:66, w:32, h:26 }]],
    start:BJ_START, end:BJ_END,
    track:'hip', flight:16 },

  broad_jump: { view:'side', arch:'dynamic', path:'flight',
    start:BR_START, end:BR_END,
    track:'hip', flight:20 },

  /* ---- machines and isolation ---- */
  leg_extension: { view:'side', arch:'machine', path:'trace', ghost:'legs',
    scene:[['pad', { a:[34, 86.6], b:[68, 86.6], w:5 }], ['pad', { a:[40, 84], b:[38, 50], w:5.4 }], ['post', { a:[50, 89], b:[50, G] }], ['post', { a:[40, 89], b:[36, G] }]],
    start:{ pin:['hip', [50, 80]], trunk:176, neck:178, nth:90, fth:88, nsh:-4, fsh:-6, nft:90, fft:90, nua:30, nfa:40, fua:26, ffa:36 },
    end:  { pin:['hip', [50, 80]], trunk:176, neck:178, nth:90, fth:88, nsh:88, fsh:84, nft:170, fft:166, nua:30, nfa:40, fua:26, ffa:36 },
    gear:[['lever', { pivot:[69.5, 80], to:'nA', roller:3.4 }]], gearFront:true, track:'nA' },

  calf_raise: { view:'side', arch:'dynamic', path:'line', crop:'lower',
    scene:[['step', { x:64, w:16, h:6 }]],
    start:{ pin:['nT', [68, 97.4]], nft:112, fft:112, trunk:180, nua:4, nfa:2, fua:0, ffa:-2 },
    end:  { pin:['nT', [68, 97.4]], nft:50, fft:50, trunk:180, nua:4, nfa:2, fua:0, ffa:-2 },
    track:'nA', trackOffset:[-5.5, 0] },

  calf_raise_seated: { view:'side', arch:'machine', arrow:{ shift:[0, -7] }, crop:'lower', ghost:'legs',
    scene:[['pad', { a:[30, 92], b:[58, 92], w:5 }], ['post', { a:[44, 95], b:[44, G] }], ['step', { x:70, w:14, h:4 }]],
    start:seatedCalf(112),
    end:  seatedCalf(60),
    gear:[['pad', { a:'nK', adx:-7, ady:-6.4, b:'nK', bdx:5, bdy:-6.4, w:5 }]], gearFront:true,
    track:'nA', trackOffset:[-5.5, 0] },

  calf_raise_leg_press: { view:'side', arch:'machine', path:'line', key:'end', ghost:'legs',
    scene:[['rail', { a:[50.6, 103.4], b:[101.5, 52.5], w:3.2 }], ['post', { a:[99, 55], b:[99, G] }],
      ['pad', { a:[30, 94.6], b:[50, 92.6], w:5 }], ['post', { a:[40, 96], b:[40, G] }],
      ['pad', { a:'hip', b:'sh', off:9.2, extA:-3, extB:5, w:6 }]],
    start:calfPress(-108),
    end:  calfPress(-165),
    gear:[['rod', { a:BALL, adx:-1.56, ady:-11.17, b:BALL, bdx:12.52, bdy:2.9, w:2.4 }],
      ['pad', { a:BALL, adx:6.29, ady:9.12, b:BALL, bdx:18.32, bdy:-2.9, w:5 }],
      ['pad', { a:BALL, adx:3.39, ady:-1.27, b:BALL, bdx:-10.39, bdy:-15.06, w:4.6 }]],
    track:BALL },

  hip_abduction: { view:'front', arch:'machine', path:'trace', ghost:'legs', both:true,
    scene:[['box', { x:44, y:26, w:32, h:56 }]],
    start:FS({ lth:8, lsh:10, rth:8, rsh:10, la:20, lfa:10, ra:20, rfa:10 }),
    end:  FS({ thighScale:0.7, lth:60, lsh:14, rth:60, rsh:14, la:20, lfa:10, ra:20, rfa:10 }),
    gear:[['pad', { a:'lK', adx:-5.6, ady:-5, b:'lK', bdx:-5.6, bdy:5, w:4.4 }], ['pad', { a:'rK', adx:5.6, ady:-5, b:'rK', bdx:5.6, bdy:5, w:4.4 }]], gearFront:true,
    track:'rK' },

  band_lateral_walk: { view:'front', arch:'locomotion', ghost:'legs',
    start:F({ pin:['lA', [44, 104.3]], thighScale:0.86, lth:6, lsh:2, rth:6, rsh:2, la:40, lfa:-30, ra:40, rfa:-30 }),
    end:  F({ pin:['lA', [36, 104.3]], thighScale:0.86, lth:20, lsh:8, rth:20, rsh:8, la:40, lfa:-30, ra:40, rfa:-30 }),
    gear:[['band', { from:'lK', fdy:-2, to:'rK', dy:-2 }]], gearFront:true,
    travel:{ dir:1 } }
  });
  })(EXV);

  /* Core, carries and conditioning: planks, crunches, raises, rotations, slams, sleds. */
  (function(H){
  var G = H.G, S = H.S, ext = H.extend, planted = H.planted, at = H.at, handsAt = H.handsAt, sideHands = H.sideHands, seat = H.seated;

  /* Front view standing, feet apart. */
  function F(o){ return ext({ pin:['lA', [51.5, 104.3]], lth:8, lsh:4, rth:8, rsh:4 }, o); }
  /* Lying face up on the floor, head to the left. */
  function supine(o){ return ext({ pin:['hip', [62, G - 6.2]], trunk:-90, neck:-94 }, o); }
  /* Arms folded across the chest, turned with the torso. */
  function folded(trunk){ var r = trunk - 180; return { nua:20 + r, nfa:150 + r, fua:16 + r, ffa:146 + r }; }
  /* Hands behind the head, turned with the torso. */
  function behindHead(trunk){ var r = trunk - 180; return { nua:150 + r, nfa:-80 + r, fua:146 + r, ffa:-84 + r }; }
  /* Knees bent, feet flat on the floor. */
  var FLOOR_FEET = [[90, 104.3], [87, 104.5]];
  function kneesUp(pose){ return planted(pose, FLOOR_FEET[0], FLOOR_FEET[1]); }

  /* Forearm plank: elbows under the shoulders, the body angle solved to land the toes. */
  function forearmPlank(){
    return ExerciseArt.fit('side', function(a){
      return { pin:['nE', [80, G - 3.4]], nua:0, nfa:90, fua:-2, ffa:88, trunk:a, neck:a - 6,
        nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0 };
    }, 60, 150, 'nT', G - 1.2);
  }
  /* Side plank seen from the front: turn the figure until the stacked feet reach the floor. */
  function sidePlank(topArm){
    return ExerciseArt.fit('front', function(r){
      return ext({ pin:['rE', [84, G - 3.4]], rot:r, ra:r, rfa:r + 90, rfaS:0.25, lth:-3, lsh:0, rth:-3, rsh:0 }, topArm(r));
    }, 40, 88, 'rT', G - 2);
  }
  /* Mountain climber: hands planted, one knee driven under the chest, the other leg long. */
  function climber(nearDriven){
    return ExerciseArt.fit('side', function(a){
      var p = { pin:['nW', [84, G - 2.7]], nua:-4, nfa:-4, fua:-6, ffa:-6, trunk:a, neck:a - 6 };
      var driven = { th:80, sh:-40, ft:-70 }, lng = { th:a - 180, sh:a - 180, ft:0 };
      var n = nearDriven ? driven : lng, f = nearDriven ? lng : driven;
      return ext(p, { nth:n.th, nsh:n.sh, nft:n.ft, fth:f.th, fsh:f.sh, fft:f.ft });
    }, 60, 150, nearDriven ? 'fT' : 'nT', G - 1.2);
  }
  /* Kneeling for cable crunches and the ab wheel. */
  function kneel(knee, o){ return ext({ pin:['nK', knee], nsh:-90, nft:-90, fsh:-90, fft:-90 }, o); }
  /* Cable crunch: hands hold the rope beside the forehead. */
  function ropeCrunch(trunk, neck){
    var p = kneel([48, G - 4.4], { nth:16, fth:14, trunk:trunk, neck:neck });
    var head = at('side', p, 'head');
    var fwd = [Math.sin((neck + 90) * Math.PI / 180) * 6, Math.cos((neck + 90) * Math.PI / 180) * 6];
    return sideHands(p, [head[0] + fwd[0], head[1] + fwd[1]], [head[0] + fwd[0] - 1, head[1] + fwd[1] + 1], 1);
  }
  /* Ab wheel: hands on the wheel's hub. */
  function wheelPose(nth, trunk, hubX){
    var p = kneel([36, G - 4.4], { nth:nth, fth:nth, trunk:trunk, neck:trunk + 6 });
    return sideHands(p, [hubX, G - 4.4], [hubX - 1, G - 4.4], 1);
  }
  /* Captain's chair: forearms on the pads, back on the pad. */
  function chair(o){ return ext({ pin:['nE', [60, 46]], nua:0, nfa:90, fua:-2, ffa:88, trunk:180, neck:180, nft:90, fft:90 }, o); }
  /* Hanging from a bar at (60, 16). */
  function hanging(o){ return ext({ pin:['nW', [60, 16]], nua:180, nfa:180, fua:176, ffa:176, trunk:180, neck:180 }, o); }
  /* Seated V for Russian twists, seen from the front. */
  function vSit(o){ return ext({ pin:['hc', [60, 101.6]], torsoScale:0.9, thighScale:0.62, shinScale:0.46, lth:146, lsh:70, rth:146, rsh:70, sw:7.2 }, o); }
  /* Decline bench: surface from (18, 92) up to (76, 71). */
  var DECLINE = { trunk:-70, hip:[46.9, 72.3] };
  function decline(o){ return ext({ pin:['hip', DECLINE.hip], nth:110, nsh:30, fth:108, fsh:28, nft:90, fft:90 }, o); }
  /* Athletic stance with both feet planted. */
  var AT_FEET = [[62, 104.3], [50, 104.5]];
  function athletic(o){ return planted(ext({ pin:['hip', [56, 72]] }, o), AT_FEET[0], AT_FEET[1]); }
  /* Sled: posts at x+1..x+11, handle tops at y = G - 27. */
  var SLED_X = 82;

  H.add({

  /* ---- planks and holds ---- */
  plank: { view:'side', arch:'hold', end:forearmPlank() },

  weighted_plank: { view:'side', arch:'hold', end:forearmPlank(),
    gear:[['pad', { a:'hip', b:'sh', off:9.6, extA:-4, extB:-6, w:3.6 }]] },

  side_plank: { view:'front', arch:'hold',
    end:sidePlank(function(r){ return { la:8, lfa:-40 }; }) },

  side_plank_reach: { view:'front', arch:'dynamic', both:true, key:'start',
    start:sidePlank(function(r){ return { la:180 - r, lfa:180 - r }; }),
    end:  sidePlank(function(r){ return { la:36 - r, lfa:10 - r }; }),
    track:'lW' },

  hollow_hold: { view:'side', arch:'hold',
    end:supine({ trunk:-102, neck:-112, nua:-110, nfa:-110, fua:-112, ffa:-112, nth:104, nsh:104, fth:102, fsh:102, nft:180, fft:180 }) },

  /* ---- crunches and sit-ups ---- */
  crunch: { view:'side', arch:'dynamic', key:'end',
    start:kneesUp(supine(ext({ trunk:-90 }, behindHead(-90)))),
    end:  kneesUp(supine(ext({ trunk:-122, neck:-138 }, behindHead(-122)))),
    track:'sh' },

  /* Ab crunch machine: the chest pad and its handles on a lever that turns about
     the hips, so the pad stays on the chest as the torso curls. */
  crunch_machine: { view:'side', arch:'machine', path:'trace', key:'end',
    scene:[['column', { x:24, top:44 }], ['pad', { a:[36, 92], b:[60, 92], w:5 }], ['post', { a:[48, 95], b:[48, G] }], ['rail', { a:[24, 84], b:[50, 86], w:2.6 }]],
    start:seat({ trunk:176, neck:178, nua:40, nfa:130, fua:36, ffa:126 }),
    end:  seat({ trunk:132, neck:126, nua:-4, nfa:86, fua:-8, ffa:82 }),
    gear:[['lever', { pivot:[50, 86], to:{ seg:['hip', 'sh'], t:0.86, n:-3.2 } }], ['pad', { a:'sh', b:'hip', off:8.6, extA:-1, extB:-9, w:5.4 }]],
    gearFront:true, track:'head' },

  cable_crunch: { view:'side', arch:'cable', key:'end',
    scene:[['column', { x:104, top:6 }]],
    start:ropeCrunch(156, 150),
    end:  ropeCrunch(66, 40),
    gear:[['cable', { from:[100, 12], to:'nW', grip:'rope' }]], track:'head' },

  bicycle_crunch: { view:'side', arch:'dynamic', both:true,
    start:supine(ext({ trunk:-124, neck:-144, nth:-160, nsh:100, nft:170, fth:100, fsh:100, fft:180 }, behindHead(-124))),
    end:  supine(ext({ trunk:-124, neck:-144, fth:-160, fsh:100, fft:170, nth:100, nsh:100, nft:180 }, behindHead(-124))),
    track:'nK' },

  reverse_crunch: { view:'side', arch:'dynamic', key:'end',
    start:{ pin:['sh', [36, G - 6.2]], trunk:-90, neck:-94, nua:82.5, nfa:82.5, fua:82.3, ffa:82.3, nth:180, nsh:90, fth:176, fsh:86, nft:180, fft:176 },
    end:  { pin:['sh', [36, G - 6.2]], trunk:-64, neck:-86, nua:82.5, nfa:82.5, fua:82.3, ffa:82.3, nth:-150, nsh:110, fth:-154, fsh:106, nft:200, fft:196 },
    track:'nK' },

  decline_situp: { view:'side', arch:'dynamic', key:'end',
    scene:[['pad', { a:[18, 92], b:[76, 71], w:5 }], ['post', { a:[24, 94], b:[22, G] }], ['post', { a:[70, 74], b:[74, G] }],
      ['bar', { at:'nA', dx:2.4, dy:-3.8, r:2.8 }]],
    start:decline(ext({ trunk:DECLINE.trunk, neck:DECLINE.trunk - 4 }, folded(DECLINE.trunk))),
    end:  decline(ext({ trunk:150, neck:146 }, folded(150))),
    track:'head' },

  weighted_situp: { view:'side', arch:'dynamic', key:'end',
    start:kneesUp(supine(ext({ trunk:-90 }, folded(-90)))),
    end:  kneesUp(supine(ext({ trunk:-162, neck:-170, pin:['hip', [62, G - 4.4]] }, folded(-162)))),
    gear:[['disc', { at:'chest', r:5.6 }]], gearFront:true, track:'head' },

  v_up: { view:'side', arch:'dynamic', key:'end',
    start:supine({ trunk:-90, neck:-90, nua:-82.5, nfa:-82.5, fua:-82.3, ffa:-82.3, nth:90, nsh:90, fth:92, fsh:92, nft:170, fft:170 }),
    end:  supine({ trunk:-138, neck:-128, nua:146, nfa:146, fua:142, ffa:142, nth:138, nsh:138, fth:136, fsh:136, nft:210, fft:208 }),
    track:'nW' },

  dead_bug: { view:'side', arch:'dynamic', both:true, key:'end',
    start:supine({ nua:180, nfa:180, fua:176, ffa:176, nth:180, nsh:90, fth:176, fsh:86, nft:180, fft:176 }),
    end:  supine({ nua:-100, nfa:-100, fua:176, ffa:176, nth:180, nsh:90, fth:98, fsh:98, nft:180, fft:188 }),
    track:'nW' },

  bird_dog: { view:'side', arch:'dynamic', key:'end',
    start:kneel([40, G - 4.4], { nth:0, fth:0, trunk:100, neck:104, nua:0, nfa:0, fua:-2, ffa:-2 }),
    end:  kneel([40, G - 4.4], { nth:0, trunk:100, neck:102, nua:104, nfa:104, fua:-2, ffa:-2, fth:-84, fsh:-84, fft:-84 }),
    track:'nW' },

  flutter_kicks: { view:'side', arch:'dynamic', both:true,
    start:supine({ trunk:-98, neck:-112, nua:74.8, nfa:74.8, fua:74.7, ffa:74.7, nth:112, nsh:112, fth:98, fsh:98, nft:190, fft:180 }),
    end:  supine({ trunk:-98, neck:-112, nua:74.8, nfa:74.8, fua:74.7, ffa:74.7, nth:98, nsh:98, fth:112, fsh:112, nft:180, fft:190 }),
    track:'nA' },

  /* ---- leg raises ---- */
  leg_raise: { view:'side', arch:'dynamic', key:'end',
    start:supine({ nua:82.5, nfa:82.5, fua:82.3, ffa:82.3, nth:94, nsh:94, fth:92, fsh:92, nft:180, fft:180 }),
    end:  supine({ nua:82.5, nfa:82.5, fua:82.3, ffa:82.3, nth:176, nsh:176, fth:172, fsh:172, nft:260, fft:256 }),
    track:'nA' },

  hanging_leg_raise: { view:'side', arch:'dynamic', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hanging({ nth:4, nsh:4, fth:0, fsh:0, nft:40, fft:40 }),
    end:  hanging({ nth:96, nsh:96, fth:92, fsh:92, nft:180, fft:176 }),
    track:'nA' },

  hanging_knee_raise: { view:'side', arch:'dynamic', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hanging({ nth:4, nsh:4, fth:0, fsh:0, nft:40, fft:40 }),
    end:  hanging({ nth:104, nsh:6, fth:100, fsh:2, nft:80, fft:76 }),
    track:'nK' },

  leg_raise_machine: { view:'side', arch:'machine', path:'trace', key:'end',
    scene:[['pad', { a:[50, 30], b:[50, 70], w:6 }], ['post', { a:[50, 70], b:[50, G] }], ['pad', { a:[52, 49.6], b:[76, 49.6], w:4 }], ['post', { a:[74, 51], b:[74, G] }]],
    start:chair({ nth:0, nsh:0, fth:-2, fsh:-2 }),
    end:  chair({ nth:100, nsh:4, fth:96, fsh:0 }),
    track:'nK' },

  ab_wheel: { view:'side', arch:'dynamic', path:'line', key:'end',
    start:wheelPose(22, 110, 54),
    end:  wheelPose(-64, 100, 100),
    gear:[['wheel', { at:'nW' }]], track:'nW' },

  /* ---- rotation and anti-rotation ---- */
  russian_twist: { view:'front', arch:'dynamic', both:true,
    start:handsAt(vSit({ lean:-12 }), [38, 84]),
    end:  handsAt(vSit({ lean:12 }), [82, 84]),
    track:'mid' },

  weighted_russian_twist: { view:'front', arch:'dynamic', both:true,
    start:handsAt(vSit({ lean:-12 }), [38, 84]),
    end:  handsAt(vSit({ lean:12 }), [82, 84]),
    gear:[['medball', { at:'mid', r:5.2 }]], gearFront:true, track:'mid' },

  woodchop_cable: { view:'front', arch:'cable', path:'line', arrow:{ trim:[0.05, 0.78] }, key:'end',
    scene:[['column', { x:106, top:8 }]],
    start:handsAt(F({ pin:['lA', [44, 104.3]], lth:14, lsh:6, rth:14, rsh:6, lean:6 }), [88, 30]),
    end:  handsAt(F({ pin:['lA', [44, 104.3]], lth:18, lsh:8, rth:18, rsh:8, lean:-8 }), [34, 88]),
    gear:[['cable', { from:[102, 14], to:'mid' }]], track:'mid' },

  band_woodchop: { view:'front', arch:'cable', path:'line', arrow:{ trim:[0.05, 0.78] }, key:'end',
    scene:[['wall', { x:104, top:6 }], ['anchor', { at:[102, 18] }]],
    start:handsAt(F({ pin:['lA', [44, 104.3]], lth:14, lsh:6, rth:14, rsh:6, lean:6 }), [88, 30]),
    end:  handsAt(F({ pin:['lA', [44, 104.3]], lth:18, lsh:8, rth:18, rsh:8, lean:-8 }), [34, 88]),
    gear:[['band', { from:[102, 18], to:'mid', bowY:2 }]], track:'mid' },

  /* Pallof press. The anchor is BESIDE the athlete: facing us, the cable
     comes in level from the column at the side to the handle at the chest.
     The press runs straight out toward the viewer, which no arrow can draw
     truthfully — so the bent-arm start is the ghost and there is no arrow. */
  pallof_press: { view:'front', arch:'cable', depth:true, key:'end', ghost:'arms',
    scene:[['column', { x:106, top:34 }]],
    start:handsAt(F({ pin:['lA', [46, 104.3]], lth:12, lsh:6, rth:12, rsh:6 }), [60.3, 50]),
    end:  handsAt(F({ pin:['lA', [46, 104.3]], lth:12, lsh:6, rth:12, rsh:6, uaScale:0.5, faScale:0.5 }), [60.3, 55]),
    gear:[['cable', { from:[102, 52], to:'mid' }]], track:'mid' },

  side_bend: { view:'front', arch:'dynamic', both:true,
    start:F({ lean:0, ra:2, rfa:0, la:150, lfa:-130 }),
    end:  F({ lean:18, ra:2, rfa:0, la:150, lfa:-130 }),
    gear:[['dbFace', { at:'rW', r:4.2 }]], track:'head' },

  /* ---- full-body and conditioning ---- */
  mountain_climber: { view:'side', arch:'dynamic', both:true,
    start:climber(true),
    end:  climber(false),
    track:'nK' },

  turkish_getup: { view:'side', arch:'dynamic', key:'end',
    start:planted(supine({ trunk:-90, neck:-94, nua:180, nfa:180, fua:82.3, ffa:82.3, fth:90, fsh:90, fft:170 }), [88, 104.3], null),
    end:  planted(sideHands(supine({ trunk:-150, neck:-156, nua:180, nfa:180, fth:90, fsh:90, fft:170, pin:['hip', [62, G - 4.6]] }), null, [38.5, G - 2.7], 1), [88, 104.3], null),
    gear:[['kettlebell', { at:'nW', inverted:true }]], track:'head' },

  med_ball_slam: { view:'side', arch:'dynamic', key:'end',
    start:athletic({ pin:['hip', [58, 67]], trunk:178, neck:180, nua:176, nfa:178, fua:172, ffa:176 }),
    end:  sideHands(athletic({ pin:['hip', [50, 80]], trunk:122, neck:134 }), [82, G - 12], [81, G - 11]),
    gear:[['medball', { at:'nW', dy:5, r:6 }]], track:'nW' },

  /* Rotational throw: loaded at the far hip, the ball swings across the body
     and is released at chest height to the other side. */
  med_ball_rotational_throw: { view:'front', arch:'dynamic', arrow:{ trim:[0.35, 1] }, key:'start',
    start:handsAt(F({ pin:['lA', [40, 104.3]], lth:12, lsh:6, rth:12, rsh:6, lean:5 }), [76, 72]),
    end:  handsAt(F({ pin:['lA', [40, 104.3]], lth:12, lsh:6, rth:12, rsh:6, lean:-6 }), [30, 54]),
    gear:[['medball', { at:'mid', r:5.6 }]], track:'mid' },

  battle_rope_slam: { view:'side', arch:'dynamic', key:'end',
    start:athletic({ trunk:164, neck:170, nua:150, nfa:160, fua:146, ffa:156 }),
    end:  athletic({ pin:['hip', [54, 76]], trunk:136, neck:148, nua:40, nfa:30, fua:36, ffa:26 }),
    gear:[['rope', { from:'nW', to:[110, G - 2], amp:3, steps:6 }]], track:'nW' },

  battle_rope_wave: { view:'side', arch:'dynamic', both:true,
    start:athletic({ pin:['hip', [54, 76]], trunk:150, neck:162, nua:70, nfa:110, fua:36, ffa:56 }),
    end:  athletic({ pin:['hip', [54, 76]], trunk:150, neck:162, nua:36, nfa:56, fua:70, ffa:110 }),
    gear:[['rope', { from:'nW', to:[110, G - 2], amp:4.5, steps:8 }]], track:'nW' },

  sled_push: { view:'side', arch:'locomotion',
    scene:[['sled', { x:SLED_X }]],
    end:sideHands(planted({ pin:['hip', [44, 72]], trunk:128, neck:112 }, [58, 96], [26, 104.3]), [SLED_X + 1, G - 27], [SLED_X + 2, G - 26], 1),
    travel:{ dir:1 } },

  sled_pull: { view:'side', arch:'locomotion',
    scene:[['sled', { x:SLED_X }]],
    end:sideHands(planted({ pin:['hip', [48, 70]], trunk:-164, neck:-174 }, [30, 104.3], [56, 104.5]), [70, 74], [69, 75], 1),
    gear:[['strap', { from:[SLED_X + 3, G - 7], to:'nW' }]],
    travel:{ dir:-1 } }
  });
  })(EXV);

  return EXV_DEFS;
}

var EXERCISE_VISUAL_BY_NAME = {
  /* Aliases that share a canonical id for history but are drawn as what they are. */
  'pendlay row':'pendlay_row',
  't-bar row':'tbar_row', 't bar row':'tbar_row',
  'glute bridge':'glute_bridge',
  'hanging leg raise':'hanging_leg_raise',
  'walking lunge':'lunge_walking',
  'kettlebell goblet squat':'squat_goblet_kb',

  /* Uncatalogued names LOOP prescribes. */
  'ab wheel rollout':'ab_wheel',
  'assisted pull-up':'assisted_pullup',
  'back extension':'back_extension',
  'band chest press':'band_chest_press',
  'band curl':'band_curl',
  'band face pull':'band_face_pull',
  'band lateral walk':'band_lateral_walk', 'lateral band walk':'band_lateral_walk',
  'band pull-apart':'band_pull_apart',
  'band row':'band_row',
  'band shoulder press':'band_shoulder_press',
  'band squat':'band_squat',
  'band triceps extension':'band_triceps_ext',
  'band triceps pushdown':'band_pushdown',
  'battle rope slams':'battle_rope_slam',
  'battle rope waves':'battle_rope_wave',
  'bench dips':'bench_dip', 'chair triceps dips':'bench_dip',
  'bicycle crunch':'bicycle_crunch',
  'bird dog':'bird_dog',
  'bodyweight lunge':'bodyweight_lunge',
  'bodyweight squat':'bodyweight_squat',
  'box jump':'box_jump',
  'box squat':'box_squat',
  'box step-up':'step_up',
  'broad jump':'broad_jump',
  'cable chop':'woodchop_cable', 'cable woodchop':'woodchop_cable',
  'cable glute kickback':'glute_kickback_cable',
  'cable hammer curl':'cable_hammer_curl',
  'cable pull-through':'cable_pull_through',
  'cable triceps pushdown':'triceps_pushdown',
  'close-grip push-up':'pushup_close', 'diamond push-up':'pushup_close',
  'concentration curl':'concentration_curl',
  'db arnold press':'shoulder_press_arnold',
  'db bulgarian split squat':'split_squat_bulgarian',
  'db deadlift':'db_deadlift',
  'db floor fly':'db_floor_fly',
  'db floor press':'db_floor_press',
  'db overhead triceps extension':'overhead_ext_triceps',
  'db pullover':'db_pullover',
  'db push press':'db_push_press',
  'db renegade row':'renegade_row', 'renegade row':'renegade_row',
  'db romanian deadlift':'db_rdl',
  'db step-up':'db_step_up',
  'dead bug':'dead_bug',
  'decline sit-up':'decline_situp',
  'deficit deadlift':'deficit_deadlift',
  'explosive push-up':'pushup_plyo', 'plyo push-up':'pushup_plyo',
  "farmer's carry":'farmers_carry',
  'flat db press':'bench_press_db',
  'flutter kicks':'flutter_kicks',
  'hanging knee raise':'hanging_knee_raise',
  'hollow body hold':'hollow_hold',
  'incline push-up':'pushup_incline',
  'kb row':'kb_row', 'single-arm kb row':'kb_row',
  'kettlebell push press':'kb_push_press',
  'kettlebell swing':'kb_swing',
  'lateral bound':'lateral_bound',
  'leg raise machine':'leg_raise_machine',
  'med ball chest pass':'med_ball_chest_pass', 'med ball chest throw':'med_ball_chest_pass',
  'med ball rotational throw':'med_ball_rotational_throw',
  'med ball slam':'med_ball_slam',
  'mountain climbers':'mountain_climber',
  'one-arm lat pulldown':'lat_pulldown_single', 'single-arm lat pulldown':'lat_pulldown_single',
  'overhead cable extension':'overhead_ext_cable',
  'overhead rope extension':'overhead_rope_ext',
  'pallof press':'pallof_press',
  'pike push-up':'pike_pushup',
  'plyo box push-up':'pushup_plyo_box',
  'power clean':'power_clean',
  'pull-up weighted':'pullup_weighted', 'weighted pull-up':'pullup_weighted',
  'push press':'push_press',
  'rack pull':'rack_pull',
  'reverse crunch':'reverse_crunch',
  'reverse snow angel':'reverse_snow_angel',
  'rope triceps pushdown':'rope_pushdown',
  'russian twist':'russian_twist',
  'seal row':'seal_row',
  'seated db shoulder press':'shoulder_press_db',
  'side plank':'side_plank',
  'side plank with reach':'side_plank_reach',
  'single-arm db row':'row_dumbbell',
  'single-leg deadlift':'single_leg_rdl', 'single-leg rdl':'single_leg_rdl',
  'single-leg glute bridge':'single_leg_glute_bridge',
  'sled pull':'sled_pull',
  'sled push':'sled_push',
  'slow tempo push-up':'pushup',
  'speed bench press':'bench_press_barbell',
  'squat to press':'squat_to_press',
  'standing band woodchop':'band_woodchop',
  'standing side bend':'side_bend',
  'sumo deadlift':'sumo_deadlift',
  'superman hold':'superman_hold',
  'towel door row':'towel_door_row',
  'trap bar deadlift':'trap_bar_deadlift',
  'triceps dips':'dip',
  'triceps kickback':'triceps_kickback',
  'trx row':'trx_row',
  'turkish get-up':'turkish_getup',
  'v-up':'v_up',
  'wall sit':'wall_sit',
  'weighted dips':'dip_weighted',
  'weighted plank':'weighted_plank',
  'weighted russian twist':'weighted_russian_twist',
  'weighted sit-up':'weighted_situp',
  'wide-grip lat pulldown':'lat_pulldown', 'wide-grip pulldown':'lat_pulldown'
};

/* One to three cues per drawing: what to do, in the order it matters. */
var EXERCISE_HOW_TO = {
  /* arms */
  curl_barbell:['Elbows pinned at your sides', 'Curl without swinging the torso', 'Lower all the way under control'],
  curl_dumbbell:['Palms forward, elbows at your sides', 'Curl up without swinging', 'Lower slowly to full extension'],
  curl_hammer:['Palms facing each other throughout', 'Elbows stay at your sides', 'Lower under control'],
  curl_incline_db:['Back flat on the incline, arms hanging', 'Curl without moving the upper arm', 'Lower to a full stretch'],
  curl_preacher:['Upper arms flat on the pad', 'Curl up, stop short of resting', 'Lower slowly to almost straight'],
  curl_cable:['Stand tall facing the low pulley', 'Elbows fixed at your sides', 'Squeeze at the top, lower slowly'],
  cable_hammer_curl:['Rope held with thumbs up', 'Elbows fixed at your sides', 'Lower slowly under tension'],
  concentration_curl:['Elbow braced against the inner thigh', 'Curl toward the shoulder', 'Lower to full extension'],
  curl_machine:['Arms flat on the pad, elbows on the pivot', 'Curl through the full range', 'Control the return'],
  band_curl:['Stand on the band, elbows at your sides', 'Curl against the stretch', 'Lower slowly'],
  triceps_pushdown:['Elbows pinned at your sides', 'Press down to straight arms', 'Let the bar rise only to 90°'],
  rope_pushdown:['Elbows pinned at your sides', 'Press down and spread the rope', 'Control the return'],
  band_pushdown:['Band anchored high, elbows at your sides', 'Press down to straight arms', 'Return slowly'],
  overhead_ext_cable:['Face away from the pulley, elbows high', 'Extend the arms forward and up', 'Keep the elbows in place'],
  overhead_rope_ext:['Face away, rope behind your head', 'Extend without flaring the elbows', 'Stretch fully on the return'],
  overhead_ext_triceps:['Weight overhead, elbows pointing up', 'Lower behind the head', 'Extend without moving the elbows'],
  band_triceps_ext:['Band behind you, hands overhead', 'Extend the elbows fully', 'Upper arms stay still'],
  skullcrusher:['Lie flat, arms angled back slightly', 'Bend only at the elbows', 'Extend without flaring'],
  triceps_kickback:['Brace on the bench, upper arm parallel', 'Extend back to a straight arm', 'Upper arm stays still'],
  triceps_extension_machine:['Upper arms flat on the pad', 'Extend to straight arms', 'Bend back slowly under control'],
  dip:['Start tall with locked arms', 'Lower until the upper arm is level', 'Press back up, shoulders down'],
  dip_weighted:['Belt load hangs still between the legs', 'Lower until the upper arm is level', 'Press up without swinging'],
  bench_dip:['Hands on the bench edge, hips close', 'Bend the elbows straight back', 'Press up to straight arms'],
  dip_machine:['Sit tall, handles beside the ribs', 'Press down to straight arms', 'Let them rise slowly, shoulders down'],
  bench_press_close_grip:['Hands shoulder-width, elbows tucked', 'Lower to the lower chest', 'Press up over the shoulders'],

  /* chest and shoulders */
  bench_press_barbell:['Feet planted, shoulder blades pinned', 'Lower to the mid chest', 'Press up and slightly back'],
  bench_press_smith:['Set the bench so the bar meets mid chest', 'Lower under control', 'Press to straight arms'],
  bench_press_incline_smith:['Set the bench so the bar meets the upper chest', 'Lower under control', 'Press straight up to straight arms'],
  bench_press_db:['Dumbbells over the chest, feet planted', 'Lower to chest level', 'Press up and together'],
  bench_press_incline_bb:['Bench at 30–45°, blades pinned', 'Lower to the upper chest', 'Press straight up'],
  incline_press_db:['Bench at 30–45°, weights at chest', 'Lower with elbows under wrists', 'Press up over the chest'],
  db_floor_press:['Lie on the floor, knees bent', 'Lower until the elbows touch', 'Press straight up'],
  chest_press_machine:['Handles at mid-chest height', 'Press forward to straight arms', 'Return slowly, chest up'],
  incline_press_machine:['Back on the pad, handles at upper chest', 'Press up and forward', 'Control the return'],
  shoulder_press_machine:['Handles at shoulder height', 'Press overhead to straight arms', 'Lower under control'],
  shoulder_press_smith:['Bench upright, bar just in front of the face', 'Press straight up to straight arms', 'Lower to chin height, ribs down'],
  chest_fly_cable:['Slight bend in the elbows, fixed', 'Hug the handles together', 'Open to a stretch slowly'],
  chest_fly_incline_cable:['Pulleys low, slight elbow bend', 'Sweep up and together', 'Lower back to a stretch'],
  pec_deck:['Back on the pad, arms at chest height', 'Squeeze the pads together', 'Open slowly to a stretch'],
  db_floor_fly:['Lie on the floor, slight elbow bend', 'Open the arms toward the floor', 'Squeeze back up over the chest'],
  pushup:['Hands under shoulders, body straight', 'Lower the chest toward the floor', 'Press up without sagging'],
  pushup_close:['Hands close under the chest', 'Elbows brush the ribs', 'Keep the body in one line'],
  pushup_incline:['Hands on a bench, body straight', 'Lower the chest to the edge', 'Press back to straight arms'],
  pushup_plyo:['Lower under control', 'Press hard enough to leave the floor', 'Land softly and go again'],
  pushup_plyo_box:['Start with hands on the floor', 'Explode up onto the box', 'Land softly, step back down'],
  pike_pushup:['Hips high, head between the arms', 'Lower the head toward the floor', 'Press back up through the shoulders'],
  band_chest_press:['Band behind the shoulders', 'Press forward to straight arms', 'Return slowly'],
  med_ball_chest_pass:['Ball at the chest, knees soft', 'Push it out explosively', 'Follow through with the arms'],
  overhead_press_bb:['Bar on the front of the shoulders', 'Press straight overhead', 'Squeeze glutes, ribs down'],
  push_press:['Dip the knees slightly', 'Drive up and press together', 'Lock out overhead'],
  db_push_press:['Dumbbells at the shoulders', 'Dip and drive with the legs', 'Finish the press overhead'],
  kb_push_press:['Bell racked on the forearm', 'Dip and drive with the legs', 'Lock the arm out overhead'],
  shoulder_press_db:['Dumbbells at shoulder height', 'Press up without arching', 'Lower back to the shoulders'],
  shoulder_press_arnold:['Start palms facing you', 'Rotate out as you press', 'Reverse on the way down'],
  landmine_press:['Hold the bar end at the shoulder', 'Press up and forward', 'Keep the torso still'],
  band_shoulder_press:['Stand on the band, hands at shoulders', 'Press straight overhead', 'Lower slowly'],
  lateral_raise:['Slight bend in the elbows', 'Raise out to shoulder height', 'Lower slowly, no swinging'],
  lateral_raise_cable:['Pulley low on the opposite side', 'Raise out to shoulder height', 'Lower under control'],
  lateral_raise_machine:['Sit tall, pads on the outer arms', 'Raise the elbows to shoulder height', 'Lower slowly, shoulders down'],
  front_raise:['Arm straight, weight in front', 'Raise to shoulder height', 'Lower slowly'],
  upright_row:['Grip about shoulder-width', 'Pull up with the elbows leading', 'Stop at chest height'],
  rear_delt_fly:['Hinge forward, back flat', 'Raise the arms out wide', 'Squeeze the shoulder blades'],
  reverse_pec_deck:['Chest on the pad, arms forward', 'Sweep the arms back and wide', 'Return slowly'],
  face_pull:['Rope at face height', 'Pull toward the forehead, elbows high', 'Squeeze the upper back'],
  band_face_pull:['Band anchored at face height', 'Pull apart toward the forehead', 'Elbows stay high'],
  band_pull_apart:['Arms straight at shoulder height', 'Pull the band apart to the chest', 'Return with control'],
  reverse_snow_angel:['Lie face down, arms by the sides', 'Sweep the arms overhead', 'Keep the chest lifted slightly'],
  shrug:['Arms straight, weight at the sides', 'Lift the shoulders to the ears', 'Pause, then lower fully'],

  /* back and posterior chain */
  row_barbell:['Hinge to a flat back', 'Pull the bar to the lower ribs', 'Lower without rounding'],
  pendlay_row:['Torso level, bar on the floor', 'Pull explosively to the chest', 'Return the bar to the floor'],
  seal_row:['Lie face down on a high bench', 'Pull up to the bench', 'Lower to straight arms'],
  row_meadows:['Staggered stance, grip the bar end', 'Pull the elbow up and back', 'Lower to a full stretch'],
  row_dumbbell:['Knee and hand on the bench', 'Pull the weight to the hip', 'Lower to a full stretch'],
  kb_row:['Hand and knee on the bench', 'Row the bell to the hip', 'Lower slowly'],
  renegade_row:['Plank on the dumbbells, feet wide', 'Row one side without twisting', 'Place it down, switch sides'],
  row_cable_seated:['Sit tall, knees soft', 'Pull the handle to the stomach', 'Let the arms extend fully'],
  row_machine:['Chest on the pad', 'Pull the handles back', 'Squeeze the shoulder blades'],
  tbar_row:['Hinge over the bar, back flat', 'Pull the handle to the chest', 'Lower under control'],
  trx_row:['Lean back with a straight body', 'Pull the chest to the handles', 'Lower slowly'],
  band_row:['Band anchored at chest height', 'Pull the elbows back', 'Return slowly'],
  towel_door_row:['Towel secured in a closed door', 'Lean back, body straight', 'Pull the chest toward the door'],
  lat_pulldown:['Thighs under the pad', 'Pull the bar to the upper chest', 'Let it rise to straight arms'],
  lat_pulldown_single:['One handle overhead', 'Pull the elbow down to the side', 'Return to a full stretch'],
  straight_arm_pulldown:['Arms straight, slight hinge', 'Sweep the bar down to the thighs', 'Return with control'],
  db_pullover:['Lie across the bench, arms straight up', 'Lower behind the head', 'Pull back over the chest'],
  pullup:['Hang with an overhand grip', 'Pull the chest toward the bar', 'Lower to straight arms'],
  chinup:['Hang with palms facing you', 'Pull the chin over the bar', 'Lower all the way'],
  pullup_weighted:['Load hangs from a belt', 'Pull the chest toward the bar', 'Lower fully each rep'],
  assisted_pullup:['Knees on the assist pad', 'Pull the chin over the bar', 'Lower to straight arms'],
  deadlift_conventional:['Bar over mid-foot, back flat', 'Push the floor away', 'Stand tall, hips through'],
  sumo_deadlift:['Wide stance, grip inside the knees', 'Chest up, push the knees out', 'Stand tall and lock out'],
  deficit_deadlift:['Stand on a low platform', 'Set a flat back', 'Push the floor away to stand'],
  trap_bar_deadlift:['Stand inside the bar', 'Grip the handles, chest up', 'Drive up through the legs'],
  rack_pull:['Bar on the pins at knee height', 'Brace and pull to lockout', 'Lower back to the pins'],
  db_deadlift:['Dumbbells at the feet', 'Flat back, hips back', 'Stand up tall'],
  deadlift_romanian:['Soft knees, hinge at the hips', 'Slide the bar down the thighs', 'Drive the hips forward to stand'],
  db_rdl:['Soft knees, weights at the thighs', 'Push the hips back', 'Stand up by driving the hips'],
  single_leg_rdl:['Stand on one leg, knee soft', 'Hinge, free leg reaches back', 'Return to tall'],
  good_morning:['Bar on the upper back', 'Push the hips back, back flat', 'Stand tall again'],
  back_extension:['Hips on the pad, feet locked', 'Lower with a flat back', 'Rise to a straight line'],
  superman_hold:['Lie face down', 'Lift chest, arms and legs', 'Hold, breathe steadily'],
  kb_swing:['Hinge and hike the bell back', 'Snap the hips forward', 'Let the bell float to chest height'],
  cable_pull_through:['Face away from a low pulley', 'Hinge with the rope between the legs', 'Drive the hips through'],
  hip_thrust:['Upper back on the bench edge', 'Drive the hips up to a line', 'Squeeze the glutes, then lower'],
  hip_thrust_machine:['Back on the pad, pad over the hips', 'Drive the hips up', 'Lower with control'],
  glute_bridge:['Lie on your back, feet flat', 'Lift the hips to a line', 'Squeeze, then lower'],
  single_leg_glute_bridge:['One foot planted, other leg long', 'Drive up through the heel', 'Keep the hips level'],
  nordic_curl:['Kneel with the heels anchored', 'Lower forward as one line', 'Catch yourself, pull back up'],
  leg_curl:['Lie face down, pad above the heels', 'Curl the heels toward the glutes', 'Lower slowly'],
  leg_curl_seated:['Knees in line with the pivot, pad snug', 'Curl the heels down under the seat', 'Return slowly to straight legs'],
  glute_kickback_cable:['Strap on the ankle, hinge slightly', 'Kick the leg straight back', 'Return without arching'],
  farmers_carry:['Heavy weights at your sides', 'Stand tall and walk', 'Short, steady steps'],
  power_clean:['Start like a deadlift', 'Jump and shrug the bar up', 'Catch on the shoulders, elbows high'],

  /* legs */
  squat_back:['Bar on the upper back, brace', 'Sit down between the heels', 'Drive up through the whole foot'],
  squat_front:['Bar in the front rack, elbows high', 'Squat down with a tall chest', 'Drive up, elbows stay up'],
  box_squat:['Sit back onto the box', 'Pause without relaxing', 'Drive up from the heels'],
  squat_smith:['Feet slightly in front of the bar', 'Squat straight down', 'Press up through the heels'],
  squat_goblet:['Hold the weight at the chest', 'Squat between the knees', 'Stand up tall'],
  squat_goblet_kb:['Hold the bell by the horns', 'Squat with elbows inside the knees', 'Stand up tall'],
  squat_hack:['Back flat on the pad', 'Lower until the thighs are level', 'Press up through the heels'],
  leg_press:['Feet flat, shoulder-width', 'Lower until the knees are bent deep', 'Press without locking the knees'],
  bodyweight_squat:['Feet shoulder-width', 'Sit down, arms forward', 'Stand up tall'],
  band_squat:['Stand on the band, hands at shoulders', 'Squat down with control', 'Drive up against the band'],
  wall_sit:['Back flat on the wall', 'Thighs level, knees over ankles', 'Hold and breathe'],
  squat_to_press:['Squat with weights at the shoulders', 'Stand and press in one motion', 'Lower to the shoulders'],
  lunge:['Long step, torso tall', 'Lower the back knee toward the floor', 'Drive up through the front heel'],
  lunge_walking:['Step forward into a lunge', 'Drive through the front heel', 'Bring the back leg through'],
  bodyweight_lunge:['Hands on hips, long stance', 'Lower the back knee', 'Push back up'],
  split_squat_bulgarian:['Rear foot on the bench', 'Lower straight down', 'Drive up through the front heel'],
  step_up:['Whole foot on the box', 'Drive up through that leg', 'Step down with control'],
  db_step_up:['Weights at your sides', 'Step up through the front leg', 'Lower slowly'],
  lateral_bound:['Push off one leg sideways', 'Land softly on the other', 'Stick the landing, then go'],
  box_jump:['Load the hips, swing the arms', 'Jump up onto the box', 'Land soft, step down'],
  broad_jump:['Swing the arms back and load', 'Jump forward explosively', 'Land softly in a squat'],
  leg_extension:['Pad on the lower shins', 'Extend to straight legs', 'Lower slowly'],
  calf_raise:['Balls of the feet on the step', 'Rise as high as possible', 'Lower the heels below the step'],
  calf_raise_seated:['Pad on the knees, toes on the block', 'Push the heels up', 'Lower to a full stretch'],
  calf_raise_leg_press:['Knees soft, balls of the feet on the edge', 'Press through the balls of the feet', 'Lower the heels slowly to a stretch'],
  hip_abduction:['Sit tall, pads outside the knees', 'Push the knees apart', 'Return slowly'],
  band_lateral_walk:['Band above the knees, hips back', 'Step sideways', 'Keep tension on the band'],

  /* core and conditioning */
  plank:['Elbows under the shoulders', 'Body in one straight line', 'Brace and breathe'],
  weighted_plank:['Plate across the upper back', 'Body in one straight line', 'Hold without sagging'],
  side_plank:['Elbow under the shoulder', 'Lift the hips into a line', 'Hold, hips stacked'],
  side_plank_reach:['Hold a side plank', 'Reach up, then thread under', 'Keep the hips lifted'],
  hollow_hold:['Lower back pressed to the floor', 'Lift the shoulders and legs', 'Hold without arching'],
  crunch:['Knees bent, feet flat', 'Curl the shoulders up', 'Lower slowly'],
  crunch_machine:['Pad on the chest, hands on the handles', 'Curl the torso forward', 'Return with control'],
  cable_crunch:['Kneel, rope beside the head', 'Curl down toward the knees', 'Rise slowly'],
  bicycle_crunch:['Shoulders lifted, hands by the head', 'Bring one knee in, other leg long', 'Alternate with control'],
  reverse_crunch:['Knees bent over the hips', 'Curl the hips off the floor', 'Lower slowly'],
  decline_situp:['Feet locked, lie back', 'Sit up toward the knees', 'Lower with control'],
  weighted_situp:['Hold the plate on the chest', 'Sit all the way up', 'Lower slowly'],
  v_up:['Lie flat, arms overhead', 'Lift arms and legs to meet', 'Lower with control'],
  dead_bug:['Arms up, knees over hips', 'Extend opposite arm and leg', 'Keep the back flat'],
  bird_dog:['Hands under shoulders, knees under hips', 'Extend opposite arm and leg', 'Hold level, then switch'],
  flutter_kicks:['Lower back pressed down', 'Kick the legs in small strokes', 'Keep the legs straight'],
  leg_raise:['Lie flat, legs straight', 'Raise the legs to vertical', 'Lower without touching down'],
  hanging_leg_raise:['Hang still from the bar', 'Raise straight legs to level', 'Lower without swinging'],
  hanging_knee_raise:['Hang still from the bar', 'Bring the knees up to the chest', 'Lower slowly'],
  leg_raise_machine:['Forearms on the pads, back flat', 'Bring the knees up', 'Lower with control'],
  ab_wheel:['Kneel, hands on the wheel', 'Roll out with a braced trunk', 'Pull back to the knees'],
  russian_twist:['Lean back, feet off the floor', 'Rotate the hands side to side', 'Turn from the ribs'],
  weighted_russian_twist:['Hold the weight at the chest', 'Rotate side to side', 'Keep the chest tall'],
  woodchop_cable:['Pulley high on one side', 'Pull across and down to the hip', 'Rotate through the torso'],
  band_woodchop:['Band anchored high', 'Chop across and down', 'Pivot the back foot'],
  pallof_press:['Stand side-on to the anchor', 'Press straight out from the chest', 'Resist the pull to rotate'],
  side_bend:['Weight in one hand', 'Bend sideways toward it', 'Rise using the other side'],
  mountain_climber:['Plank with straight arms', 'Drive one knee to the chest', 'Switch legs quickly'],
  turkish_getup:['Lie with the weight straight up', 'Rise to an elbow, then a hand', 'Keep eyes on the weight'],
  med_ball_slam:['Ball overhead, rise tall', 'Slam it into the floor', 'Squat to pick it up'],
  med_ball_rotational_throw:['Stand side-on, ball at the hip', 'Rotate and throw across', 'Follow through with the hips'],
  battle_rope_slam:['Athletic stance, rope ends in hand', 'Lift both arms and slam down', 'Keep a steady rhythm'],
  battle_rope_wave:['Hips back, chest up', 'Alternate the arms fast', 'Make waves reach the anchor'],
  sled_push:['Hands on the posts, body leaning', 'Drive with short steps', 'Keep the back flat'],
  sled_pull:['Face the sled, straps in hand', 'Walk backward, leaning away', 'Keep tension on the straps']
};

return {
  definitions: function(){ return built || (built = build()); },
  byName: EXERCISE_VISUAL_BY_NAME,
  howTo: EXERCISE_HOW_TO
};
})();
