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
var B = { torso:25, neck:3.2, head:6, ua:14, fa:12.5, th:19.5, sh:18.5, ft:7.4 };
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
function P(p){ return n1(p[0]) + ' ' + n1(p[1]); }
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
function mixPose(view, a, b, t){
  var base = view === 'front' ? FRONT_DEFAULT : SIDE_DEFAULT;
  var out = {}; var k, keys = {};
  for(k in base) keys[k] = 1; for(k in a) keys[k] = 1; for(k in b) keys[k] = 1;
  for(k in keys){
    var va = a[k] != null ? a[k] : base[k], vb = b[k] != null ? b[k] : base[k];
    if(va == null || vb == null){ out[k] = va != null ? va : vb; continue; }
    if(k === 'pin') out[k] = [va[0], [lerp(va[1][0], vb[1][0], t), lerp(va[1][1], vb[1][1], t)]];
    else if(Array.isArray(va)) out[k] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
    else if(typeof va === 'number' && /^(cx|hipY|sw|hw|shrug|torsoScale|thighScale|shinScale|uaScale|faScale|lfaS|rfaS|nuaS|nfaS|fuaS|ffaS)$/.test(k)) out[k] = lerp(va, vb, t);
    else if(typeof va === 'number') out[k] = lerpAng(va, vb, t);
    else out[k] = t < 0.5 ? va : vb;
  }
  return out;
}

/* ---------- body ---------- */
function seg(a, b, w, core, edge){
  var d = 'M' + P(a) + 'L' + P(b);
  return '<path d="' + d + '" stroke="' + edge + '" stroke-width="' + n1(w + W.edge) + '"/>' +
         '<path d="' + d + '" stroke="' + core + '" stroke-width="' + n1(w) + '"/>';
}
function headDot(c, core, edge){
  return '<circle cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + B.head + '" fill="' + core +
    '" stroke="' + edge + '" stroke-width="1.5"/>';
}
/* parts: 'all' | 'arms' | 'legs' | 'nearArm' */
function figure(J, tone, parts){
  parts = parts || 'all';
  var ghost = tone === 'ghost';
  var near = ghost ? [C.nearEdge, C.nearEdge] : [C.nearCore, C.nearEdge];
  var far  = ghost ? [C.nearEdge, C.nearEdge] : [C.farCore, C.farEdge];
  var tor  = ghost ? [C.nearEdge, C.nearEdge] : [C.torsoCore, C.torsoEdge];
  var all = parts === 'all', arms = all || parts === 'arms' || parts === 'nearArm', legs = all || parts === 'legs';
  var s = '';
  if(J.view === 'side'){
    if(arms && parts !== 'nearArm') s += seg(J.fE, J.fW, W.fa - 0.4, far[0], far[1]) + seg(J.sh, J.fE, W.ua - 0.4, far[0], far[1]);
    if(legs) s += seg(J.fA, J.fT, W.ft, far[0], far[1]) + seg(J.fK, J.fA, W.sh - 0.4, far[0], far[1]) + seg(J.hip, J.fK, W.th - 0.5, far[0], far[1]);
    if(all){
      s += seg(J.hip, J.sh, W.torso, tor[0], tor[1]);
      s += seg(J.sh, J.nk, W.neck, near[0], near[1]) + headDot(J.head, near[0], near[1]);
    }
    if(legs) s += seg(J.hip, J.nK, W.th, near[0], near[1]) + seg(J.nK, J.nA, W.sh, near[0], near[1]) + seg(J.nA, J.nT, W.ft, near[0], near[1]);
    if(arms) s += seg(J.sh, J.nE, W.ua, near[0], near[1]) + seg(J.nE, J.nW, W.fa, near[0], near[1]);
  } else {
    if(legs){
      s += seg(J.lH, J.lK, W.th, near[0], near[1]) + seg(J.lK, J.lA, W.sh, near[0], near[1]) + seg(J.lA, J.lT, W.ft, near[0], near[1]);
      s += seg(J.rH, J.rK, W.th, near[0], near[1]) + seg(J.rK, J.rA, W.sh, near[0], near[1]) + seg(J.rA, J.rT, W.ft, near[0], near[1]);
    }
    if(all){
      s += seg(J.hc, J.sc, W.torsoF, tor[0], tor[1]);
      s += seg(J.lS, J.rS, 7.2, tor[0], tor[1]) + seg(J.lH, J.rH, 8, tor[0], tor[1]);
      s += seg(J.sc, J.nk, W.neck, near[0], near[1]) + headDot(J.head, near[0], near[1]);
    }
    if(arms){
      s += seg(J.lS, J.lE, W.ua, near[0], near[1]) + seg(J.lE, J.lW, W.fa, near[0], near[1]);
      s += seg(J.rS, J.rE, W.ua, near[0], near[1]) + seg(J.rE, J.rW, W.fa, near[0], near[1]);
    }
  }
  return s;
}

/* ---------- equipment ---------- */
function jp(J, ref){ return typeof ref === 'string' ? J[ref] : ref; }
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
  },
  /* A flight: the athlete leaves the ground and lands somewhere else. */
  arc: function(J, o){
    var thumb = J.size === 'thumb', a = o.from, b = o.to;
    var c = [(a[0] + b[0]) / 2 + (o.cx || 0), Math.min(a[1], b[1]) - (o.h || 14)];
    return '<path d="M' + P(a) + 'Q' + P(c) + ' ' + P(b) + '" stroke="' + C.accent + '" stroke-width="' + (thumb ? 2.8 : 2) + '"/>' +
      arrowHead(b, angleOf(c, b), thumb ? 3.6 : 3);
  },
  /* The whole athlete travels: a straight arrow in the motion colour. */
  travel: function(J, o){
    var thumb = J.size === 'thumb', a = o.from, b = o.to;
    return line(a, b, C.accent, thumb ? 2.8 : 2) + arrowHead(b, angleOf(a, b), thumb ? 3.6 : 3);
  }
};
function drawProps(J, list){
  var s = '';
  (list || []).forEach(function(pr){ var fn = PROPS[pr[0]]; if(fn) s += fn(J, pr[1] || {}); });
  return s;
}

/* ---------- motion ---------- */
function tracePoints(def){
  var pts = [];
  for(var i = 0; i <= 12; i++){
    var J = solve(def.view, mixPose(def.view, def.start, def.end, i / 12));
    var p = jp(J, def.track);
    if(def.trackOffset) p = off(p, def.trackOffset[0], def.trackOffset[1]);
    pts.push(p);
  }
  return pts;
}
function arrowHead(b, ang, hw){
  var tip = mv(b, ang, hw), l = mv(b, ang + 150, hw * 1.2), r = mv(b, ang - 150, hw * 1.2);
  return '<path d="M' + P(l) + 'L' + P(tip) + 'L' + P(r) + 'Z" fill="' + C.accent + '" stroke="' + C.accent + '" stroke-width="0.8"/>';
}
function motionPath(def, size){
  if(!def.track || !def.start || def.hold) return '';
  var pts = tracePoints(def);
  var d = 'M' + P(pts[0]);
  for(var j = 1; j < pts.length; j++) d += 'L' + P(pts[j]);
  var thumb = size === 'thumb', hw = thumb ? 3.6 : 3;
  var s = '<path d="' + d + '" stroke="' + C.accent + '" stroke-width="' + (thumb ? 2.8 : 2) + '"/>' +
    arrowHead(pts[pts.length - 1], angleOf(pts[pts.length - 3], pts[pts.length - 1]), hw);
  if(def.both) s += arrowHead(pts[0], angleOf(pts[2], pts[0]), hw);   // a two-way movement
  return s;
}
/* A static hold says so with a pause mark instead of a path. */
function holdMark(box, size){
  var x = box[2] - 2, y = box[1] + 3, h = size === 'thumb' ? 9 : 7;
  return '<path d="M' + P([x, y]) + 'L' + P([x, y + h]) + 'M' + P([x + 4.6, y]) + 'L' + P([x + 4.6, y + h]) +
    '" stroke="' + C.accent + '" stroke-width="' + (size === 'thumb' ? 2.8 : 2.2) + '"/>';
}

/* ---------- framing ---------- */
function bounds(markup){
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
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

/* ---------- the one public entry ---------- */
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
  var ghost = def.ghost || 'all';
  if(thumb && ghost === 'all') ghost = def.thumbGhost || 'none';     // whole-body ghosts only at full size
  var s = drawProps(J, def.scene);
  if(O && ghost !== 'none'){
    s += '<g opacity="' + (thumb ? 0.26 : 0.22) + '">' + drawProps(O, def.gear) + figure(O, 'ghost', ghost) + '</g>';
  }
  s += drawProps(J, def.behind);
  if(!def.gearFront) s += drawProps(J, def.gear);
  s += figure(J, 'solid');
  if(def.gearFront) s += drawProps(J, def.gear);
  s += drawProps(J, def.front);
  if(def.armOver) s += figure(J, 'solid', 'nearArm');
  s += motionPath(def, size);
  var box = bounds(s);
  if(def.hold) s += holdMark(box, size);
  /* Frame what is drawn. A thumbnail of arm work frames the upper body: the
     legs carry no information there and cost the arms half their size. */
  if(thumb && def.crop === 'upper'){
    var hipY = J.view === 'side' ? J.hip[1] : J.hc[1];
    box[3] = Math.min(box[3], hipY + 14);
  }
  if(thumb && def.crop === 'lower'){
    var hipL = J.view === 'side' ? J.hip[1] : J.hc[1];
    box[1] = Math.max(box[1], hipL - 8);
  }
  var pad = thumb ? 3 : 7;
  var w = box[2] - box[0], h = box[3] - box[1];
  var side = Math.max(w, h, thumb ? 40 : 58) + pad * 2;
  var cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  var vx = n1(cx - side / 2), vy = n1(cy - side / 2);
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
return { render: render, solve: solve, fit: fit, G: G, B: B, _mix: mixPose };
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
    function armTo(shoulder, hand, bend){
      var ua = ExerciseArt.B.ua, fa = ExerciseArt.B.fa;
      var dx = hand[0] - shoulder[0], dy = hand[1] - shoulder[1];
      var d = Math.max(Math.min(Math.sqrt(dx * dx + dy * dy), ua + fa - 0.01), Math.abs(ua - fa) + 0.01);
      var base = Math.atan2(dx, dy) * 180 / Math.PI;
      var a = Math.acos((ua * ua + d * d - fa * fa) / (2 * ua * d)) * 180 / Math.PI;
      var t = base + (bend < 0 ? -a : a);
      var e = [shoulder[0] + Math.sin(t * Math.PI / 180) * ua, shoulder[1] + Math.cos(t * Math.PI / 180) * ua];
      return [t, Math.atan2(hand[0] - e[0], hand[1] - e[1]) * 180 / Math.PI];
    }
    /* A front pose whose two hands meet exactly at `hand`. */
    function handsAt(pose, hand, bendL, bendR){
      var J = ExerciseArt.solve('front', pose), r = extend({}, pose);
      var L = armTo(J.lS, hand, bendL == null ? 1 : bendL), R = armTo(J.rS, hand, bendR == null ? -1 : bendR);
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
    function add(defs){ for(var k in defs) EXV_DEFS[k] = defs[k]; }
    return { G:G, FOOT:FOOT, S:S, supineBench:supineBench, seated:seated, BENCH_TOP:BENCH_TOP,
      legTo:legTo, planted:planted, armTo:armTo, handsAt:handsAt, sideHands:sideHands, at:at, add:add, extend:extend };
  })();

  /* Arms: elbow flexion and extension. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend, planted = H.planted;
  H.add({

  /* ---- elbow flexion ---- */
  curl_barbell: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:2, ffa:10 }),
    end:  S({ nua:18, nfa:152, fua:14, ffa:148 }),
    gear:[['plate', { at:'nW', r:7.4 }]], track:'nW' },

  curl_dumbbell: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:-2, ffa:4 }),
    end:  S({ nua:18, nfa:152, fua:-2, ffa:4 }),
    gear:[['dbFace', { at:'fW' }], ['dbFace', { at:'nW' }]], track:'nW' },

  curl_hammer: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:-2, ffa:4 }),
    end:  S({ nua:18, nfa:150, fua:-2, ffa:4 }),
    gear:[['db', { at:'fW', along:'ffa', aoff:90 }], ['db', { at:'nW', along:'nfa', aoff:90 }]], track:'nW' },

  curl_incline_db: { view:'side', crop:'upper', ghost:'arms',
    scene:[['pad', { a:[38, 91], b:[62, 91], w:5 }], ['post', { a:[50, 94], b:[50, G] }], ['pad', { a:[42, 90], b:[25, 63], w:5 }]],
    start:{ pin:['hip', [48, 85.5]], trunk:-148, neck:-162, nua:2, nfa:6, fua:-2, ffa:2, nth:90, nsh:-6, fth:90, fsh:-12 },
    end:  { pin:['hip', [48, 85.5]], trunk:-148, neck:-162, nua:2, nfa:158, fua:-2, ffa:2, nth:90, nsh:-6, fth:90, fsh:-12 },
    gear:[['dbFace', { at:'fW' }], ['dbFace', { at:'nW' }]], track:'nW' },

  curl_preacher: { view:'side', crop:'upper', ghost:'arms', armOver:true,
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['post', { a:[62, 79], b:[60, G] }]],
    front:[['pad', { a:[52.4, 67.4], b:[64.6, 75.4], w:7 }]],
    start:seat({ trunk:176, nua:58, nfa:64, fua:54, ffa:60 }),
    end:  seat({ trunk:176, nua:58, nfa:158, fua:54, ffa:154 }),
    gear:[['plate', { at:'nW', r:6.6 }]], track:'nW' },

  curl_cable: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:44 }]],
    start:S({ trunk:176, nua:10, nfa:30, fua:6, ffa:26 }),
    end:  S({ trunk:176, nua:18, nfa:150, fua:14, ffa:146 }),
    gear:[['cable', { from:[92, 98], to:'nW', grip:'bar' }]], track:'nW' },

  cable_hammer_curl: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:44 }]],
    start:S({ trunk:176, nua:10, nfa:30, fua:6, ffa:26 }),
    end:  S({ trunk:176, nua:18, nfa:150, fua:14, ffa:146 }),
    gear:[['cable', { from:[92, 98], to:'nW', grip:'rope' }]], track:'nW' },

  concentration_curl: { view:'side', crop:'upper', ghost:'arms',
    scene:[['bench', { x1:20, x2:58, y:92 }]],
    start:{ pin:['hip', [44, 86]], trunk:132, neck:142, nua:8, nfa:4, fua:44, ffa:34, nth:90, nsh:-8, fth:90, fsh:-12 },
    end:  { pin:['hip', [44, 86]], trunk:132, neck:142, nua:8, nfa:162, fua:44, ffa:34, nth:90, nsh:-8, fth:90, fsh:-12 },
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  machine_curl: { view:'side', crop:'upper', ghost:'arms', armOver:true,
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['post', { a:[67, 79], b:[67, G] }]],
    front:[['pad', { a:[52.6, 66.4], b:[65.4, 74], w:7 }]],
    start:seat({ trunk:176, nua:60, nfa:66, fua:56, ffa:62 }),
    end:  seat({ trunk:176, nua:60, nfa:166, fua:56, ffa:162 }),
    gear:[['lever', { pivot:[64.6, 71], to:'nW', handle:true }]], track:'nW' },

  band_curl: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:6, nfa:14, fua:2, ffa:10 }),
    end:  S({ nua:18, nfa:152, fua:14, ffa:148 }),
    gear:[['band', { from:'nA', fdx:3, fdy:1, to:'nW', bowX:3 }]], track:'nW' },

  /* ---- elbow extension ---- */
  triceps_pushdown: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:12 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:10, fua:8, ffa:6 }),
    gear:[['cable', { from:[92, 18], to:'nW', grip:'bar' }]], track:'nW' },

  rope_pushdown: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:96, top:12 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:6, fua:8, ffa:2 }),
    gear:[['cable', { from:[92, 18], to:'nW', grip:'rope' }]], track:'nW' },

  band_pushdown: { view:'side', crop:'upper', ghost:'arms',
    scene:[['wall', { x:94, top:10 }], ['anchor', { at:[92, 22] }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:14, nfa:112, fua:10, ffa:108 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:170, neck:166, nua:12, nfa:10, fua:8, ffa:6 }),
    gear:[['band', { from:[92, 22], to:'nW', bowX:2 }]], track:'nW' },

  overhead_ext_cable: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:22, top:10 }]],
    start:S({ pin:['nA', [64, 104.3]], trunk:156, neck:162, nua:166, nfa:-30, fua:162, ffa:-34, nth:-10, nsh:6, fth:16, fsh:-6 }),
    end:  S({ pin:['nA', [64, 104.3]], trunk:156, neck:162, nua:166, nfa:170, fua:162, ffa:166, nth:-10, nsh:6, fth:16, fsh:-6 }),
    gear:[['cable', { from:[26, 16], to:'nW', grip:'bar' }]], track:'nW' },

  overhead_rope_ext: { view:'side', crop:'upper', ghost:'arms',
    scene:[['column', { x:22, top:10 }]],
    start:S({ pin:['nA', [64, 104.3]], trunk:156, neck:162, nua:166, nfa:-30, fua:162, ffa:-34, nth:-10, nsh:6, fth:16, fsh:-6 }),
    end:  S({ pin:['nA', [64, 104.3]], trunk:156, neck:162, nua:166, nfa:170, fua:162, ffa:166, nth:-10, nsh:6, fth:16, fsh:-6 }),
    gear:[['cable', { from:[26, 16], to:'nW', grip:'rope' }]], track:'nW' },

  overhead_ext_triceps: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:176, nfa:-14, fua:172, ffa:-18 }),
    end:  S({ nua:176, nfa:178, fua:172, ffa:174 }),
    gear:[['db', { at:'nW', along:'nfa', ahead:3.4, len:4.2 }]], track:'nW' },

  band_triceps_ext: { view:'side', crop:'upper', ghost:'arms',
    start:S({ nua:176, nfa:-14, fua:172, ffa:-18 }),
    end:  S({ nua:176, nfa:178, fua:172, ffa:174 }),
    gear:[['band', { from:'nA', fdx:-2, to:'nW', bowX:-7 }]], track:'nW' },

  skullcrusher: { view:'side', ghost:'arms',
    scene:[['bench', { x1:24, x2:84, y:78 }]],
    start:sup({ nua:190, nfa:-26, fua:188, ffa:-30 }),
    end:  sup({ nua:190, nfa:182, fua:188, ffa:180 }),
    gear:[['plate', { at:'nW', r:6.6 }]], track:'nW' },

  triceps_kickback: { view:'side', ghost:'arms',
    scene:[['bench', { x1:24, x2:82, y:90 }]],
    start:{ pin:['fW', [74, 90]], trunk:100, neck:104, fua:0, ffa:0, fth:8, fsh:-90, fft:0, nth:24, nsh:-16, nua:-80, nfa:2 },
    end:  { pin:['fW', [74, 90]], trunk:100, neck:104, fua:0, ffa:0, fth:8, fsh:-90, fft:0, nth:24, nsh:-16, nua:-80, nfa:-78 },
    gear:[['db', { at:'nW', along:'nfa', aoff:90, len:4.4 }]], track:'nW' },

  dip: { view:'side', key:'start',
    scene:[['rail', { a:[40, 60.5], b:[84, 60.5], w:3.2 }], ['post', { a:[42, 61], b:[42, G] }], ['post', { a:[82, 61], b:[82, G] }]],
    start:{ pin:['nW', [62, 58.4]], trunk:160, neck:168, nua:-95, nfa:20, fua:-99, ffa:16, nth:22, nsh:-56, fth:14, fsh:-62 },
    end:  { pin:['nW', [62, 58.4]], trunk:172, neck:176, nua:4, nfa:2, fua:0, ffa:-2, nth:14, nsh:-48, fth:8, fsh:-54 },
    track:'sh' },

  dip_weighted: { view:'side', key:'start',
    scene:[['rail', { a:[40, 60.5], b:[84, 60.5], w:3.2 }], ['post', { a:[42, 61], b:[42, G] }], ['post', { a:[82, 61], b:[82, G] }]],
    start:{ pin:['nW', [62, 58.4]], trunk:160, neck:168, nua:-95, nfa:20, fua:-99, ffa:16, nth:22, nsh:-56, fth:14, fsh:-62 },
    end:  { pin:['nW', [62, 58.4]], trunk:172, neck:176, nua:4, nfa:2, fua:0, ffa:-2, nth:14, nsh:-48, fth:8, fsh:-54 },
    gear:[['rod', { a:'hip', b:'belt', c:'dim', w:1.2 }], ['disc', { at:'belt', dy:4, r:5.2 }]],
    track:'sh' },

  bench_dip: { view:'side', key:'start',
    scene:[['bench', { x1:20, x2:54, y:80 }]],
    start:planted({ pin:['nW', [52, 80]], trunk:178, neck:180, nua:-100, nfa:10, fua:-104, ffa:6, nft:90, fft:90 }, [86, 103.4], [82, 103.6]),
    end:  planted({ pin:['nW', [52, 80]], trunk:178, neck:180, nua:-14, nfa:-12, fua:-18, ffa:-16, nft:90, fft:90 }, [86, 103.4], [82, 103.6]),
    track:'sh' },

  bench_press_close_grip: { view:'side', ghost:'arms',
    scene:[['bench', { x1:24, x2:84, y:78 }]],
    start:sup({ nua:24, nfa:176, fua:20, ffa:174 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' }
  });
  })(EXV);

  /* Chest and shoulders: presses, flys, push-ups, raises. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend;
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

  H.add({

  /* ---- barbell and dumbbell presses ---- */
  bench_press_barbell: { view:'side', ghost:'arms', scene:[BENCH],
    start:sup({ nua:40, nfa:185, fua:36, ffa:182 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  bench_press_smith: { view:'side', ghost:'arms', scene:[['rail', { a:[49, 14], b:[49, G], w:2.4 }], ['rail', { a:[53, 14], b:[53, G], w:2.4 }], BENCH],
    start:sup({ nua:40, nfa:185, fua:36, ffa:182 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  bench_press_db: { view:'side', ghost:'arms', scene:[BENCH],
    start:sup({ nua:44, nfa:186, fua:40, ffa:183 }),
    end:  sup({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  bench_press_incline_bb: { view:'side', ghost:'arms', scene:INCLINE_SCENE,
    start:incline({ nua:22, nfa:175, fua:18, ffa:172 }),
    end:  incline({ nua:178, nfa:180, fua:174, ffa:176 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  incline_press_db: { view:'side', ghost:'arms', scene:INCLINE_SCENE,
    start:incline({ nua:26, nfa:176, fua:22, ffa:173 }),
    end:  incline({ nua:178, nfa:180, fua:174, ffa:176 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  db_floor_press: { view:'side', ghost:'arms',
    start:floor({ nua:76, nfa:180, fua:72, ffa:178 }),
    end:  floor({ nua:180, nfa:180, fua:176, ffa:178 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  /* ---- machines ---- */
  chest_press_machine: { view:'side', ghost:'arms',
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['pad', { a:[42, 90], b:[42, 56], w:5.4 }], ['column', { x:94, top:26 }]],
    start:seat({ trunk:178, nua:-68, nfa:88, fua:-72, ffa:84 }),
    end:  seat({ trunk:178, nua:84, nfa:88, fua:80, ffa:84 }),
    gear:[['lever', { pivot:[90, 34], to:'nW', handle:true }]], track:'nW' },

  incline_machine_press: { view:'side', ghost:'arms',
    scene:[['pad', { a:[40, 92], b:[62, 92], w:5 }], ['post', { a:[51, 95], b:[51, G] }], ['pad', { a:[42, 89], b:[30, 58], w:5.4 }], ['column', { x:96, top:14 }]],
    start:seat({ pin:['hip', [52, 86]], trunk:-162, neck:-170, nua:-40, nfa:130, fua:-44, ffa:126 }),
    end:  seat({ pin:['hip', [52, 86]], trunk:-162, neck:-170, nua:138, nfa:136, fua:134, ffa:132 }),
    gear:[['lever', { pivot:[92, 20], to:'nW', handle:true }]], track:'nW' },

  machine_shoulder_press: { view:'side', ghost:'arms',
    scene:[['pad', { a:[38, 92], b:[60, 92], w:5 }], ['post', { a:[49, 95], b:[49, G] }], ['pad', { a:[42, 90], b:[42, 54], w:5.4 }], ['column', { x:26, top:6 }]],
    start:seat({ trunk:178, nua:-40, nfa:178, fua:-44, ffa:176 }),
    end:  seat({ trunk:178, nua:174, nfa:178, fua:170, ffa:176 }),
    gear:[['lever', { pivot:[30, 16], to:'nW', handle:true }]], track:'nW' },

  /* ---- flys (front and top-down views: the arms move across the body) ---- */
  chest_fly_cable: { view:'front', ghost:'arms',
    scene:[['column', { x:12, top:8 }], ['column', { x:108, top:8 }]],
    start:F({ la:104, lfa:98, ra:104, rfa:98 }),
    end:  F({ la:14, lfa:-46, ra:14, rfa:-46 }),
    gear:[['cable', { from:[16, 15], to:'lW' }], ['cable', { from:[104, 15], to:'rW' }]], track:'rW' },

  chest_fly_incline_cable: { view:'front', ghost:'arms',
    scene:[['column', { x:12, top:60 }], ['column', { x:108, top:60 }]],
    start:F({ la:36, lfa:40, ra:36, rfa:40 }),
    end:  F({ la:150, lfa:204, ra:150, rfa:204 }),
    gear:[['cable', { from:[16, 98], to:'lW' }], ['cable', { from:[104, 98], to:'rW' }]], track:'rW' },

  pec_deck: { view:'front', ghost:'arms',
    scene:[['box', { x:47, y:29.5, w:26, h:52 }]],
    start:FS({ la:96, lfa:180, ra:96, rfa:180 }),
    end:  FS({ la:90, lfa:182, ra:90, rfa:182, uaScale:0.32 }),
    track:'rE' },

  db_floor_fly: { view:'front', ghost:'arms', ground:false,
    scene:[['mat', { x:6, y:40, w:108, h:40 }]],
    start:{ pin:['hc', [74, 60]], rot:-90, la:88, lfa:88, ra:88, rfa:88, lth:4, lsh:4, rth:4, rsh:4 },
    end:  { pin:['hc', [74, 60]], rot:-90, la:40, lfa:-30, ra:40, rfa:-30, uaScale:0.7, faScale:0.7, lth:4, lsh:4, rth:4, rsh:4 },
    gear:[['dbFace', { at:'lW', r:3.8 }], ['dbFace', { at:'rW', r:3.8 }]], track:'rW' },

  /* ---- push-ups ---- */
  pushup: { view:'side', key:'end',
    start:plank([-100, 8], [-104, 4], [82, 103.2]),
    end:  plank([2, 0], [-2, -2], [82, 103.2]),
    track:'sh' },

  pushup_close: { view:'side', key:'end',
    start:plank([-118, 4], [-122, 0], [78, 103.2]),
    end:  plank([-10, -8], [-14, -12], [78, 103.2]),
    track:'sh' },

  pushup_incline: { view:'side', key:'end',
    scene:[['bench', { x1:74, x2:104, y:80 }]],
    start:ExerciseArt.fit('side', function(a){ return { pin:['nW', [82, 79.4]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:-120, nfa:26, fua:-124, ffa:22 }; }, 60, 170, 'nT', G - 1.2),
    end:  ExerciseArt.fit('side', function(a){ return { pin:['nW', [82, 79.4]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:6, nfa:6, fua:2, ffa:2 }; }, 60, 170, 'nT', G - 1.2),
    track:'sh' },

  pushup_plyo: { view:'side', key:'end',
    start:plank([-100, 8], [-104, 4], [82, 103.2]),
    end:  plank([10, 12], [6, 8], [84, 95], 0),
    track:'nW' },

  pushup_plyo_box: { view:'side', key:'end',
    scene:[['box', { x:76, y:96, w:14, h:10 }]],
    start:plank([-100, 8], [-104, 4], [70, 103.2]),
    end:  ExerciseArt.fit('side', function(a){ return { pin:['nW', [83, 95.2]], trunk:a, neck:a - 8, nth:a - 180, nsh:a - 180, fth:a - 180, fsh:a - 180, nft:0, fft:0, nua:2, nfa:2, fua:-2, ffa:-2 }; }, 60, 160, 'nT', G - 1.2),
    track:'nW' },

  pike_pushup: { view:'side', key:'end',
    start:{ pin:['nW', [82, 103.2]], trunk:24, neck:18, nth:-38, nsh:-38, fth:-38, fsh:-38, nft:0, fft:0, nua:-70, nfa:36, fua:-74, ffa:32 },
    end:  { pin:['nW', [82, 103.2]], trunk:48, neck:40, nth:-48, nsh:-48, fth:-48, fsh:-48, nft:0, fft:0, nua:2, nfa:2, fua:-2, ffa:-2 },
    track:'sh' },

  band_chest_press: { view:'side', ghost:'arms', crop:'upper', gearFront:true,
    start:S({ nua:-66, nfa:88, fua:-70, ffa:84, nth:-6, fth:10, fsh:-4 }),
    end:  S({ nua:88, nfa:90, fua:84, ffa:86, nth:-6, fth:10, fsh:-4 }),
    gear:[['band', { from:'sh', fdx:-5, fdy:2, to:'nW', bowY:-3 }]], track:'nW' },

  med_ball_chest_pass: { view:'side', ghost:'arms', crop:'upper',
    start:S({ nua:-40, nfa:96, fua:-44, ffa:92, nth:-8, fth:14, fsh:-6 }),
    end:  S({ trunk:172, nua:84, nfa:86, fua:80, ffa:82, nth:-10, fth:16, fsh:-8 }),
    gear:[['medball', { at:'nW', dx:5 }]], track:'nW' },

  /* ---- overhead presses ---- */
  overhead_press_bb: { view:'side', ghost:'arms', crop:'upper',
    start:S({ nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  push_press: { view:'side', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  db_push_press: { view:'side', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:30, nfa:170, fua:26, ffa:168 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  kb_push_press: { view:'side', ghost:'all', key:'start',
    start:S({ trunk:176, nth:24, nsh:-24, fth:20, fsh:-26, nua:28, nfa:170, fua:-4, ffa:-2 }),
    end:  S({ nua:178, nfa:180, fua:-4, ffa:-2 }),
    gear:[['kettlebell', { at:'nW', inverted:true, dx:-2 }]], track:'nW' },

  shoulder_press_db: { view:'front', ghost:'arms',
    scene:[['box', { x:48, y:31.5, w:24, h:52 }]],
    start:FS({ la:92, lfa:178, ra:92, rfa:178 }),
    end:  FS({ la:156, lfa:170, ra:156, rfa:170 }),
    gear:[['db', { at:'lW', a:90, len:4.4 }], ['db', { at:'rW', a:90, len:4.4 }]], track:'rW' },

  shoulder_press_arnold: { view:'front', ghost:'arms', key:'start',
    scene:[['box', { x:48, y:31.5, w:24, h:52 }]],
    start:FS({ la:-12, lfa:176, ra:-12, rfa:176, uaScale:0.75 }),
    end:  FS({ la:168, lfa:176, ra:168, rfa:176 }),
    gear:[['db', { at:'lW', a:0, len:4.4 }], ['db', { at:'rW', a:0, len:4.4 }]], track:'rW' },

  landmine_press: { view:'side', ghost:'arms',
    start:{ pin:['fK', [58, G - 4]], trunk:172, neck:176, fth:0, fsh:-90, fft:-80, nth:94, nsh:0, nua:26, nfa:160, fua:-4, ffa:-2 },
    end:  { pin:['fK', [58, G - 4]], trunk:168, neck:172, fth:0, fsh:-90, fft:-80, nth:94, nsh:0, nua:140, nfa:140, fua:-4, ffa:-2 },
    gear:[['rod', { a:[14, G - 1], b:'nW', w:2.4 }], ['plate', { at:'nW', r:4.6, dx:-4, dy:2 }]], track:'nW' },

  band_shoulder_press: { view:'side', ghost:'arms', crop:'upper',
    start:S({ nua:34, nfa:168, fua:30, ffa:166 }),
    end:  S({ nua:178, nfa:180, fua:174, ffa:178 }),
    gear:[['band', { from:'nA', fdx:3, to:'nW', bowX:10 }]], track:'nW' },

  /* ---- raises and rear delts ---- */
  lateral_raise: { view:'front', ghost:'arms',
    start:F({ la:10, lfa:8, ra:10, rfa:8 }),
    end:  F({ la:88, lfa:86, ra:88, rfa:86 }),
    gear:[['db', { at:'lW', a:0, len:4.8 }], ['db', { at:'rW', a:0, len:4.8 }]], track:'rW' },

  lateral_raise_cable: { view:'front', ghost:'arms',
    scene:[['column', { x:12, top:60 }]],
    start:F({ la:-14, lfa:-16, ra:8, rfa:6 }),
    end:  F({ la:-14, lfa:-16, ra:90, rfa:88 }),
    gear:[['cable', { from:[16, 98], to:'rW' }]], track:'rW' },

  front_raise: { view:'side', ghost:'arms', crop:'upper',
    start:S({ nua:4, nfa:4, fua:0, ffa:0 }),
    end:  S({ nua:92, nfa:92, fua:0, ffa:0 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  upright_row: { view:'front', ghost:'arms',
    start:F({ la:8, lfa:-26, ra:8, rfa:-26 }),
    end:  F({ la:104, lfa:-52, ra:104, rfa:-52 }),
    gear:[['barFront', { half:26, pr:7.6 }]], track:'rW' },

  rear_delt_fly: { view:'front', ghost:'arms',
    start:F({ torsoScale:0.2, neckTilt:180, la:4, lfa:2, ra:4, rfa:2, lth:10, lsh:-6, rth:10, rsh:-6 }),
    end:  F({ torsoScale:0.2, neckTilt:180, la:86, lfa:86, ra:86, rfa:86, lth:10, lsh:-6, rth:10, rsh:-6 }),
    gear:[['db', { at:'lW', a:0, len:4.4 }], ['db', { at:'rW', a:0, len:4.4 }]], track:'rW' },

  reverse_pec_deck: { view:'front', ghost:'arms', armOver:true,
    front:[['box', { x:50, y:35.5, w:20, h:30 }]],
    start:FS({ la:90, lfa:90, ra:90, rfa:90, uaScale:0.3, faScale:0.3 }),
    end:  FS({ la:90, lfa:90, ra:90, rfa:90 }),
    track:'rW' },

  face_pull: { view:'side', ghost:'arms', crop:'upper',
    scene:[['column', { x:98, top:12 }]],
    start:S({ trunk:176, nua:106, nfa:104, fua:102, ffa:100 }),
    end:  S({ trunk:178, nua:-78, nfa:150, fua:-82, ffa:146 }),
    gear:[['cable', { from:[94, 24], to:'nW', grip:'rope' }]], track:'nW' },

  band_face_pull: { view:'side', ghost:'arms', crop:'upper',
    scene:[['wall', { x:96, top:12 }], ['anchor', { at:[94, 30] }]],
    start:S({ trunk:176, nua:104, nfa:102, fua:100, ffa:98 }),
    end:  S({ trunk:178, nua:-78, nfa:150, fua:-82, ffa:146 }),
    gear:[['band', { from:[94, 30], to:'nW' }]], track:'nW' },

  band_pull_apart: { view:'front', ghost:'arms', gearFront:true,
    start:F({ la:88, lfa:110, ra:88, rfa:110, uaScale:0.45, faScale:0.45 }),
    end:  F({ la:90, lfa:90, ra:90, rfa:90 }),
    gear:[['band', { from:'lW', to:'rW', bowY:1 }]], track:'rW', both:true },

  reverse_snow_angel: { view:'front', ghost:'arms', ground:false,
    scene:[['mat', { x:6, y:40, w:108, h:40 }]],
    start:{ pin:['hc', [48, 60]], rot:90, la:10, lfa:8, ra:10, rfa:8, lth:4, lsh:2, rth:4, rsh:2 },
    end:  { pin:['hc', [48, 60]], rot:90, la:160, lfa:166, ra:160, rfa:166, lth:4, lsh:2, rth:4, rsh:2 },
    track:'rW' },

  shrug: { view:'front', ghost:'none',
    start:F({ la:4, lfa:2, ra:4, rfa:2 }),
    end:  F({ la:4, lfa:2, ra:4, rfa:2, shrug:5 }),
    gear:[['barFront', { half:28, pr:8.4, dy:0 }]], track:'rS', trackOffset:[4, -3] }
  });
  })(EXV);

  /* Back and posterior chain: rows, pulldowns, pull-ups, hinges, bridges. */
  (function(H){
  var G = H.G, S = H.S, sup = H.supineBench, seat = H.seated, ext = H.extend, planted = H.planted;

  /* Front views. */
  function FS(o){ return ext({ pin:['hc', [60, 79.5]], thighScale:0.34, lth:18, lsh:4, rth:18, rsh:4 }, o); }
  /* Bent-over row stance. */
  function bent(o){ return S(ext({ trunk:120, neck:132, nth:30, nsh:-16, fth:26, fsh:-18 }, o)); }
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
  var GB_BOTTOM = planted({ pin:['sh', [34, G - 6.2]], trunk:-90, neck:-94, nua:88, nfa:88, fua:84, ffa:84 }, GB_FEET[0], GB_FEET[1]);
  var GB_TOP    = planted({ pin:['sh', [34, G - 6.2]], trunk:-62, neck:-80, nua:88, nfa:88, fua:84, ffa:84 }, GB_FEET[0], GB_FEET[1]);

  H.add({

  /* ---- rows ---- */
  row_barbell: { view:'side', ghost:'arms',
    start:bent({ nua:4, nfa:2, fua:0, ffa:-2 }),
    end:  bent({ nua:-74, nfa:38, fua:-78, ffa:34 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  pendlay_row: { view:'side', ghost:'arms', key:'start',
    start:S({ trunk:98, neck:108, nth:46, nsh:-26, fth:42, fsh:-28, nua:2, nfa:0, fua:-2, ffa:-4 }),
    end:  S({ trunk:98, neck:108, nth:46, nsh:-26, fth:42, fsh:-28, nua:-98, nfa:24, fua:-102, ffa:20 }),
    gear:[['plate', { at:'nW', dy:-1 }]], track:'nW' },

  seal_row: { view:'side', ghost:'arms',
    scene:[['bench', { x1:30, x2:86, y:62, h:5 }]],
    start:{ pin:['hip', [48, 55.8]], trunk:90, neck:96, nth:-90, nsh:-90, fth:-90, fsh:-90, nft:0, fft:0, nua:2, nfa:0, fua:-2, ffa:-2 },
    end:  { pin:['hip', [48, 55.8]], trunk:90, neck:96, nth:-90, nsh:-90, fth:-90, fsh:-90, nft:0, fft:0, nua:-122, nfa:4, fua:-126, ffa:0 },
    gear:[['plate', { at:'nW', r:7.4, dy:6 }]], gearFront:true, track:'nW' },

  row_meadows: { view:'side', ghost:'arms',
    start:bent({ trunk:116, nua:2, nfa:0, fua:40, ffa:30, nth:-10, nsh:-4, fth:36, fsh:-22 }),
    end:  bent({ trunk:116, nua:-80, nfa:34, fua:40, ffa:30, nth:-10, nsh:-4, fth:36, fsh:-22 }),
    gear:[['rod', { a:[10, G - 1], b:'nW', extB:5, w:2.4 }], ['plate', { at:'nW', r:5.4, dx:5.6, dy:-2.2 }]], track:'nW' },

  row_dumbbell: { view:'side', ghost:'arms', scene:[BRACE_BENCH],
    start:braced({ nua:0, nfa:0 }),
    end:  braced({ nua:-120, nfa:22 }),
    gear:[['dbFace', { at:'nW' }]], track:'nW' },

  kb_row: { view:'side', ghost:'arms', scene:[BRACE_BENCH],
    start:braced({ nua:0, nfa:0 }),
    end:  braced({ nua:-120, nfa:22 }),
    gear:[['kettlebell', { at:'nW', dy:-2 }]], track:'nW' },

  renegade_row: { view:'side', ghost:'arms',
    start:plankFrom(['fW', [80, 98.6]], [2, 0], [0, 0]),
    end:  plankFrom(['fW', [80, 98.6]], [-128, 24], [0, 0]),
    gear:[['db', { at:'fW', a:90, len:4.6 }], ['db', { at:'nW', a:90, len:4.6 }]], track:'nW' },

  row_cable_seated: { view:'side', ghost:'arms',
    scene:[['pad', { a:[26, 96], b:[52, 96], w:5 }], ['post', { a:[39, 99], b:[39, G] }], ['post', { a:[92, 88], b:[92, G] }], ['column', { x:102, top:60 }]],
    start:{ pin:['hip', [44, 90]], trunk:164, neck:170, nth:80, nsh:62, fth:78, fsh:60, nft:170, fft:170, nua:84, nfa:84, fua:80, ffa:80 },
    end:  { pin:['hip', [44, 90]], trunk:178, neck:180, nth:80, nsh:62, fth:78, fsh:60, nft:170, fft:170, nua:-58, nfa:86, fua:-62, ffa:82 },
    gear:[['cable', { from:[98, 78], to:'nW', grip:'bar' }]], track:'nW' },

  row_machine: { view:'side', ghost:'arms',
    scene:[['pad', { a:[36, 92], b:[58, 92], w:5 }], ['post', { a:[47, 95], b:[47, G] }], ['post', { a:[74, 78], b:[74, G] }], ['column', { x:96, top:40 }]],
    front:[['pad', { a:[66, 58], b:[66, 80], w:6.4 }]],
    start:seat({ pin:['hip', [48, 86]], trunk:168, neck:172, nua:84, nfa:86, fua:80, ffa:82 }),
    end:  seat({ pin:['hip', [48, 86]], trunk:168, neck:172, nua:-64, nfa:86, fua:-68, ffa:82 }),
    gear:[['lever', { pivot:[92, 46], to:'nW', handle:true }]], track:'nW' },

  tbar_row: { view:'side', ghost:'arms',
    start:bent({ trunk:118, nua:6, nfa:4, fua:2, ffa:0 }),
    end:  bent({ trunk:118, nua:-66, nfa:44, fua:-70, ffa:40 }),
    gear:[['rod', { a:[14, G - 1], b:'nW', w:2.4 }], ['plate', { at:'nW', r:7.2, dx:4, dy:2 }], ['rod', { a:'nW', adx:-4, b:'nW', bdx:4, w:2.2 }]], track:'nW' },

  trx_row: { view:'side', ghost:'all',
    scene:[['anchor', { at:[98, 10] }]],
    start:leanBack(-138, { nua:136, nfa:136, fua:132, ffa:132 }),
    end:  leanBack(-150, { nua:-52, nfa:128, fua:-56, ffa:124 }),
    gear:[['strap', { from:[98, 10], to:'nW' }]], track:'sh' },

  band_row: { view:'side', ghost:'arms', crop:'upper',
    scene:[['wall', { x:98, top:10 }], ['anchor', { at:[96, 60] }]],
    start:S({ trunk:178, nua:84, nfa:86, fua:80, ffa:82 }),
    end:  S({ trunk:180, nua:-60, nfa:88, fua:-64, ffa:84 }),
    gear:[['band', { from:[96, 60], to:'nW', bowY:2 }]], track:'nW' },

  towel_door_row: { view:'side', ghost:'all',
    scene:[['wall', { x:100, top:6 }], ['anchor', { at:[98, 58] }]],
    start:leanBack(-155, { nua:96, nfa:96, fua:92, ffa:92 }, [76, 104.3]),
    end:  leanBack(-166, { nua:-56, nfa:106, fua:-60, ffa:102 }, [76, 104.3]),
    gear:[['strap', { from:[98, 58], to:'nW' }]], track:'sh' },

  /* ---- vertical pulls ---- */
  lat_pulldown: { view:'front', ghost:'arms',
    scene:[['column', { x:60, top:0 }], ['pad', { a:[48, 71.5], b:[72, 71.5], w:4.2 }]],
    start:FS({ la:158, lfa:170, ra:158, rfa:170 }),
    end:  FS({ la:118, lfa:200, ra:118, rfa:200 }),
    gear:[['barFront', { half:26, plates:false }]], gearFront:true, track:'rW' },

  lat_pulldown_single: { view:'front', ghost:'arms',
    scene:[['column', { x:78, top:0 }], ['pad', { a:[48, 71.5], b:[72, 71.5], w:4.2 }]],
    start:FS({ la:14, lfa:20, ra:168, rfa:176 }),
    end:  FS({ la:14, lfa:20, ra:120, rfa:196 }),
    gear:[['cable', { from:[78, 4], to:'rW' }]], track:'rW' },

  straight_arm_pulldown: { view:'side', ghost:'arms',
    scene:[['column', { x:98, top:10 }]],
    start:S({ pin:['nA', [54, 104.3]], trunk:162, neck:164, nth:4, nsh:-6, fth:10, fsh:-8, nua:148, nfa:150, fua:144, ffa:146 }),
    end:  S({ pin:['nA', [54, 104.3]], trunk:162, neck:164, nth:4, nsh:-6, fth:10, fsh:-8, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    gear:[['cable', { from:[94, 16], to:'nW', grip:'bar' }]], track:'nW' },

  db_pullover: { view:'side', ghost:'arms',
    scene:[['bench', { x1:24, x2:84, y:78 }]],
    start:sup({ nua:-118, nfa:-124, fua:-122, ffa:-128 }),
    end:  sup({ nua:180, nfa:180, fua:176, ffa:176 }),
    gear:[['db', { at:'nW', along:'nfa', ahead:3.8, len:4.2 }]], track:'nW' },

  pullup: { view:'front', ghost:'all', key:'end', ground:false,
    scene:[['rod', { a:[14, 18], b:[106, 18], w:2.6 }]],
    start:{ pin:['lW', [38, 18]], la:164, lfa:176, ra:164, rfa:176, lth:2, lsh:8, rth:2, rsh:8 },
    end:  { pin:['lW', [38, 18]], la:126, lfa:206, ra:126, rfa:206, lth:4, lsh:14, rth:4, rsh:14 },
    track:'head' },

  chinup: { view:'side', ghost:'all', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hang({ trunk:178, nua:178, nfa:180, fua:174, ffa:176 }),
    end:  hang({ trunk:168, neck:176, nua:-14, nfa:162, fua:-18, ffa:158, nth:24, nsh:-20, fth:28, fsh:-16 }),
    track:'head' },

  pullup_weighted: { view:'front', ghost:'all', key:'end', ground:false,
    scene:[['rod', { a:[14, 18], b:[106, 18], w:2.6 }]],
    start:{ pin:['lW', [38, 18]], la:164, lfa:176, ra:164, rfa:176, lth:2, lsh:8, rth:2, rsh:8 },
    end:  { pin:['lW', [38, 18]], la:126, lfa:206, ra:126, rfa:206, lth:4, lsh:14, rth:4, rsh:14 },
    gear:[['rod', { a:'lap', b:'lap', bdy:14, c:'dim', w:1.2 }], ['disc', { at:'lap', dy:18, r:5.6 }]], gearFront:true,
    track:'head' },

  assisted_pullup: { view:'side', ghost:'all', key:'end',
    scene:[['bar', { at:[60, 16], r:2.6 }], ['post', { a:[40, 12], b:[40, G] }]],
    start:hang({ trunk:178, nua:178, nfa:180, fua:174, ffa:176, nth:88, nsh:-2, fth:86, fsh:-4 }),
    end:  hang({ trunk:170, neck:176, nua:-14, nfa:162, fua:-18, ffa:158, nth:88, nsh:-2, fth:86, fsh:-4 }),
    gear:[['pad', { a:'nK', adx:-8, ady:3, b:'nK', bdx:6, bdy:3, w:4.6 }], ['rod', { a:'nK', adx:-6, ady:4, b:[40, 70], c:'dim', w:2 }]],
    track:'head' },

  /* ---- hinges ---- */
  deadlift_conventional: { view:'side', key:'start',
    start:S({ trunk:120, neck:136, nth:64, nsh:-22, fth:62, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW', dy:3 }]], track:'nW' },

  sumo_deadlift: { view:'front', key:'start',
    start:{ pin:['lA', [36, 104.3]], hipY:74, lth:62, lsh:6, rth:62, rsh:6, lean:0, la:-2, lfa:-4, ra:-2, rfa:-4, torsoScale:0.7 },
    end:  { pin:['lA', [36, 104.3]], lth:26, lsh:4, rth:26, rsh:4, la:4, lfa:2, ra:4, rfa:2 },
    gear:[['barFront', { half:40, pr:8.4 }]], track:'rW' },

  deficit_deadlift: { view:'side', key:'start',
    scene:[['step', { x:40, w:36, h:5 }]],
    start:S({ pin:['nA', [58, 99.3]], trunk:118, neck:134, nth:68, nsh:-24, fth:64, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ pin:['nA', [58, 99.3]], nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW', dy:3 }]], track:'nW' },

  trap_bar_deadlift: { view:'side', key:'start',
    start:S({ trunk:138, neck:150, nth:74, nsh:-30, fth:72, fsh:-34, nua:-2, nfa:0, fua:-6, ffa:-4 }),
    end:  S({ nua:2, nfa:0, fua:-2, ffa:-2 }),
    gear:[['plate', { at:'nW', r:7.8 }], ['rod', { a:'nW', adx:-15, b:'nW', bdx:15, w:2.4 }]], gearFront:true, track:'nW' },

  rack_pull: { view:'side', key:'start',
    scene:[['rail', { a:[76, 20], b:[76, G], w:2.8 }], ['rod', { a:[70, 76], b:[82, 76], w:2.4 }]],
    start:S({ trunk:140, neck:152, nth:30, nsh:-14, fth:26, fsh:-16, nua:-8, nfa:-6, fua:-12, ffa:-10 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW' }]], track:'nW' },

  db_deadlift: { view:'side', key:'start',
    start:S({ trunk:124, neck:138, nth:62, nsh:-22, fth:60, fsh:-26, nua:-4, nfa:-2, fua:-8, ffa:-6 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['db', { at:'nW', a:90, len:5 }]], track:'nW' },

  deadlift_romanian: { view:'side', key:'start',
    start:S({ trunk:104, neck:116, nth:-6, nsh:-14, fth:-10, fsh:-16, nua:4, nfa:2, fua:0, ffa:0 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['plate', { at:'nW', dy:2 }]], track:'nW' },

  db_rdl: { view:'side', key:'start',
    start:S({ trunk:104, neck:116, nth:-6, nsh:-14, fth:-10, fsh:-16, nua:4, nfa:2, fua:0, ffa:0 }),
    end:  S({ nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['db', { at:'nW', a:90, len:5 }]], track:'nW' },

  single_leg_rdl: { view:'side', key:'start',
    start:S({ trunk:96, neck:104, nth:6, nsh:-6, fth:-84, fsh:-84, fft:0, nua:2, nfa:0, fua:-2, ffa:-2 }),
    end:  S({ nth:0, nsh:0, fth:-6, fsh:-60, fft:30, nua:4, nfa:2, fua:0, ffa:0 }),
    gear:[['dbFace', { at:'nW' }]], track:'head' },

  good_morning: { view:'side', key:'start',
    start:S({ trunk:98, neck:108, nth:-8, nsh:-14, fth:-12, fsh:-16, nua:-110, nfa:50, fua:-114, ffa:46 }),
    end:  S({ nua:-40, nfa:156, fua:-44, ffa:152 }),
    gear:[['plate', { at:'back', dx:0, dy:-1 }]], track:'head' },

  /* 45-degree back extension: feet low behind, thighs on the pad, torso rises to a straight line. */
  back_extension: { view:'side', key:'end',
    scene:[['pad', { a:'hip', b:'nK', off:7.6, extA:-2, extB:-8, w:6 }], ['post', { a:'hip', adx:6, ady:12, b:[70, G] }],
      ['rod', { a:'nT', adx:-2.7, ady:5.8, b:'nT', bdx:5.8, bdy:-2.7, w:2.6 }], ['post', { a:'nT', adx:1.6, ady:1.6, b:[34, G] }],
      ['bar', { at:'nA', r:2.4, dx:-3.4, dy:-3.4 }]],
    start:ext({ pin:['nA', [30, 90]], nth:-45, nsh:-45, fth:-45, fsh:-45, nft:45, fft:45, trunk:34, neck:30 }, folded(34)),
    end:  ext({ pin:['nA', [30, 90]], nth:-45, nsh:-45, fth:-45, fsh:-45, nft:45, fft:45, trunk:135, neck:138 }, folded(135)),
    track:'head' },

  superman_hold: { view:'side', hold:true,
    end:{ pin:['hip', [60, G - 6.2]], trunk:100, neck:106, nth:-100, nsh:-100, fth:-98, fsh:-98, nft:-90, fft:-90, nua:118, nfa:118, fua:114, ffa:114 } },

  kb_swing: { view:'side', key:'end',
    start:S({ trunk:118, neck:134, nth:26, nsh:-14, fth:22, fsh:-16, nua:-18, nfa:-20, fua:-22, ffa:-24 }),
    end:  S({ nua:92, nfa:92, fua:88, ffa:88 }),
    gear:[['kettlebell', { at:'nW', dx:2 }]], track:'nW' },

  cable_pull_through: { view:'side', key:'start',
    scene:[['column', { x:14, top:50 }]],
    start:S({ trunk:106, neck:118, nth:14, nsh:-12, fth:8, fsh:-14, nua:-24, nfa:-30, fua:-28, ffa:-34 }),
    end:  S({ nua:-4, nfa:-6, fua:-8, ffa:-10 }),
    gear:[['cable', { from:[18, 100], to:'nW', grip:'rope' }]], track:'hip' },

  hip_thrust: { view:'side', key:'end',
    scene:[['bench', { x1:8, x2:38, y:91, h:5 }]],
    start:HT_BOTTOM, end:HT_TOP,
    gear:[['plate', { at:'lap' }]], gearFront:true, track:'hip' },

  hip_thrust_machine: { view:'side', key:'end',
    scene:[['pad', { a:[8, 93.4], b:[38, 93.4], w:5 }], ['post', { a:[22, 96], b:[22, G] }], ['post', { a:[100, 66], b:[100, G] }]],
    start:HT_BOTTOM, end:HT_TOP,
    gear:[['lever', { pivot:[100, 68], to:'lap', dy:-2, roller:4.2 }]], gearFront:true, track:'hip' },

  glute_bridge: { view:'side', key:'end',
    start:GB_BOTTOM, end:GB_TOP, track:'hip' },

  single_leg_glute_bridge: { view:'side', key:'end',
    start:ext(GB_BOTTOM, { fth:104, fsh:104, fft:170 }),
    end:  ext(GB_TOP, { fth:118, fsh:118, fft:190 }),
    track:'hip' },

  nordic_curl: { view:'side', key:'end',
    scene:[['mat', { x:30, y:103.6, w:42, h:2.4 }], ['pad', { a:[33, 93.4], b:[45, 93.4], w:5 }], ['post', { a:[34, 94], b:[28, G] }]],
    start:ext({ pin:['nK', [58, 100.2]], nth:0, nsh:-90, fth:0, fsh:-90, nft:-90, fft:-90, trunk:180, neck:180 }, folded(180)),
    end:  { pin:['nK', [58, 100.2]], nth:-58, nsh:-90, fth:-58, fsh:-90, nft:-90, fft:-90, trunk:122, neck:118, nua:84, nfa:96, fua:80, ffa:92 },
    track:'head' },

  leg_curl: { view:'side', ghost:'legs',
    scene:[['pad', { a:[20, 80], b:[76, 80], w:6 }], ['post', { a:[30, 83], b:[30, G] }], ['post', { a:[66, 83], b:[66, G] }]],
    start:{ pin:['hip', [48, 74]], trunk:-90, neck:-96, nth:90, nsh:90, fth:90, fsh:90, nft:0, fft:0, nua:0, nfa:-40, fua:-4, ffa:-44 },
    end:  { pin:['hip', [48, 74]], trunk:-90, neck:-96, nth:90, nsh:-160, fth:90, fsh:-164, nft:-70, fft:-70, nua:0, nfa:-40, fua:-4, ffa:-44 },
    gear:[['lever', { pivot:[68, 74], to:'nA', roller:3.6 }]], gearFront:true, track:'nA' },

  glute_kickback_cable: { view:'side', ghost:'legs',
    scene:[['column', { x:96, top:20 }]],
    start:S({ pin:['fA', [62, 104.3]], trunk:130, neck:136, fth:10, fsh:-4, nth:0, nsh:-40, nft:80, nua:70, nfa:74, fua:66, ffa:70 }),
    end:  S({ pin:['fA', [62, 104.3]], trunk:130, neck:136, fth:10, fsh:-4, nth:-78, nsh:-70, nft:30, nua:70, nfa:74, fua:66, ffa:70 }),
    gear:[['cable', { from:[92, 100], to:'nA' }]], track:'nA' },

  farmers_carry: { view:'side', ghost:'none',
    start:S({ pin:['nA', [50, 104.3]], nth:-20, nsh:-6, fth:20, fsh:-14, nua:2, nfa:0, fua:-2, ffa:-2 }),
    end:  S({ pin:['nA', [66, 104.3]], nth:20, nsh:-14, fth:-20, fsh:-6, nua:2, nfa:0, fua:-2, ffa:-2 }),
    gear:[['db', { at:'fW', a:90, len:5.4, hw:7 }], ['db', { at:'nW', a:90, len:5.4, hw:7 }]],
    front:[['travel', { from:[48, 16], to:[78, 16] }]] },

  power_clean: { view:'side', key:'end',
    start:S({ trunk:120, neck:136, nth:64, nsh:-22, fth:62, fsh:-26, nua:-6, nfa:-4, fua:-10, ffa:-8 }),
    end:  S({ trunk:176, nth:34, nsh:-30, fth:30, fsh:-32, nua:62, nfa:-170, fua:58, ffa:-174 }),
    gear:[['plate', { at:'nW' }]], track:'nW' }
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
  /* 45-degree leg press: reclined seat, the platform rides a 45-degree line. */
  function press(ankle){
    return planted({ pin:['hip', [44, 84]], trunk:-120, neck:-126, nua:56, nfa:58, fua:52, ffa:54, nft:-135, fft:-135 }, ankle, [ankle[0] - 1.5, ankle[1] + 1]);
  }
  /* Lunges: split stance, front foot planted, rear heel up. */
  var LUNGE_FEET = [[72, 104.3], [21.2, 95.5]];
  function lunge(hip, arms){ return planted(ext({ pin:['hip', hip], trunk:178, neck:178, nft:90, fft:-20 }, arms), LUNGE_FEET[0], LUNGE_FEET[1]); }
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
  function seatedCalf(footAngle){
    var ankle = [CS_TOE[0] - Math.sin(footAngle * Math.PI / 180) * 7.4, CS_TOE[1] - Math.cos(footAngle * Math.PI / 180) * 7.4];
    return planted({ pin:['hip', [48, 83.5]], trunk:178, neck:180, nft:footAngle, fft:footAngle, nua:30, nfa:60, fua:26, ffa:56 }, ankle, [ankle[0] - 1, ankle[1]]);
  }

  H.add({

  /* ---- squats ---- */
  squat_back: { view:'side', both:true,
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:88, nsh:-28, trunk:142, neck:150 }, barBack(142))),
    gear:[['plate', { at:'back' }]], track:'hip', trackOffset:[-9, 0] },

  squat_front: { view:'side', both:true,
    start:sq(ext({ trunk:180 }, rackArms(180))),
    end:  sq(ext({ nth:92, nsh:-34, trunk:160, neck:166 }, rackArms(160))),
    gear:[['plate', { at:'rack' }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  box_squat: { view:'side', both:true,
    scene:[['plinth', { at:'hip', dx:-4, dy:6.4, w:16 }]],
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:80, nsh:-8, trunk:138, neck:146 }, barBack(138))),
    gear:[['plate', { at:'back' }]], track:'hip', trackOffset:[-12, -2] },

  squat_smith: { view:'side', both:true,
    scene:[['guide', { at:'back', top:6 }]],
    start:sq(ext({ trunk:180 }, barBack(180))),
    end:  sq(ext({ nth:90, nsh:-20, trunk:150, neck:158 }, barBack(150))),
    gear:[['plate', { at:'back', r:7.4 }]], track:'hip', trackOffset:[-9, 0] },

  squat_goblet: { view:'side', both:true,
    start:sq({ nua:24, nfa:170, fua:20, ffa:166 }),
    end:  sq({ nth:92, nsh:-32, trunk:158, neck:164, nua:14, nfa:170, fua:10, ffa:166 }),
    gear:[['db', { at:'nW', a:180, len:4.2, hw:6.6 }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  squat_goblet_kb: { view:'side', both:true,
    start:sq({ nua:24, nfa:170, fua:20, ffa:166 }),
    end:  sq({ nth:92, nsh:-32, trunk:158, neck:164, nua:14, nfa:170, fua:10, ffa:166 }),
    gear:[['kettlebell', { at:'nW', dy:-1 }]], gearFront:true, track:'hip', trackOffset:[-9, 0] },

  squat_hack: { view:'side', ghost:'legs', both:true,
    scene:[['rail', { a:'hip', b:'sh', off:15, extA:12, extB:26, w:3 }], ['pad', { a:'hip', b:'sh', off:9.4, extA:3, extB:2, w:6 }], ['step', { x:62, w:30, h:3 }]],
    start:hack([58.8, 67.2]),
    end:  hack([64.84, 84.79]),
    track:'hip', trackOffset:[-4, 0] },

  leg_press: { view:'side', ghost:'legs', key:'start',
    scene:[['rail', { a:[58, 104], b:[104, 58], w:3 }], ['pad', { a:[30, 92.6], b:[54, 92.6], w:5 }], ['post', { a:[42, 95], b:[42, G] }],
      ['pad', { a:'hip', b:'sh', off:9.2, extA:-2, extB:4, w:6 }]],
    start:press([58.85, 69.15]),
    end:  press([70.16, 57.84]),
    gear:[['pad', { a:'nA', b:'nT', off:-5.4, extA:5, extB:4, w:5 }]], track:'nA' },

  bodyweight_squat: { view:'side', both:true,
    start:sq({ nua:4, nfa:2, fua:0, ffa:-2 }),
    end:  sq({ nth:92, nsh:-32, trunk:150, neck:158, nua:92, nfa:92, fua:88, ffa:88 }),
    track:'hip', trackOffset:[-9, 0] },

  band_squat: { view:'side', both:true, gearFront:true,
    start:sq({ nua:22, nfa:168, fua:18, ffa:164 }),
    end:  sq({ nth:92, nsh:-32, trunk:156, neck:162, nua:12, nfa:160, fua:8, ffa:156 }),
    gear:[['band', { from:'nT', fdx:-3, to:'nW', bowX:3 }]], track:'hip', trackOffset:[-9, 0] },

  wall_sit: { view:'side', hold:true,
    scene:[['wall', { x:24, top:30 }]],
    end:{ pin:['hip', [36.2, 85.8]], trunk:180, neck:180, nth:90, nsh:0, fth:90, fsh:-4, nft:90, fft:90, nua:14, nfa:84, fua:10, ffa:80 } },

  squat_to_press: { view:'side', key:'end', thumbGhost:'legs',
    start:sq({ nth:92, nsh:-32, trunk:156, neck:162, nua:30, nfa:176, fua:26, ffa:172 }),
    end:  sq({ nua:176, nfa:178, fua:172, ffa:176 }),
    gear:[['db', { at:'nW', a:90, len:4.6 }]], track:'nW' },

  /* ---- lunges and single-leg work ---- */
  lunge: { view:'side', both:true,
    start:lunge([46.6, 76], DB_SIDES),
    end:  lunge([52.5, 85.8], DB_SIDES),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[0, -8] },

  lunge_walking: { view:'side',
    start:lunge([46.6, 76], { nua:-14, nfa:-6, fua:16, ffa:30 }),
    end:  lunge([52.5, 85.8], { nua:16, nfa:30, fua:-14, ffa:-6 }),
    front:[['travel', { from:[36, 34], to:[68, 34] }]] },

  bodyweight_lunge: { view:'side', both:true,
    start:lunge([46.6, 76], HANDS_ON_HIPS),
    end:  lunge([52.5, 85.8], HANDS_ON_HIPS),
    track:'hip', trackOffset:[0, -10] },

  split_squat_bulgarian: { view:'side', both:true,
    scene:[['bench', { x1:-2, x2:25, y:86 }]],
    start:bss([52, 73]),
    end:  bss([50, 86]),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[0, -9] },

  step_up: { view:'side', scene:[STEP_BOX],
    start:stepStart({ nua:-30, nfa:-10, fua:30, ffa:60 }),
    end:  stepTop({ nua:30, nfa:60, fua:-30, ffa:-10 }),
    track:'hip', trackOffset:[-8, 0] },

  db_step_up: { view:'side', scene:[STEP_BOX],
    start:stepStart(DB_SIDES),
    end:  stepTop(DB_SIDES),
    gear:[['db', { at:'fW', a:90, len:4.8 }], ['db', { at:'nW', a:90, len:4.8 }]], track:'hip', trackOffset:[-8, 0] },

  /* ---- jumps ---- */
  lateral_bound: { view:'front',
    start:LB_START, end:LB_END,
    front:[['arc', { from:at('front', LB_START, 'hc'), to:at('front', LB_END, 'hc'), h:14 }]] },

  box_jump: { view:'side',
    scene:[['step', { x:66, w:32, h:26 }]],
    start:BJ_START, end:BJ_END,
    front:[['arc', { from:at('side', BJ_START, 'hip'), to:at('side', BJ_END, 'hip'), h:16 }]] },

  broad_jump: { view:'side',
    start:BR_START, end:BR_END,
    front:[['arc', { from:at('side', BR_START, 'hip'), to:at('side', BR_END, 'hip'), h:20 }]] },

  /* ---- machines and isolation ---- */
  leg_extension: { view:'side', ghost:'legs',
    scene:[['pad', { a:[34, 86.6], b:[68, 86.6], w:5 }], ['pad', { a:[40, 84], b:[38, 50], w:5.4 }], ['post', { a:[50, 89], b:[50, G] }], ['post', { a:[40, 89], b:[36, G] }]],
    start:{ pin:['hip', [50, 80]], trunk:176, neck:178, nth:90, fth:88, nsh:-4, fsh:-6, nft:90, fft:90, nua:30, nfa:40, fua:26, ffa:36 },
    end:  { pin:['hip', [50, 80]], trunk:176, neck:178, nth:90, fth:88, nsh:88, fsh:84, nft:170, fft:166, nua:30, nfa:40, fua:26, ffa:36 },
    gear:[['lever', { pivot:[69.5, 80], to:'nA', roller:3.4 }]], gearFront:true, track:'nA' },

  calf_raise: { view:'side', crop:'lower',
    scene:[['step', { x:64, w:16, h:6 }]],
    start:{ pin:['nT', [68, 97.4]], nft:112, fft:112, trunk:180, nua:4, nfa:2, fua:0, ffa:-2 },
    end:  { pin:['nT', [68, 97.4]], nft:50, fft:50, trunk:180, nua:4, nfa:2, fua:0, ffa:-2 },
    track:'nA', trackOffset:[-5.5, 0] },

  calf_raise_seated: { view:'side', crop:'lower', ghost:'legs',
    scene:[['pad', { a:[30, 92], b:[58, 92], w:5 }], ['post', { a:[44, 95], b:[44, G] }], ['step', { x:70, w:14, h:4 }]],
    start:seatedCalf(112),
    end:  seatedCalf(60),
    gear:[['pad', { a:'nK', adx:-7, ady:-6.4, b:'nK', bdx:5, bdy:-6.4, w:5 }]], gearFront:true,
    track:'nA', trackOffset:[-5.5, 0] },

  hip_abduction: { view:'front', ghost:'legs', both:true,
    scene:[['box', { x:44, y:26, w:32, h:56 }]],
    start:FS({ lth:8, lsh:10, rth:8, rsh:10, la:20, lfa:10, ra:20, rfa:10 }),
    end:  FS({ thighScale:0.7, lth:60, lsh:14, rth:60, rsh:14, la:20, lfa:10, ra:20, rfa:10 }),
    gear:[['pad', { a:'lK', adx:-5.6, ady:-5, b:'lK', bdx:-5.6, bdy:5, w:4.4 }], ['pad', { a:'rK', adx:5.6, ady:-5, b:'rK', bdx:5.6, bdy:5, w:4.4 }]], gearFront:true,
    track:'rK' },

  band_lateral_walk: { view:'front', ghost:'legs',
    start:F({ pin:['lA', [44, 104.3]], thighScale:0.86, lth:6, lsh:2, rth:6, rsh:2, la:40, lfa:-30, ra:40, rfa:-30 }),
    end:  F({ pin:['lA', [36, 104.3]], thighScale:0.86, lth:20, lsh:8, rth:20, rsh:8, la:40, lfa:-30, ra:40, rfa:-30 }),
    gear:[['band', { from:'lK', fdy:-2, to:'rK', dy:-2 }]], gearFront:true,
    front:[['travel', { from:[42, 16], to:[74, 16] }]] }
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
    var p = kneel([36, G - 4.4], { nth:nth, fth:nth - 2, trunk:trunk, neck:trunk + 6 });
    return sideHands(p, [hubX, G - 4.4], [hubX - 1, G - 4.4], 1);
  }
  /* Captain's chair: forearms on the pads, back on the pad. */
  function chair(o){ return ext({ pin:['nE', [60, 52]], nua:0, nfa:90, fua:-2, ffa:88, trunk:180, neck:180, nft:90, fft:90 }, o); }
  /* Hanging from a bar at (60, 16). */
  function hanging(o){ return ext({ pin:['nW', [60, 16]], nua:180, nfa:180, fua:176, ffa:176, trunk:180, neck:180 }, o); }
  /* Seated V for Russian twists, seen from the front. */
  function vSit(o){ return ext({ pin:['hc', [60, 99]], torsoScale:0.9, thighScale:0.62, shinScale:0.46, lth:146, lsh:30, rth:146, rsh:30, sw:7.2 }, o); }
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
  plank: { view:'side', hold:true, end:forearmPlank() },

  weighted_plank: { view:'side', hold:true, end:forearmPlank(),
    gear:[['pad', { a:'hip', b:'sh', off:9.6, extA:-4, extB:-6, w:3.6 }]] },

  side_plank: { view:'front', hold:true,
    end:sidePlank(function(r){ return { la:8, lfa:-40 }; }) },

  side_plank_reach: { view:'front', both:true, key:'start',
    start:sidePlank(function(r){ return { la:180 - r, lfa:180 - r }; }),
    end:  sidePlank(function(r){ return { la:36 - r, lfa:10 - r }; }),
    track:'lW' },

  hollow_hold: { view:'side', hold:true,
    end:supine({ trunk:-102, neck:-112, nua:-110, nfa:-110, fua:-112, ffa:-112, nth:104, nsh:104, fth:102, fsh:102, nft:180, fft:180 }) },

  /* ---- crunches and sit-ups ---- */
  crunch: { view:'side', key:'end',
    start:kneesUp(supine(ext({ trunk:-90 }, behindHead(-90)))),
    end:  kneesUp(supine(ext({ trunk:-122, neck:-138 }, behindHead(-122)))),
    track:'sh' },

  machine_crunch: { view:'side', key:'end',
    scene:[['pad', { a:[36, 92], b:[60, 92], w:5 }], ['post', { a:[48, 95], b:[48, G] }], ['post', { a:[30, 30], b:[30, G] }]],
    start:seat({ trunk:176, neck:178, nua:30, nfa:176, fua:26, ffa:172 }),
    end:  seat({ trunk:132, neck:126, nua:-14, nfa:132, fua:-18, ffa:128 }),
    gear:[['pad', { a:'sh', b:'hip', off:9.6, extA:-3, extB:-13, w:5 }], ['lever', { pivot:[30, 34], to:'sh', dy:-4 }]],
    track:'head' },

  cable_crunch: { view:'side', key:'end',
    scene:[['column', { x:104, top:6 }]],
    start:ropeCrunch(156, 150),
    end:  ropeCrunch(66, 40),
    gear:[['cable', { from:[100, 12], to:'nW', grip:'rope' }]], track:'head' },

  bicycle_crunch: { view:'side', both:true,
    start:supine(ext({ trunk:-124, neck:-144, nth:-160, nsh:100, nft:170, fth:100, fsh:100, fft:180 }, behindHead(-124))),
    end:  supine(ext({ trunk:-124, neck:-144, fth:-160, fsh:100, fft:170, nth:100, nsh:100, nft:180 }, behindHead(-124))),
    track:'nK' },

  reverse_crunch: { view:'side', key:'end',
    start:{ pin:['sh', [36, G - 6.2]], trunk:-90, neck:-94, nua:88, nfa:88, fua:84, ffa:84, nth:180, nsh:90, fth:176, fsh:86, nft:180, fft:176 },
    end:  { pin:['sh', [36, G - 6.2]], trunk:-64, neck:-86, nua:88, nfa:88, fua:84, ffa:84, nth:-150, nsh:110, fth:-154, fsh:106, nft:200, fft:196 },
    track:'nK' },

  decline_situp: { view:'side', key:'end',
    scene:[['pad', { a:[18, 92], b:[76, 71], w:5 }], ['post', { a:[24, 94], b:[22, G] }], ['post', { a:[70, 74], b:[74, G] }],
      ['bar', { at:'nA', dx:2.4, dy:-3.8, r:2.8 }]],
    start:decline(ext({ trunk:DECLINE.trunk, neck:DECLINE.trunk - 4 }, folded(DECLINE.trunk))),
    end:  decline(ext({ trunk:150, neck:146 }, folded(150))),
    track:'head' },

  weighted_situp: { view:'side', key:'end',
    start:kneesUp(supine(ext({ trunk:-90 }, folded(-90)))),
    end:  kneesUp(supine(ext({ trunk:-162, neck:-170 }, folded(-162)))),
    gear:[['disc', { at:'chest', r:5.6 }]], gearFront:true, track:'head' },

  v_up: { view:'side', key:'end',
    start:supine({ trunk:-90, neck:-90, nua:-90, nfa:-90, fua:-92, ffa:-92, nth:90, nsh:90, fth:92, fsh:92, nft:170, fft:170 }),
    end:  supine({ trunk:-138, neck:-128, nua:146, nfa:146, fua:142, ffa:142, nth:138, nsh:138, fth:136, fsh:136, nft:210, fft:208 }),
    track:'nW' },

  dead_bug: { view:'side', both:true, key:'end',
    start:supine({ nua:180, nfa:180, fua:176, ffa:176, nth:180, nsh:90, fth:176, fsh:86, nft:180, fft:176 }),
    end:  supine({ nua:-100, nfa:-100, fua:176, ffa:176, nth:180, nsh:90, fth:98, fsh:98, nft:180, fft:188 }),
    track:'nW' },

  bird_dog: { view:'side', key:'end',
    start:kneel([40, G - 4.4], { nth:0, fth:0, trunk:100, neck:104, nua:0, nfa:0, fua:-2, ffa:-2 }),
    end:  kneel([40, G - 4.4], { nth:0, trunk:100, neck:102, nua:104, nfa:104, fua:-2, ffa:-2, fth:-84, fsh:-84, fft:-84 }),
    track:'nW' },

  flutter_kicks: { view:'side', both:true,
    start:supine({ trunk:-98, neck:-112, nua:88, nfa:88, fua:84, ffa:84, nth:112, nsh:112, fth:98, fsh:98, nft:190, fft:180 }),
    end:  supine({ trunk:-98, neck:-112, nua:88, nfa:88, fua:84, ffa:84, nth:98, nsh:98, fth:112, fsh:112, nft:180, fft:190 }),
    track:'nA' },

  /* ---- leg raises ---- */
  leg_raise: { view:'side', key:'end',
    start:supine({ nua:88, nfa:88, fua:84, ffa:84, nth:94, nsh:94, fth:92, fsh:92, nft:180, fft:180 }),
    end:  supine({ nua:88, nfa:88, fua:84, ffa:84, nth:176, nsh:176, fth:172, fsh:172, nft:260, fft:256 }),
    track:'nA' },

  hanging_leg_raise: { view:'side', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hanging({ nth:4, nsh:4, fth:0, fsh:0, nft:40, fft:40 }),
    end:  hanging({ nth:96, nsh:96, fth:92, fsh:92, nft:180, fft:176 }),
    track:'nA' },

  hanging_knee_raise: { view:'side', key:'end', ground:false,
    scene:[['bar', { at:[60, 16], r:2.6 }], ['rod', { a:[40, 16], b:[80, 16], c:'dim', w:1.4 }]],
    start:hanging({ nth:4, nsh:4, fth:0, fsh:0, nft:40, fft:40 }),
    end:  hanging({ nth:104, nsh:6, fth:100, fsh:2, nft:80, fft:76 }),
    track:'nK' },

  leg_raise_machine: { view:'side', key:'end',
    scene:[['pad', { a:[50, 36], b:[50, 76], w:6 }], ['post', { a:[50, 76], b:[50, G] }], ['pad', { a:[52, 55.6], b:[76, 55.6], w:4 }], ['post', { a:[74, 57], b:[74, G] }]],
    start:chair({ nth:0, nsh:0, fth:-2, fsh:-2 }),
    end:  chair({ nth:100, nsh:4, fth:96, fsh:0 }),
    track:'nK' },

  ab_wheel: { view:'side', key:'end',
    start:wheelPose(22, 110, 54),
    end:  wheelPose(-64, 100, 100),
    gear:[['wheel', { at:'nW' }]], track:'nW' },

  /* ---- rotation and anti-rotation ---- */
  russian_twist: { view:'front', both:true,
    start:handsAt(vSit({ lean:-12 }), [38, 84]),
    end:  handsAt(vSit({ lean:12 }), [82, 84]),
    track:'mid' },

  weighted_russian_twist: { view:'front', both:true,
    start:handsAt(vSit({ lean:-12 }), [38, 84]),
    end:  handsAt(vSit({ lean:12 }), [82, 84]),
    gear:[['medball', { at:'mid', r:5.2 }]], gearFront:true, track:'mid' },

  woodchop_cable: { view:'front', key:'end',
    scene:[['column', { x:106, top:8 }]],
    start:handsAt(F({ pin:['lA', [44, 104.3]], lth:14, lsh:6, rth:14, rsh:6, lean:6 }), [88, 30]),
    end:  handsAt(F({ pin:['lA', [44, 104.3]], lth:18, lsh:8, rth:18, rsh:8, lean:-8 }), [34, 88]),
    gear:[['cable', { from:[102, 14], to:'mid' }]], track:'mid' },

  band_woodchop: { view:'front', key:'end',
    scene:[['wall', { x:104, top:6 }], ['anchor', { at:[102, 18] }]],
    start:handsAt(F({ pin:['lA', [44, 104.3]], lth:14, lsh:6, rth:14, rsh:6, lean:6 }), [88, 30]),
    end:  handsAt(F({ pin:['lA', [44, 104.3]], lth:18, lsh:8, rth:18, rsh:8, lean:-8 }), [34, 88]),
    gear:[['band', { from:[102, 18], to:'mid', bowY:2 }]], track:'mid' },

  pallof_press: { view:'side', both:true, key:'end',
    scene:[['column', { x:18, top:40 }]],
    start:sideHands(S({ nth:8, nsh:-10, fth:14, fsh:-6 }), [66, 52], [65, 53], 1),
    end:  sideHands(S({ nth:8, nsh:-10, fth:14, fsh:-6 }), [84, 52], [83, 53], 1),
    gear:[['cable', { from:[22, 50], to:'nW' }]], track:'nW' },

  side_bend: { view:'front', both:true,
    start:F({ lean:0, ra:2, rfa:0, la:150, lfa:-130 }),
    end:  F({ lean:18, ra:2, rfa:0, la:150, lfa:-130 }),
    gear:[['dbFace', { at:'rW', r:4.2 }]], track:'head' },

  /* ---- full-body and conditioning ---- */
  mountain_climber: { view:'side', both:true,
    start:climber(true),
    end:  climber(false),
    track:'nK' },

  turkish_getup: { view:'side', key:'end',
    start:planted(supine({ trunk:-90, neck:-94, nua:180, nfa:180, fua:90, ffa:90, fth:90, fsh:90, fft:170 }), [88, 104.3], null),
    end:  planted(sideHands(supine({ trunk:-150, neck:-156, nua:180, nfa:180, fth:90, fsh:90, fft:170 }), null, [36, G - 2.7], 1), [88, 104.3], null),
    gear:[['kettlebell', { at:'nW', inverted:true }]], track:'head' },

  med_ball_slam: { view:'side', key:'end',
    start:athletic({ pin:['hip', [58, 67]], trunk:178, neck:180, nua:176, nfa:178, fua:172, ffa:176 }),
    end:  sideHands(athletic({ pin:['hip', [50, 80]], trunk:122, neck:134 }), [82, G - 12], [81, G - 11]),
    gear:[['medball', { at:'nW', dy:5, r:6 }]], track:'nW' },

  med_ball_rotational_throw: { view:'front', key:'end',
    start:handsAt(F({ pin:['lA', [40, 104.3]], lth:12, lsh:6, rth:12, rsh:6, lean:4 }), [78, 72]),
    end:  handsAt(F({ pin:['lA', [40, 104.3]], lth:12, lsh:6, rth:12, rsh:6, lean:-6 }), [30, 56]),
    gear:[['medball', { at:'mid', r:5.6 }]], track:'mid' },

  battle_rope_slam: { view:'side', key:'end',
    start:athletic({ trunk:164, neck:170, nua:150, nfa:160, fua:146, ffa:156 }),
    end:  athletic({ pin:['hip', [54, 76]], trunk:136, neck:148, nua:40, nfa:30, fua:36, ffa:26 }),
    gear:[['rope', { from:'nW', to:[110, G - 2], amp:3, steps:6 }]], track:'nW' },

  battle_rope_wave: { view:'side', both:true,
    start:athletic({ pin:['hip', [54, 76]], trunk:150, neck:162, nua:70, nfa:110, fua:36, ffa:56 }),
    end:  athletic({ pin:['hip', [54, 76]], trunk:150, neck:162, nua:36, nfa:56, fua:70, ffa:110 }),
    gear:[['rope', { from:'nW', to:[110, G - 2], amp:4.5, steps:8 }]], track:'nW' },

  sled_push: { view:'side',
    scene:[['sled', { x:SLED_X }]],
    end:sideHands(planted({ pin:['hip', [44, 72]], trunk:128, neck:112 }, [58, 96], [26, 104.3]), [SLED_X + 1, G - 27], [SLED_X + 2, G - 26], 1),
    front:[['travel', { from:[48, 40], to:[80, 40] }]] },

  sled_pull: { view:'side',
    scene:[['sled', { x:SLED_X }]],
    end:sideHands(planted({ pin:['hip', [48, 70]], trunk:-164, neck:-174 }, [30, 104.3], [56, 104.5]), [70, 74], [69, 75], 1),
    gear:[['strap', { from:[SLED_X + 3, G - 7], to:'nW' }]],
    front:[['travel', { from:[70, 30], to:[38, 30] }]] }
  });
  })(EXV);

  return EXV_DEFS;
}

var EXERCISE_VISUAL_BY_NAME = {
  /* Aliases that share a canonical id for history but are drawn as what they are. */
  'pendlay row':'pendlay_row',
  't-bar row':'tbar_row', 't bar row':'tbar_row',
  'glute bridge':'glute_bridge',
  'seated calf raise':'calf_raise_seated',
  'hanging leg raise':'hanging_leg_raise',
  'walking lunge':'lunge_walking',
  'kettlebell goblet squat':'squat_goblet_kb',
  'reverse pec deck':'reverse_pec_deck', 'machine rear delt':'reverse_pec_deck',

  /* Uncatalogued names LOOP prescribes. */
  'ab crunch machine':'machine_crunch', 'machine crunch':'machine_crunch',
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
  'hip abduction machine':'hip_abduction',
  'hip thrust machine':'hip_thrust_machine',
  'hollow body hold':'hollow_hold',
  'incline machine press':'incline_machine_press',
  'incline push-up':'pushup_incline',
  'kb row':'kb_row', 'single-arm kb row':'kb_row',
  'kettlebell push press':'kb_push_press',
  'kettlebell swing':'kb_swing',
  'lateral bound':'lateral_bound',
  'leg raise machine':'leg_raise_machine',
  'machine curl':'machine_curl',
  'machine shoulder press':'machine_shoulder_press',
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
  'reverse pec deck fly':'reverse_pec_deck',
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
  machine_curl:['Arms flat on the pad, elbows on the pivot', 'Curl through the full range', 'Control the return'],
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
  dip:['Start tall with locked arms', 'Lower until the upper arm is level', 'Press back up, shoulders down'],
  dip_weighted:['Belt load hangs still between the legs', 'Lower until the upper arm is level', 'Press up without swinging'],
  bench_dip:['Hands on the bench edge, hips close', 'Bend the elbows straight back', 'Press up to straight arms'],
  bench_press_close_grip:['Hands shoulder-width, elbows tucked', 'Lower to the lower chest', 'Press up over the shoulders'],

  /* chest and shoulders */
  bench_press_barbell:['Feet planted, shoulder blades pinned', 'Lower to the mid chest', 'Press up and slightly back'],
  bench_press_smith:['Set the bench so the bar meets mid chest', 'Lower under control', 'Press to straight arms'],
  bench_press_db:['Dumbbells over the chest, feet planted', 'Lower to chest level', 'Press up and together'],
  bench_press_incline_bb:['Bench at 30–45°, blades pinned', 'Lower to the upper chest', 'Press straight up'],
  incline_press_db:['Bench at 30–45°, weights at chest', 'Lower with elbows under wrists', 'Press up over the chest'],
  db_floor_press:['Lie on the floor, knees bent', 'Lower until the elbows touch', 'Press straight up'],
  chest_press_machine:['Handles at mid-chest height', 'Press forward to straight arms', 'Return slowly, chest up'],
  incline_machine_press:['Back on the pad, handles at upper chest', 'Press up and forward', 'Control the return'],
  machine_shoulder_press:['Handles at shoulder height', 'Press overhead to straight arms', 'Lower under control'],
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
  hip_abduction:['Sit tall, pads outside the knees', 'Push the knees apart', 'Return slowly'],
  band_lateral_walk:['Band above the knees, hips back', 'Step sideways', 'Keep tension on the band'],

  /* core and conditioning */
  plank:['Elbows under the shoulders', 'Body in one straight line', 'Brace and breathe'],
  weighted_plank:['Plate across the upper back', 'Body in one straight line', 'Hold without sagging'],
  side_plank:['Elbow under the shoulder', 'Lift the hips into a line', 'Hold, hips stacked'],
  side_plank_reach:['Hold a side plank', 'Reach up, then thread under', 'Keep the hips lifted'],
  hollow_hold:['Lower back pressed to the floor', 'Lift the shoulders and legs', 'Hold without arching'],
  crunch:['Knees bent, feet flat', 'Curl the shoulders up', 'Lower slowly'],
  machine_crunch:['Pads on the chest', 'Curl the torso forward', 'Return with control'],
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
