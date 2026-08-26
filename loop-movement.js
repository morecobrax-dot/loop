/* LOOP movement demonstration engine v2 — animated SVG, no video/GIF.
   Architecture: movement id → pose keyframes (joint positions) → shared FK renderer.
   Poses are authored as joint positions; at load they are converted to per-bone
   polar params (angle + length from parent) so tweens travel in arcs, never chords.
   v2 additions: procedural orbit motion (true arm circles), per-movement easing,
   front-view limb unification (left/right arms render identically — no arbitrary
   depth), wall panels, front-layer props with grip points.
   Exposed as <loop-move movement="hip_flexor_stretch"> and window.LoopMovement.
   Design-phase library only — LOOP production data is untouched. */
(function(){
'use strict';
var NS='http://www.w3.org/2000/svg';
var ACCENT='#5B8CFF';
var C={
  nearCore:'#3B4451', nearEdge:'#525E71',
  farCore:'#262C36',  farEdge:'#39414D',
  torsoCore:'#333C48',torsoEdge:'#4A5566',
  ground:'#262B33', prop:'#2A3039', link:'#4D5868'
};
var W={torso:17,torsoF:21,neck:8,head:9.5,thigh:11,shin:9,uArm:9,fArm:7.5,foot:6,edge:2.6};

var CATEGORIES={
  dynamic_mobility:{label:'Dynamic mobility', color:'#5B8CFF'},
  activation:{label:'Activation', color:'#4B9C81'},
  movement_prep:{label:'Movement prep', color:'#BD9260'},
  static_stretch:{label:'Stretch', color:'#8579B0'},
  decompression:{label:'Decompression', color:'#8579B0'}
};

/* ---------- movement registry v2 ----------
   pose keys: pelvis,mid,chest,head; nK/nA/nT near knee/ankle/toe; fK/fA/fT far leg;
   nE/nW near elbow/wrist; fE/fW far arm; optional nSh/fSh/nHip/fHip anchors.
   Per movement: id, name, short, tag, area, cat, pattern, equip, role,
   duration|reps, instruction (primary cue), cue2 (advanced, internal), purpose, why.
   Removed in v2 (replaced by standing, gym-friendly alternatives):
   open_book → reach_rotate · thread_needle → band_passthrough · cat_cow →
   standing_cat_cow · march_in_place → quad_stretch (promoted to warm-up) ·
   dead_bug → hip_hinge · glute_figure4 → standing_figure4 · chest_doorway →
   chest_opener. */
var MOVEMENTS=[

/* ============ WARM-UP · DYNAMIC MOBILITY ============ */
{ id:'world_greatest', name:'Deep Lunge with Rotation', short:"World's Greatest",
  tag:'FULL BODY', area:'full_body', cat:'dynamic_mobility', pattern:'lunge_rotation', equip:'none',
  role:'warmup', duration:45,
  instruction:'Deep lunge, hand inside the foot, rotate the top arm to the ceiling. Both sides.',
  cue2:'Drive the back leg long and rotate from the upper back, not the low back.',
  purpose:'Cover hips, trunk and shoulders in one movement.',
  why:'Most ground covered per second of any warm-up movement.',
  frames:[
   {m:1.6,h:0.6,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:1.7,h:0.7,p:{pelvis:[102,128],mid:[116,126],chest:[130,122],head:[143,119],
     nK:[133,138],nA:[134,168],nT:[146,169],fK:[74,145],fA:[48,167],fT:[38,172],
     nE:[137,144],nW:[140,168],fE:[127,148],fW:[124,170]}},
   {m:1.5,h:1.8,p:{pelvis:[102,127],mid:[116,124],chest:[130,118],head:[141,109],
     nK:[133,138],nA:[134,168],nT:[146,169],fK:[74,144],fA:[48,167],fT:[38,172],
     nE:[133,96],nW:[136,75],fE:[127,146],fW:[124,170]}}],
  rest:2, hl:{seg:['pelvis'],off:[2,-4],r:26}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'arm_circles', name:'Arm Circles', short:'Arm Circles',
  tag:'SHOULDERS', area:'shoulders', cat:'dynamic_mobility', pattern:'circular', equip:'none',
  role:'warmup', duration:30, front:true,
  orbit:{rx:24,ry:32,period:1.7,a0:0},
  instruction:'Small circles forward, then larger. Reverse halfway through.',
  cue2:'Let the circle come from the shoulder blade, not just the arm.',
  purpose:'Wake up the shoulders through a full circle.',
  why:'Simplest possible shoulder ramp — zero setup, zero skill.',
  frames:[
   {m:1.0,h:0,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[150,74],nW:[164,74],fE:[90,74],fW:[76,74]}}],
  rest:0, hl:{seg:['nSh','fSh'],k:0.5,off:[0,-2],r:24} },

{ id:'band_passthrough', name:'Band Pass-Through', short:'Pass-Through',
  tag:'SHOULDERS', area:'shoulders', cat:'dynamic_mobility', pattern:'overhead', equip:'band',
  role:'warmup', reps:8, duration:40, ease:'sine', links:[{a:'nW',b:'fW'}], grips:['nW','fW'],
  instruction:'Hold a band wide. Sweep it overhead and behind, then back. Arms long.',
  cue2:'Widen the grip until the arc is shrug-free, then narrow over time.',
  purpose:'Open the shoulders through a full overhead arc.',
  why:'One band covers the whole shoulder arc — the standing replacement for floor thoracic work.',
  frames:[
   {m:1.4,h:0.5,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[124,92],nW:[130,112],fE:[118,94],fW:[124,114]}},
   {m:1.4,h:0.1,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[122,44],nW:[126,22],fE:[116,46],fW:[120,24]}},
   {m:1.4,h:0.5,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[102,90],nW:[94,108],fE:[96,92],fW:[88,110]}},
   {m:1.4,h:0.1,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[122,44],nW:[126,22],fE:[116,46],fW:[120,24]}}],
  rest:0, hl:{seg:['nSh'],off:[-6,0],r:19}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'reach_rotate', name:'Standing Reach & Rotate', short:'Reach & Rotate',
  tag:'THORACIC', area:'thoracic_spine', cat:'dynamic_mobility', pattern:'rotation', equip:'none',
  role:'warmup', duration:40,
  instruction:'Arms forward. Sweep one arm open behind you and follow it with your eyes. Both sides.',
  cue2:'Rotate from the ribcage; the hips stay square.',
  purpose:'Rotate the upper back without going to the floor.',
  why:'Standing replacement for Open Book — same rotation, usable in any gym corner.',
  frames:[
   {m:1.3,h:0.3,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[132,70],nW:[152,70],fE:[128,72],fW:[148,72]}},
   {m:1.6,h:1.0,p:{pelvis:[112,104],mid:[112,85],chest:[110,66],head:[110,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[96,66],nW:[78,70],fE:[126,72],fW:[146,72]}}],
  rest:1, hl:{seg:['mid','chest'],k:0.6,off:[0,-4],r:18}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'leg_swing_front', name:'Front Leg Swing', short:'Leg Swing F/B',
  tag:'HIPS', area:'hips', cat:'dynamic_mobility', pattern:'hinge', equip:'none',
  role:'warmup', duration:30, ease:'sine', props:[{t:'v',x:162,y1:62,y2:174}], grips:['nW'],
  instruction:'Hold something steady. Swing one leg forward and back, then switch.',
  cue2:'Swing from the hip with a quiet torso — no lumbar whip.',
  purpose:'Get the hips moving before lower-body training.',
  why:'Dynamic hip range both directions in one drill.',
  frames:[
   {m:0.8,h:0.05,p:{pelvis:[110,104],mid:[111,85],chest:[112,66],head:[114,48],
     nK:[96,132],nA:[86,160],nT:[97,165],fK:[108,137],fA:[107,168],fT:[119,170],
     nE:[136,72],nW:[161,76],fE:[106,90],fW:[104,112]}},
   {m:0.6,h:0,p:{pelvis:[110,104],mid:[111,85],chest:[112,66],head:[114,48],
     nK:[114,136],nA:[112,166],nT:[123,168],fK:[108,137],fA:[107,168],fT:[119,170],
     nE:[136,72],nW:[161,76],fE:[106,90],fW:[104,112]}},
   {m:0.8,h:0.05,p:{pelvis:[110,104],mid:[111,85],chest:[112,66],head:[114,48],
     nK:[136,124],nA:[158,148],nT:[169,141],fK:[108,137],fA:[107,168],fT:[119,170],
     nE:[136,72],nW:[161,76],fE:[106,90],fW:[104,112]}},
   {m:0.6,h:0,p:{pelvis:[110,104],mid:[111,85],chest:[112,66],head:[114,48],
     nK:[114,136],nA:[112,166],nT:[123,168],fK:[108,137],fA:[107,168],fT:[119,170],
     nE:[136,72],nW:[161,76],fE:[106,90],fW:[104,112]}}],
  rest:2, hl:{seg:['nHip'],off:[4,4],r:20}, tr:[['nHip','nK']] },

{ id:'leg_swing_side', name:'Side Leg Swing', short:'Leg Swing Side',
  tag:'HIPS', area:'hips', cat:'dynamic_mobility', pattern:'abduction', equip:'none',
  role:'warmup', duration:30, front:true, ease:'sine',
  instruction:'Swing one leg across the body and out to the side. Then switch.',
  cue2:'Keep the pelvis level; the leg swings under a still torso.',
  purpose:'Open the hips side to side before squats and lunges.',
  why:'Covers the frontal plane nothing else in the library touches.',
  frames:[
   {m:0.9,h:0.05,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[112,138],nA:[102,164],nT:[100,172],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[138,92],nW:[130,104],fE:[102,92],fW:[110,104]}},
   {m:0.7,h:0,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[130,140],nA:[131,167],nT:[133,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[138,92],nW:[130,104],fE:[102,92],fW:[110,104]}},
   {m:0.9,h:0.05,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[148,134],nA:[162,158],nT:[166,166],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[138,92],nW:[130,104],fE:[102,92],fW:[110,104]}},
   {m:0.7,h:0,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[130,140],nA:[131,167],nT:[133,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[138,92],nW:[130,104],fE:[102,92],fW:[110,104]}}],
  rest:2, hl:{seg:['nHip'],off:[2,2],r:18}, tr:[['nHip','nK']] },

{ id:'hip_9090', name:'90/90 Hip Switch', short:'90/90 Switch',
  tag:'HIPS', area:'hips', cat:'dynamic_mobility', pattern:'rotation', equip:'none',
  role:'warmup', duration:40, front:true, shadow:{rx:58}, breath:0.4,
  instruction:'Seated, knees bent. Drop both knees to one side, then the other.',
  cue2:'Lead with the knees and keep the chest tall through the switch.',
  purpose:'Rotate the hips through both internal and external range.',
  why:'Trains hip rotation no swing or squat covers; floor time is brief.',
  frames:[
   {m:1.4,h:1.2,p:{pelvis:[122,158],mid:[120,140],chest:[118,122],head:[117,102],
     nSh:[131,124],fSh:[105,124],nHip:[130,158],fHip:[114,158],
     nK:[152,163],nA:[172,172],nT:[180,169],fK:[138,167],fA:[116,173],fT:[108,170],
     nE:[138,146],nW:[146,168],fE:[98,148],fW:[90,168]}},
   {m:1.2,h:0.1,p:{pelvis:[120,158],mid:[117,141],chest:[114,125],head:[112,106],
     nSh:[127,127],fSh:[101,127],nHip:[128,158],fHip:[112,158],
     nK:[134,130],nA:[142,162],nT:[146,170],fK:[106,130],fA:[98,162],fT:[94,170],
     nE:[138,148],nW:[146,168],fE:[98,150],fW:[90,168]}},
   {m:1.4,h:1.2,p:{pelvis:[118,158],mid:[120,140],chest:[122,122],head:[123,102],
     nSh:[135,124],fSh:[109,124],nHip:[126,158],fHip:[110,158],
     nK:[100,167],nA:[122,173],nT:[130,170],fK:[86,163],fA:[64,172],fT:[56,169],
     nE:[140,146],nW:[146,168],fE:[100,148],fW:[90,168]}},
   {m:1.2,h:0.1,p:{pelvis:[120,158],mid:[117,141],chest:[114,125],head:[112,106],
     nSh:[127,127],fSh:[101,127],nHip:[128,158],fHip:[112,158],
     nK:[134,130],nA:[142,162],nT:[146,170],fK:[106,130],fA:[98,162],fT:[94,170],
     nE:[138,148],nW:[146,168],fE:[98,150],fW:[90,168]}}],
  rest:0, hl:{seg:['pelvis'],off:[0,-2],r:22} },

{ id:'thoracic_rotation', name:'Thoracic Rotation', short:'Thoracic',
  tag:'THORACIC', area:'thoracic_spine', cat:'dynamic_mobility', pattern:'rotation', equip:'none',
  role:'warmup', duration:40, breath:0.5,
  instruction:'On all fours, hand behind the head. Rotate the elbow up and open. Both sides.',
  cue2:'Ribs stay down; rotate through the upper back, not the neck.',
  purpose:'Free up upper-back rotation.',
  why:'LOOP production staple; pairs with heavy pressing and pulling days.',
  frames:[
   {m:1.5,h:0.7,p:{pelvis:[92,134],mid:[112,127],chest:[131,125],head:[146,116],
     nK:[94,166],nA:[63,168],nT:[52,170],fK:[90,167],fA:[59,169],fT:[48,171],
     nE:[118,139],nW:[136,122],fE:[132,148],fW:[133,170]}},
   {m:1.6,h:1.1,p:{pelvis:[92,134],mid:[112,123],chest:[133,120],head:[150,107],
     nK:[94,166],nA:[63,168],nT:[52,170],fK:[90,167],fA:[59,169],fT:[48,171],
     nE:[126,97],nW:[138,110],fE:[132,148],fW:[133,170]}}],
  rest:1, hl:{seg:['mid','chest'],k:0.5,off:[0,-5],r:18}, tr:[['mid','chest']] },

{ id:'standing_cat_cow', name:'Standing Cat-Cow', short:'Standing Cat-Cow',
  tag:'SPINE', area:'spine', cat:'dynamic_mobility', pattern:'flexion_extension', equip:'none',
  role:'warmup', duration:30, ease:'sine',
  instruction:'Hands on your thighs. Round your back, then arch it. Slow and controlled.',
  cue2:'Push the thighs away to round; lift the chest to arch.',
  purpose:'Take the spine through flexion and extension without kneeling.',
  why:'Standing replacement for Cat-Cow — same spine cycle, no floor.',
  frames:[
   {m:1.7,h:0.8,p:{pelvis:[104,110],mid:[113,90],chest:[126,91],head:[135,97],
     nK:[114,140],nA:[112,168],nT:[124,170],fK:[110,141],fA:[108,168],fT:[120,170],
     nE:[124,110],nW:[117,128],fE:[120,112],fW:[113,130]}},
   {m:1.7,h:0.8,p:{pelvis:[104,110],mid:[119,104],chest:[131,88],head:[144,79],
     nK:[114,140],nA:[112,168],nT:[124,170],fK:[110,141],fA:[108,168],fT:[120,170],
     nE:[124,110],nW:[117,128],fE:[120,112],fW:[113,130]}}],
  rest:1, hl:{seg:['mid'],off:[0,-4],r:22}, tr:[['pelvis','mid'],['mid','chest']] },

{ id:'wall_slide', name:'Wall Slide', short:'Wall Slide',
  tag:'SHOULDERS', area:'shoulders', cat:'dynamic_mobility', pattern:'vertical_push', equip:'none',
  role:'warmup', reps:10, duration:30, front:true,
  props:[{t:'panel',x:66,y:16,w:108,h:160}],
  instruction:'Back to a wall, forearms flat. Slide the arms overhead and back down.',
  cue2:'Keep the ribs down — reach without arching off the wall.',
  purpose:'Open up the overhead position before pressing.',
  why:'Overhead prep with built-in feedback from the wall.',
  frames:[
   {m:1.2,h:0.5,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[152,74],nW:[152,50],fE:[88,74],fW:[88,50]}},
   {m:1.3,h:0.8,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[149,54],nW:[160,32],fE:[91,54],fW:[80,32]}}],
  rest:1, hl:{seg:['nSh','fSh'],k:0.5,off:[0,-4],r:20}, tr:[['nSh','nE'],['nE','nW'],['fSh','fE'],['fE','fW']] },

{ id:'ankle_rock', name:'Ankle Rock', short:'Ankle Rock',
  tag:'ANKLES', area:'ankles', cat:'dynamic_mobility', pattern:'dorsiflexion', equip:'none',
  role:'warmup', duration:30,
  instruction:'Half-kneeling, front foot flat. Rock the knee forward over the toes. Both sides.',
  cue2:'Heel stays glued down — the knee travels over the little toe.',
  purpose:'Prepare the ankles for squat depth.',
  why:'The one drill that directly buys squat depth for most people.',
  frames:[
   {m:1.0,h:0.4,p:{pelvis:[114,138],mid:[114,119],chest:[115,100],head:[117,81],
     nK:[145,140],nA:[147,169],nT:[159,170],fK:[106,166],fA:[75,168],fT:[64,166],
     nE:[130,120],nW:[142,138],fE:[124,122],fW:[136,140]}},
   {m:1.1,h:0.7,p:{pelvis:[122,141],mid:[121,122],chest:[121,103],head:[122,84],
     nK:[155,139],nA:[147,169],nT:[159,170],fK:[106,166],fA:[75,168],fT:[64,166],
     nE:[135,121],nW:[150,137],fE:[128,124],fW:[143,140]}}],
  rest:1, hl:{seg:['nA'],off:[0,-4],r:14}, tr:[['nK','nA']] },

{ id:'hamstring_sweep', name:'Hamstring Sweep', short:'Ham Sweep',
  tag:'HAMSTRINGS', area:'hamstrings', cat:'dynamic_mobility', pattern:'hinge', equip:'none',
  role:'warmup', duration:30, ease:'sine',
  instruction:'Heel out, toes up. Sweep the hands down the leg and stand tall again.',
  cue2:'Hinge at the hips with a long spine — the stretch moves, never holds.',
  purpose:'Wake the hamstrings up without a long static hold.',
  why:'The dynamic counterpart to the cooldown hamstring stretch.',
  frames:[
   {m:1.3,h:0.2,p:{pelvis:[112,108],mid:[115,90],chest:[118,72],head:[122,55],
     nK:[132,134],nA:[140,168],nT:[150,160],fK:[116,140],fA:[112,169],fT:[124,171],
     nE:[140,78],nW:[160,86],fE:[135,80],fW:[155,88]}},
   {m:1.4,h:0.4,p:{pelvis:[108,114],mid:[119,100],chest:[131,88],head:[143,80],
     nK:[132,134],nA:[140,168],nT:[150,160],fK:[114,144],fA:[112,169],fT:[124,171],
     nE:[139,108],nW:[142,129],fE:[134,110],fW:[137,131]}}],
  rest:1, hl:{seg:['nHip','nK'],k:0.55,off:[-3,8],r:20}, tr:[['nHip','nK'],['nK','nA']] },

{ id:'deep_squat_hold', name:'Deep Squat Hold', short:'Deep Squat',
  tag:'HIPS', area:'hips', cat:'dynamic_mobility', pattern:'squat', equip:'none',
  role:'both', duration:40, breath:0.6,
  instruction:'Sink into a full squat, heels down, and breathe. Gently shift if it helps.',
  cue2:'Use the elbows to nudge the knees out; keep the chest easy.',
  purpose:'Let the hips and ankles settle into the bottom position.',
  why:'One position covers hips, ankles and low back at once.',
  frames:[
   {m:1.4,h:0.8,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:1.6,h:4.4,p:{pelvis:[100,142],mid:[106,124],chest:[114,108],head:[124,96],
     nK:[133,148],nA:[122,170],nT:[134,172],fK:[131,147],fA:[115,169],fT:[130,171],
     nE:[136,114],nW:[157,112],fE:[131,116],fW:[152,114]}}],
  rest:1, hl:{seg:['pelvis'],off:[2,-2],r:22} },

/* ============ WARM-UP · ACTIVATION ============ */
{ id:'band_pull_apart', name:'Band Pull-Apart', short:'Pull-Apart',
  tag:'UPPER BACK', area:'upper_back', cat:'activation', pattern:'horizontal_pull', equip:'band',
  role:'warmup', reps:12, duration:30, front:true, links:[{a:'nW',b:'fW',layer:'front',slack:50}], grips:['nW','fW'],
  instruction:'Arms long at chest height. Pull the band apart to the chest, return slowly.',
  cue2:'Maintain scapular control without shrugging toward the ears.',
  purpose:'Switch on the upper back before pressing or pulling.',
  why:'Highest-value upper-back activation; one light band, ten seconds of setup.',
  frames:[
   {m:1.0,h:0.5,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[136,80],nW:[142,84],fE:[104,80],fW:[98,84]}},
   {m:1.1,h:0.9,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[157,75],nW:[180,75],fE:[83,75],fW:[60,75]}}],
  rest:1, hl:{seg:['nSh','fSh'],k:0.5,off:[0,-2],r:20} },

{ id:'face_pull_light', name:'Light Face Pull', short:'Face Pull',
  tag:'REAR SHOULDERS', area:'rear_delts', cat:'activation', pattern:'horizontal_pull', equip:'cable_or_band',
  role:'warmup', reps:12, duration:30,
  props:[{t:'v',x:182,y1:56,y2:84}], links:[{p:[182,70],b:'nW',layer:'front'}], grips:['nW','fW'],
  instruction:'Pull to the forehead, elbows high. Keep it light.',
  cue2:'Lead with the elbows and let the hands rotate back at the end.',
  purpose:'Prepare the rear shoulders and upper back.',
  why:'Balances pressing days; teaches the elbows-high pattern lifters need.',
  frames:[
   {m:1.0,h:0.4,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[115,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[110,137],fA:[109,168],fT:[121,170],
     nE:[137,70],nW:[158,72],fE:[135,74],fW:[156,76]}},
   {m:1.1,h:0.9,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[115,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[110,137],fA:[109,168],fT:[121,170],
     nE:[140,64],nW:[124,54],fE:[138,68],fW:[122,58]}}],
  rest:1, hl:{seg:['nSh'],off:[-6,2],r:17}, tr:[['nSh','nE']] },

{ id:'scap_pushup', name:'Scap Push-Up', short:'Scap Push-Up',
  tag:'SHOULDERS', area:'shoulders', cat:'activation', pattern:'horizontal_push', equip:'none',
  role:'warmup', reps:8, duration:30, breath:0.4,
  instruction:'Push-up position, arms locked. Pinch the shoulder blades, then push them apart.',
  cue2:'Elbows never bend — all the movement is between the shoulder blades.',
  purpose:'Prepare the shoulder blades to move under load.',
  why:'Teaches scapular control every press and row builds on.',
  frames:[
   {m:1.1,h:0.5,p:{pelvis:[102,132],mid:[120,126],chest:[138,117],head:[152,109],
     nK:[74,146],nA:[46,158],nT:[40,169],fK:[70,148],fA:[42,160],fT:[36,171],
     nE:[139,144],nW:[140,168],fE:[133,145],fW:[134,169]}},
   {m:1.1,h:0.6,p:{pelvis:[102,134],mid:[120,130],chest:[138,126],head:[152,119],
     nK:[74,148],nA:[46,160],nT:[40,171],fK:[70,150],fA:[42,162],fT:[36,173],
     nE:[139,147],nW:[140,168],fE:[133,148],fW:[134,169]}}],
  rest:0, hl:{seg:['chest'],off:[-4,-6],r:16}, tr:[['mid','chest']] },

{ id:'glute_bridge', name:'Glute Bridge', short:'Glute Bridge',
  tag:'GLUTES', area:'glutes', cat:'activation', pattern:'hinge', equip:'none',
  role:'warmup', reps:10, duration:30, shadow:{cx:'mid',rx:62}, breath:0.4,
  instruction:'On your back, feet flat. Drive through the heels and squeeze the hips up.',
  cue2:'Finish with the ribs down — a straight line, not an arched back.',
  purpose:'Switch on the glutes before squats, hinges and lunges.',
  why:'The default glute activation; scales from beginner to loaded hip thrust.',
  frames:[
   {m:1.0,h:0.5,p:{pelvis:[114,162],mid:[95,161],chest:[76,160],head:[58,157],
     nK:[138,138],nA:[152,166],nT:[164,167],fK:[134,140],fA:[148,168],fT:[160,169],
     nE:[96,167],nW:[118,169],fE:[94,168],fW:[116,170]}},
   {m:1.2,h:1.2,p:{pelvis:[114,138],mid:[95,148],chest:[77,157],head:[58,157],
     nK:[144,136],nA:[152,166],nT:[164,167],fK:[140,138],fA:[148,168],fT:[160,169],
     nE:[96,167],nW:[118,169],fE:[94,168],fW:[116,170]}}],
  rest:1, hl:{seg:['pelvis'],off:[-4,4],r:20}, tr:[['pelvis','mid']] },

{ id:'bird_dog', name:'Bird Dog', short:'Bird Dog',
  tag:'CORE', area:'core', cat:'activation', pattern:'anti_rotation', equip:'none',
  role:'warmup', reps:6, duration:40, breath:0.4,
  instruction:'On all fours. Reach one arm forward and the opposite leg back. Both sides.',
  cue2:'Imagine a glass of water on the low back — nothing spills.',
  purpose:'Brace the trunk while the limbs move.',
  why:'Core activation that rehearses staying stiff under moving load.',
  frames:[
   {m:1.1,h:0.4,p:{pelvis:[102,134],mid:[122,127],chest:[140,125],head:[155,116],
     nK:[104,166],nA:[73,168],nT:[62,170],fK:[100,167],fA:[69,169],fT:[58,171],
     nE:[143,148],nW:[144,170],fE:[137,149],fW:[138,171]}},
   {m:1.3,h:1.3,p:{pelvis:[102,134],mid:[122,127],chest:[140,125],head:[155,116],
     nK:[104,166],nA:[73,168],nT:[62,170],fK:[74,132],fA:[45,130],fT:[35,133],
     nE:[162,118],nW:[184,116],fE:[137,149],fW:[138,171]}},
   {m:1.1,h:0.4,p:{pelvis:[102,134],mid:[122,127],chest:[140,125],head:[155,116],
     nK:[104,166],nA:[73,168],nT:[62,170],fK:[100,167],fA:[69,169],fT:[58,171],
     nE:[143,148],nW:[144,170],fE:[137,149],fW:[138,171]}},
   {m:1.3,h:1.3,p:{pelvis:[102,134],mid:[122,127],chest:[140,125],head:[155,116],
     nK:[74,131],nA:[45,129],nT:[35,132],fK:[100,167],fA:[69,169],fT:[58,171],
     nE:[143,148],nW:[144,170],fE:[160,120],fW:[182,118]}}],
  rest:1, hl:{seg:['mid'],off:[0,-4],r:20} },

{ id:'calf_raise', name:'Calf Raise', short:'Calf Raise',
  tag:'CALVES', area:'calves', cat:'activation', pattern:'plantarflexion', equip:'none',
  role:'warmup', reps:12, duration:30,
  instruction:'Rise tall onto the balls of the feet, pause, lower with control.',
  cue2:'Full range both ways — slow down through the bottom.',
  purpose:'Prepare the calves and ankles for jumping, running and squatting.',
  why:'Simple ankle stiffness prep; pairs with ankle rocks for full coverage.',
  frames:[
   {m:0.9,h:0.4,p:{pelvis:[112,102],mid:[113,83],chest:[114,64],head:[116,46],
     nK:[114,135],nA:[113,166],nT:[125,169],fK:[110,135],fA:[109,166],fT:[121,169],
     nE:[118,88],nW:[120,110],fE:[112,88],fW:[114,110]}},
   {m:1.0,h:0.8,p:{pelvis:[112,95],mid:[113,76],chest:[114,57],head:[116,39],
     nK:[115,128],nA:[114,159],nT:[125,168],fK:[111,128],fA:[110,159],fT:[121,168],
     nE:[118,81],nW:[120,103],fE:[112,81],fW:[114,103]}}],
  rest:1, hl:{seg:['nK','nA'],k:0.5,off:[-6,0],r:15}, tr:[['nK','nA']] },

/* ============ WARM-UP · MOVEMENT PREP ============ */
{ id:'push_up_slow', name:'Slow Push-Up', short:'Slow Push-Up',
  tag:'CHEST', area:'chest', cat:'movement_prep', pattern:'horizontal_push', equip:'none',
  role:'warmup', reps:5, duration:30, breath:0.4,
  instruction:'Slow push-up, chest to the floor, elbows about 45 degrees.',
  cue2:'Three seconds down, one second up — rehearsal, not a max set.',
  purpose:'Rehearse the pressing pattern before loading it.',
  why:'Greases the exact groove of bench and press days.',
  frames:[
   {m:1.6,h:0.7,p:{pelvis:[102,132],mid:[120,126],chest:[138,120],head:[152,112],
     nK:[74,146],nA:[46,158],nT:[40,169],fK:[70,148],fA:[42,160],fT:[36,171],
     nE:[139,145],nW:[140,168],fE:[133,146],fW:[134,169]}},
   {m:2.3,h:0.5,p:{pelvis:[102,150],mid:[120,146],chest:[138,142],head:[153,136],
     nK:[74,158],nA:[46,166],nT:[40,172],fK:[70,160],fA:[42,168],fT:[36,174],
     nE:[126,152],nW:[140,168],fE:[120,153],fW:[134,169]}}],
  rest:0, hl:{seg:['chest'],off:[2,8],r:18}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'bodyweight_squat', name:'Bodyweight Squat', short:'BW Squat',
  tag:'QUADS · HIPS', area:'quads', cat:'movement_prep', pattern:'squat', equip:'none',
  role:'warmup', reps:8, duration:30,
  instruction:'Full depth, controlled. Knees tracking over the toes.',
  cue2:'Sit between the hips; heels heavy the whole way.',
  purpose:'Rehearse the squat pattern before loading it.',
  why:'The direct rehearsal for every squat variation LOOP programs.',
  frames:[
   {m:1.2,h:0.5,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[120,137],nA:[121,168],nT:[133,170],fK:[116,137],fA:[114,168],fT:[126,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:1.4,h:0.8,p:{pelvis:[105,137],mid:[110,119],chest:[117,103],head:[125,93],
     nK:[133,144],nA:[121,168],nT:[133,170],fK:[128,146],fA:[114,168],fT:[126,170],
     nE:[138,109],nW:[158,103],fE:[133,111],fW:[153,105]}}],
  rest:1, hl:{seg:['nHip','nK'],k:0.5,off:[4,-2],r:20}, tr:[['nHip','nK']] },

{ id:'reverse_lunge', name:'Reverse Lunge', short:'Reverse Lunge',
  tag:'QUADS · GLUTES', area:'quads', cat:'movement_prep', pattern:'lunge', equip:'none',
  role:'warmup', reps:6, duration:30,
  instruction:'Step back into a lunge, knee toward the floor, and drive back up. Both sides.',
  cue2:'The front heel does the work; the back leg just kisses the floor.',
  purpose:'Rehearse single-leg control before lunges and split squats.',
  why:'Single-leg prep that needs one step of space, not a walking track.',
  frames:[
   {m:1.0,h:0.5,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[118,137],fA:[117,168],fT:[129,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:0.9,h:0.2,p:{pelvis:[106,110],mid:[108,91],chest:[110,72],head:[112,54],
     nK:[92,138],nA:[76,162],nT:[66,168],fK:[116,140],fA:[117,168],fT:[129,170],
     nE:[114,96],nW:[116,118],fE:[108,96],fW:[110,118]}},
   {m:1.1,h:0.8,p:{pelvis:[98,134],mid:[100,115],chest:[102,96],head:[104,77],
     nK:[82,160],nA:[58,167],nT:[48,171],fK:[116,142],fA:[117,168],fT:[129,170],
     nE:[106,119],nW:[108,140],fE:[100,119],fW:[102,140]}}],
  rest:2, hl:{seg:['fHip','fK'],k:0.4,off:[2,-4],r:20}, tr:[['fHip','fK']] },

{ id:'hip_hinge', name:'Hip Hinge', short:'Hip Hinge',
  tag:'POSTERIOR CHAIN', area:'hamstrings', cat:'movement_prep', pattern:'hinge', equip:'none',
  role:'warmup', reps:8, duration:30,
  instruction:'Hands behind your head. Push the hips back with a flat back, then stand tall.',
  cue2:'Shins stay vertical; the torso is one long lever.',
  purpose:'Rehearse the hinge before deadlifts and rows.',
  why:'New in v2 — the one pattern rehearsal the library was missing.',
  frames:[
   {m:1.4,h:0.5,p:{pelvis:[110,104],mid:[111,85],chest:[112,66],head:[114,48],
     nK:[113,137],nA:[112,168],nT:[124,170],fK:[109,137],fA:[108,168],fT:[120,170],
     nE:[128,60],nW:[120,50],fE:[126,62],fW:[118,52]}},
   {m:1.5,h:0.9,p:{pelvis:[98,112],mid:[112,98],chest:[125,88],head:[137,81],
     nK:[108,140],nA:[112,168],nT:[124,170],fK:[104,141],fA:[108,168],fT:[120,170],
     nE:[148,88],nW:[131,83],fE:[146,90],fW:[129,85]}}],
  rest:1, hl:{seg:['nHip','nK'],k:0.45,off:[-3,4],r:18}, tr:[['pelvis','mid'],['mid','chest']] },

/* ============ COOLDOWN · STRETCHES ============ */
{ id:'hip_flexor_stretch', name:'Hip-Flexor Stretch', short:'Hip Flexor',
  tag:'HIP FLEXORS', area:'hip_flexors', cat:'static_stretch', pattern:'lunge', equip:'none',
  role:'cooldown', duration:30,
  instruction:'Half-kneeling, tuck the hips under, ease forward. Both sides.',
  cue2:'Squeeze the trailing glute — the stretch should stay out of the low back.',
  purpose:'Ease the front of the hip after leg day or long sitting.',
  why:'Counterpoint to squats, lunges and desk hours alike. Quality reference for the library.',
  frames:[
   {m:1.3,h:0.8,p:{pelvis:[114,136],mid:[114,117],chest:[115,98],head:[117,79],
     nK:[147,136],nA:[149,167],nT:[161,168],fK:[106,166],fA:[75,168],fT:[64,166],
     nE:[131,119],nW:[142,138],fE:[124,121],fW:[136,140]}},
   {m:1.7,h:2.6,p:{pelvis:[124,140],mid:[122,121],chest:[121,102],head:[122,83],
     nK:[157,137],nA:[149,167],nT:[161,168],fK:[106,166],fA:[75,168],fT:[64,166],
     nE:[136,123],nW:[150,139],fE:[129,125],fW:[143,141]}}],
  rest:1, hl:{seg:['fHip','fK'],k:0.3,off:[7,-2],r:22}, tr:[['fHip','fK']] },

{ id:'hamstring_stretch', name:'Hamstring Stretch', short:'Hamstring',
  tag:'HAMSTRINGS', area:'hamstrings', cat:'static_stretch', pattern:'hinge', equip:'none',
  role:'cooldown', duration:30,
  instruction:'One heel forward, hips back, flat back. Both sides.',
  cue2:'Tilt the pelvis forward instead of rounding toward the toes.',
  purpose:'Ease the back of the thigh after hinging and running.',
  why:'The standard posterior-chain cooldown; zero equipment.',
  frames:[
   {m:1.5,h:0.6,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:1.5,h:0.3,p:{pelvis:[104,112],mid:[118,100],chest:[130,90],head:[142,83],
     nK:[128,140],nA:[140,168],nT:[151,159],fK:[112,142],fA:[110,168],fT:[122,170],
     nE:[128,108],nW:[114,126],fE:[124,110],fW:[110,128]}},
   {m:1.2,h:2.6,p:{pelvis:[101,115],mid:[116,103],chest:[129,93],head:[141,86],
     nK:[128,140],nA:[140,168],nT:[151,159],fK:[112,142],fA:[110,168],fT:[122,170],
     nE:[126,110],nW:[112,128],fE:[122,112],fW:[108,130]}}],
  rest:2, hl:{seg:['nHip','nK'],k:0.55,off:[-2,7],r:20}, tr:[['nHip','nK'],['nK','nA']] },

{ id:'quad_stretch', name:'Quad Stretch', short:'Quad',
  tag:'QUADS', area:'quads', cat:'static_stretch', pattern:'knee_flexion', equip:'none',
  role:'both', duration:30, props:[{t:'v',x:160,y1:64,y2:174}], grips:['fW','nW'],
  instruction:'Heel to the glute, knees together. Hold something for balance. Both sides.',
  cue2:'Tuck the hips under slightly to bring the stretch up the thigh.',
  purpose:'Ease the front of the thigh after squats and lunges.',
  why:'Fastest quad release; promoted to warm-up rotation in v2 (replacing March in Place).',
  frames:[
   {m:1.3,h:0.4,p:{pelvis:[116,104],mid:[116,85],chest:[116,66],head:[118,48],
     nK:[119,136],nA:[118,167],nT:[130,169],fK:[115,137],fA:[114,168],fT:[126,170],
     nE:[122,90],nW:[124,112],fE:[136,76],fW:[160,70]}},
   {m:1.1,h:0.2,p:{pelvis:[116,104],mid:[116,85],chest:[116,66],head:[118,48],
     nK:[117,138],nA:[104,150],nT:[98,159],fK:[115,137],fA:[114,168],fT:[126,170],
     nE:[106,108],nW:[103,148],fE:[136,76],fW:[160,70]}},
   {m:1.2,h:2.6,p:{pelvis:[116,104],mid:[116,85],chest:[116,66],head:[118,48],
     nK:[114,138],nA:[101,110],nT:[96,120],fK:[115,137],fA:[114,168],fT:[126,170],
     nE:[107,88],nW:[100,108],fE:[136,76],fW:[160,70]}}],
  rest:2, hl:{seg:['nHip','nK'],k:0.5,off:[8,0],r:20}, tr:[['nHip','nK']] },

{ id:'calf_stretch', name:'Calf Stretch', short:'Calf',
  tag:'CALVES', area:'calves', cat:'static_stretch', pattern:'dorsiflexion', equip:'wall',
  role:'cooldown', duration:30, props:[{t:'v',x:179,y1:44,y2:174}], grips:['nW','fW'],
  instruction:'Hands on a wall, back leg straight, heel down. Both sides.',
  cue2:'Then soften the back knee slightly to move the stretch lower.',
  purpose:'Ease the calves after running, jumping or calf work.',
  why:'Wall version is stable and discreet — works anywhere.',
  frames:[
   {m:1.3,h:0.9,p:{pelvis:[112,106],mid:[122,90],chest:[133,76],head:[145,68],
     nK:[103,137],nA:[94,167],nT:[106,170],fK:[130,133],fA:[133,166],fT:[145,168],
     nE:[156,81],nW:[179,84],fE:[154,86],fW:[178,90]}},
   {m:1.6,h:2.6,p:{pelvis:[118,108],mid:[128,92],chest:[139,78],head:[151,70],
     nK:[106,139],nA:[94,167],nT:[106,170],fK:[136,134],fA:[137,166],fT:[149,168],
     nE:[160,84],nW:[179,86],fE:[158,89],fW:[178,92]}}],
  rest:1, hl:{seg:['nK','nA'],k:0.45,off:[-6,0],r:16}, tr:[['nK','nA']] },

{ id:'standing_figure4', name:'Standing Figure-4', short:'Standing Fig-4',
  tag:'GLUTES', area:'glutes', cat:'static_stretch', pattern:'hip_rotation', equip:'none',
  role:'both', duration:30, props:[{t:'v',x:160,y1:60,y2:174}], grips:['nW'],
  instruction:'Ankle over the opposite knee, hold support, sit back gently. Both sides.',
  cue2:'Sit down and back; keep the crossed foot flexed.',
  purpose:'Reach the deep glutes without lying down.',
  why:'Standing replacement for the Figure-4 — same target, works anywhere, doubles as balance work.',
  frames:[
   {m:1.3,h:0.4,p:{pelvis:[112,104],mid:[112,85],chest:[112,66],head:[114,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[134,80],nW:[160,88],fE:[110,90],fW:[112,112]}},
   {m:1.2,h:0.3,p:{pelvis:[108,108],mid:[108,89],chest:[109,70],head:[112,52],
     nK:[134,130],nA:[116,139],nT:[108,142],fK:[112,140],fA:[110,168],fT:[122,170],
     nE:[132,82],nW:[160,89],fE:[110,94],fW:[116,116]}},
   {m:1.3,h:2.4,p:{pelvis:[102,120],mid:[105,102],chest:[110,85],head:[118,70],
     nK:[132,138],nA:[114,148],nT:[106,151],fK:[114,146],fA:[110,168],fT:[122,170],
     nE:[134,86],nW:[160,92],fE:[114,106],fW:[124,140]}}],
  rest:2, hl:{seg:['nHip'],off:[-2,2],r:18}, tr:[['nHip','nK']] },

{ id:'shoulder_cross_body', name:'Cross-Body Shoulder Stretch', short:'Cross-Body',
  tag:'SHOULDERS', area:'shoulders', cat:'static_stretch', pattern:'adduction', equip:'none',
  role:'cooldown', duration:30, front:true,
  instruction:'Pull one arm across the chest with the other. Both sides.',
  cue2:'Keep the stretched shoulder down away from the ear.',
  purpose:'Ease the back of the shoulder after pressing days.',
  why:'The simplest shoulder release — instantly recognisable.',
  frames:[
   {m:1.3,h:0.4,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[140,92],nW:[142,110],fE:[100,92],fW:[98,110]}},
   {m:1.3,h:0.3,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,49],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[126,82],nW:[102,80],fE:[94,90],fW:[113,83]}},
   {m:1.1,h:2.6,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[118,50],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[122,83],nW:[96,82],fE:[92,92],fW:[108,85]}}],
  rest:2, hl:{seg:['nSh'],off:[-2,0],r:17}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'triceps_overhead', name:'Overhead Triceps Stretch', short:'Triceps',
  tag:'TRICEPS', area:'triceps', cat:'static_stretch', pattern:'overhead', equip:'none',
  role:'cooldown', duration:30, front:true,
  instruction:'Elbow up and bent, hand behind the head. Ease it back. Both sides.',
  cue2:'Ribs stay down as the elbow drifts back.',
  purpose:'Ease the triceps and lats after pressing.',
  why:'Standing, subtle, and hits two pressing muscles at once.',
  frames:[
   {m:1.3,h:0.4,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,50],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[140,92],nW:[142,110],fE:[100,92],fW:[98,110]}},
   {m:1.4,h:0.4,p:{pelvis:[120,108],mid:[120,90],chest:[120,72],head:[120,50],
     nSh:[134,74],fSh:[106,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[136,38],nW:[112,35],fE:[96,88],fW:[106,106]}},
   {m:1.1,h:2.6,p:{pelvis:[120,108],mid:[120,90],chest:[119,72],head:[119,51],
     nSh:[133,74],fSh:[105,74],nHip:[128,109],fHip:[112,109],
     nK:[129,140],nA:[130,167],nT:[132,174],fK:[111,140],fA:[110,167],fT:[108,174],
     nE:[132,36],nW:[108,34],fE:[95,88],fW:[105,106]}}],
  rest:2, hl:{seg:['nSh','nE'],k:0.55,off:[5,0],r:16}, tr:[['nSh','nE']] },

{ id:'chest_opener', name:'Chest Opener', short:'Chest Opener',
  tag:'CHEST', area:'chest', cat:'static_stretch', pattern:'shoulder_extension', equip:'none',
  role:'cooldown', duration:30,
  instruction:'Clasp your hands behind your back, straighten the arms, lift the chest.',
  cue2:'Lift the hands away from the hips without arching the low back.',
  purpose:'Open the chest and front shoulders after pressing.',
  why:'Standing replacement for the doorway stretch — no setup, instantly readable.',
  frames:[
   {m:1.4,h:0.4,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[118,90],nW:[120,112],fE:[112,90],fW:[114,112]}},
   {m:1.3,h:0.3,p:{pelvis:[112,104],mid:[113,85],chest:[114,66],head:[116,48],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[104,96],nW:[96,112],fE:[102,98],fW:[94,114]}},
   {m:1.3,h:2.6,p:{pelvis:[112,104],mid:[112,84],chest:[117,64],head:[120,45],
     nK:[115,137],nA:[114,168],nT:[126,170],fK:[111,137],fA:[110,168],fT:[122,170],
     nE:[100,90],nW:[90,100],fE:[98,92],fW:[88,102]}}],
  rest:2, hl:{seg:['chest'],off:[7,2],r:17}, tr:[['nSh','nE'],['nE','nW']] },

{ id:'lat_stretch', name:'Lat Stretch', short:'Lat',
  tag:'LATS', area:'lats', cat:'static_stretch', pattern:'overhead', equip:'rack',
  role:'cooldown', duration:30, props:[{t:'v',x:170,y1:78,y2:174}], grips:['nW','fW'],
  instruction:'Hold a rack at hip height, hips back, let the chest drop. Both sides.',
  cue2:'Sit the hips further back rather than pulling with the arms.',
  purpose:'Lengthen the lats after pulling days.',
  why:'Uses equipment every gym has; strong stretch with zero skill.',
  frames:[
   {m:1.4,h:0.8,p:{pelvis:[92,108],mid:[109,99],chest:[126,93],head:[140,99],
     nK:[97,140],nA:[99,170],nT:[111,171],fK:[93,141],fA:[95,170],fT:[107,171],
     nE:[147,100],nW:[170,104],fE:[146,104],fW:[170,108]}},
   {m:1.7,h:2.8,p:{pelvis:[84,112],mid:[102,104],chest:[120,99],head:[133,107],
     nK:[92,142],nA:[99,170],nT:[111,171],fK:[88,143],fA:[95,170],fT:[107,171],
     nE:[145,103],nW:[170,104],fE:[144,107],fW:[170,108]}}],
  rest:1, hl:{seg:['mid','chest'],k:0.6,off:[0,8],r:18}, tr:[['mid','chest']] },

{ id:'dead_hang', name:'Dead Hang', short:'Dead Hang',
  tag:'LATS', area:'lats', cat:'static_stretch', pattern:'vertical_pull', equip:'bar',
  role:'both', duration:30, front:true, props:[{t:'h',y:24,x1:84,x2:156}], grips:['nW','fW'], shadow:{rx:26},
  instruction:'Hang from the bar, shoulders relaxed, then pull them down and hold.',
  cue2:'Alternate: relax fully, then actively pull the shoulder blades down.',
  purpose:'Decompress and open the lats and shoulders.',
  why:'One bar, ten seconds — grip, lats and shoulders in a single hang.',
  frames:[
   {m:1.2,h:1.0,p:{pelvis:[120,112],mid:[120,93],chest:[120,76],head:[120,56],
     nSh:[133,78],fSh:[107,78],nHip:[127,113],fHip:[113,113],
     nK:[125,142],nA:[123,163],nT:[127,168],fK:[115,142],fA:[113,163],fT:[117,168],
     nE:[135,51],nW:[136,24],fE:[105,51],fW:[104,24]}},
   {m:1.3,h:1.2,p:{pelvis:[120,105],mid:[120,86],chest:[120,69],head:[120,50],
     nSh:[133,71],fSh:[107,71],nHip:[127,106],fHip:[113,106],
     nK:[125,136],nA:[123,157],nT:[127,162],fK:[115,136],fA:[113,157],fT:[117,162],
     nE:[135,47],nW:[136,24],fE:[105,47],fW:[104,24]}}],
  rest:0, hl:{seg:['nSh','fSh'],k:0.5,off:[0,5],r:20}, tr:[['nSh','nE'],['fSh','fE']] },

{ id:'child_pose', name:'Child Pose', short:"Child's Pose",
  tag:'SPINE', area:'spine', cat:'decompression', pattern:'flexion', equip:'none',
  role:'cooldown', duration:45, breath:0.8, shadow:{cx:'mid',rx:60},
  instruction:'Knees wide, hips back to the heels, arms long. Breathe slowly.',
  cue2:'Let each exhale sink the hips a little further back.',
  purpose:'Decompress the spine and slow the breathing down.',
  why:'The classic session closer — signals "done" to the whole body.',
  frames:[
   {m:1.6,h:0.5,p:{pelvis:[88,134],mid:[106,128],chest:[124,124],head:[138,116],
     nK:[90,168],nA:[62,167],nT:[51,169],fK:[86,169],fA:[58,168],fT:[47,170],
     nE:[128,146],nW:[130,170],fE:[124,148],fW:[126,171]}},
   {m:1.8,h:0.6,p:{pelvis:[74,148],mid:[91,140],chest:[109,135],head:[125,140],
     nK:[94,168],nA:[64,167],nT:[53,169],fK:[90,169],fA:[60,168],fT:[49,170],
     nE:[128,158],nW:[149,169],fE:[124,160],fW:[146,170]}},
   {m:1.6,h:3.0,p:{pelvis:[70,153],mid:[86,146],chest:[104,142],head:[119,150],
     nK:[96,168],nA:[64,167],nT:[53,169],fK:[92,169],fA:[60,168],fT:[49,170],
     nE:[125,161],nW:[152,170],fE:[121,163],fW:[149,171]}}],
  rest:2, hl:{seg:['pelvis','mid'],k:0.5,off:[0,-7],r:20}, tr:[['pelvis','mid'],['mid','chest']] }
];

/* ---------- pose math ---------- */
function P(a){return {x:a[0],y:a[1]};}
function polar(from,to){var dx=to.x-from.x,dy=to.y-from.y;return {a:Math.atan2(dy,dx),l:Math.hypot(dx,dy)};}
function lerp(a,b,t){return a+(b-a)*t;}
function lerpAng(a,b,t){var d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return a+d*t;}
function fk(o,b){return {x:o.x+Math.cos(b.a)*b.l,y:o.y+Math.sin(b.a)*b.l};}
function easeCubic(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function easeSine(t){return 0.5-0.5*Math.cos(Math.PI*t);}

function derive(p){
  var pelvis=P(p.pelvis),mid=P(p.mid),chest=P(p.chest),head=P(p.head);
  var nSh=p.nSh?P(p.nSh):chest, fSh=p.fSh?P(p.fSh):chest;
  var nHip=p.nHip?P(p.nHip):pelvis, fHip=p.fHip?P(p.fHip):pelvis;
  function off(a,b){return {x:a.x-b.x,y:a.y-b.y};}
  return {
    root:pelvis,
    sp1:polar(pelvis,mid), sp2:polar(mid,chest), hd:polar(chest,head),
    oNSh:off(nSh,chest), oFSh:off(fSh,chest), oNHip:off(nHip,pelvis), oFHip:off(fHip,pelvis),
    nUA:polar(nSh,P(p.nE)), nFA:polar(P(p.nE),P(p.nW)),
    fUA:polar(fSh,P(p.fE)), fFA:polar(P(p.fE),P(p.fW)),
    nTh:polar(nHip,P(p.nK)), nSn:polar(P(p.nK),P(p.nA)), nFt:polar(P(p.nA),P(p.nT)),
    fTh:polar(fHip,P(p.fK)), fSn:polar(P(p.fK),P(p.fA)), fFt:polar(P(p.fA),P(p.fT))
  };
}
function mixBone(a,b,t){return {a:lerpAng(a.a,b.a,t),l:lerp(a.l,b.l,t)};}
function mixDerived(A,B,t){
  var o={root:{x:lerp(A.root.x,B.root.x,t),y:lerp(A.root.y,B.root.y,t)}};
  ['oNSh','oFSh','oNHip','oFHip'].forEach(function(k){o[k]={x:lerp(A[k].x,B[k].x,t),y:lerp(A[k].y,B[k].y,t)};});
  ['sp1','sp2','hd','nUA','nFA','fUA','fFA','nTh','nSn','nFt','fTh','fSn','fFt'].forEach(function(k){o[k]=mixBone(A[k],B[k],t);});
  return o;
}
function joints(d,breath){
  var J={};
  J.pelvis=d.root;
  J.mid=fk(J.pelvis,d.sp1); J.mid={x:J.mid.x,y:J.mid.y-breath*0.5};
  J.chest=fk(J.mid,d.sp2); J.chest={x:J.chest.x,y:J.chest.y-breath*0.5};
  J.head=fk(J.chest,d.hd); J.head={x:J.head.x,y:J.head.y-breath*0.3};
  J.nSh={x:J.chest.x+d.oNSh.x,y:J.chest.y+d.oNSh.y};
  J.fSh={x:J.chest.x+d.oFSh.x,y:J.chest.y+d.oFSh.y};
  J.nHip={x:J.pelvis.x+d.oNHip.x,y:J.pelvis.y+d.oNHip.y};
  J.fHip={x:J.pelvis.x+d.oFHip.x,y:J.pelvis.y+d.oFHip.y};
  J.nE=fk(J.nSh,d.nUA); J.nW=fk(J.nE,d.nFA);
  J.fE=fk(J.fSh,d.fUA); J.fW=fk(J.fE,d.fFA);
  J.nK=fk(J.nHip,d.nTh); J.nA=fk(J.nK,d.nSn); J.nT=fk(J.nA,d.nFt);
  J.fK=fk(J.fHip,d.fTh); J.fA=fk(J.fK,d.fSn); J.fT=fk(J.fA,d.fFt);
  return J;
}

/* ---------- renderer ---------- */
var UID=0;
function el(tag,attrs,parent){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function line(J,a,b){return 'M'+J[a].x.toFixed(1)+' '+J[a].y.toFixed(1)+'L'+J[b].x.toFixed(1)+' '+J[b].y.toFixed(1);}
function chain(J,keys){
  var d='M'+J[keys[0]].x.toFixed(1)+' '+J[keys[0]].y.toFixed(1);
  for(var i=1;i<keys.length;i++)d+='L'+J[keys[i]].x.toFixed(1)+' '+J[keys[i]].y.toFixed(1);
  return d;
}
function limb(svg,color,edge,w){
  var e=el('path',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round',stroke:edge,'stroke-width':w+W.edge},svg);
  var c=el('path',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round',stroke:color,'stroke-width':w},svg);
  return {set:function(d){e.setAttribute('d',d);c.setAttribute('d',d);}};
}

function Figure(host,mv,opts){
  var uid=++UID;
  var svg=el('svg',{viewBox:'30 10 180 178',width:'100%',height:'100%',role:'img',
    'aria-label':mv.name+' demonstration. '+mv.instruction,preserveAspectRatio:'xMidYMid meet'});
  svg.style.display='block';
  var defs=el('defs',{},svg);
  var g1=el('radialGradient',{id:'lmg'+uid},defs);
  el('stop',{offset:'0%','stop-color':ACCENT,'stop-opacity':'0.5'},g1);
  el('stop',{offset:'70%','stop-color':ACCENT,'stop-opacity':'0.12'},g1);
  el('stop',{offset:'100%','stop-color':ACCENT,'stop-opacity':'0'},g1);
  var g2=el('radialGradient',{id:'lms'+uid},defs);
  el('stop',{offset:'0%','stop-color':'#000','stop-opacity':'0.42'},g2);
  el('stop',{offset:'100%','stop-color':'#000','stop-opacity':'0'},g2);
  // wall panels behind everything
  (mv.props||[]).forEach(function(pr){
    if(pr.t==='panel')el('rect',{x:pr.x,y:pr.y,width:pr.w,height:pr.h,rx:3,fill:'#171C24',opacity:'0.55'},svg);
  });
  el('line',{x1:36,y1:176,x2:204,y2:176,stroke:C.ground,'stroke-width':2,'stroke-linecap':'round'},svg);
  (mv.props||[]).forEach(function(pr){
    if(pr.t==='v')el('line',{x1:pr.x,y1:pr.y1,x2:pr.x,y2:pr.y2,stroke:C.prop,'stroke-width':3.5,'stroke-linecap':'round'},svg);
    if(pr.t==='h')el('line',{x1:pr.x1,y1:pr.y,x2:pr.x2,y2:pr.y,stroke:C.prop,'stroke-width':3.5,'stroke-linecap':'round'},svg);
  });
  var shadow=el('ellipse',{cy:176,ry:5.5,fill:'url(#lms'+uid+')'},svg);
  var glow=el('ellipse',{fill:'url(#lmg'+uid+')'},svg);
  // dynamic links (band / cable) — layer:'front' draws over the figure
  var linkEls=(mv.links||[]).map(function(lk){return lk.layer==='front'?null:el('path',{fill:'none',stroke:C.link,'stroke-width':2.5,'stroke-linecap':'round',opacity:'0.9'},svg);});
  // far limbs: side views shade them back; front views render both sides identically
  var fCore=mv.front?C.nearCore:C.farCore, fEdge=mv.front?C.nearEdge:C.farEdge, fThin=mv.front?0:1;
  var farG=el('g',{opacity:mv.front?'1':'0.88'},svg);
  var fArm1=limb(farG,fCore,fEdge,W.uArm-fThin), fArm2=limb(farG,fCore,fEdge,W.fArm-fThin);
  var fLeg1=limb(farG,fCore,fEdge,W.thigh-fThin), fLeg2=limb(farG,fCore,fEdge,W.shin-fThin), fFoot=limb(farG,fCore,fEdge,W.foot);
  var tw=mv.front?W.torsoF:W.torso;
  var shBar=mv.front?limb(svg,C.torsoCore,C.torsoEdge,13):null;
  var hipBar=mv.front?limb(svg,C.torsoCore,C.torsoEdge,13):null;
  var torso=limb(svg,C.torsoCore,C.torsoEdge,tw);
  var neck=limb(svg,C.nearCore,C.nearEdge,W.neck);
  var headE=el('circle',{r:W.head,fill:C.nearCore,stroke:C.nearEdge,'stroke-width':1.6},svg);
  var nLeg1=limb(svg,C.nearCore,C.nearEdge,W.thigh), nLeg2=limb(svg,C.nearCore,C.nearEdge,W.shin), nFoot=limb(svg,C.nearCore,C.nearEdge,W.foot);
  var nArm1=limb(svg,C.nearCore,C.nearEdge,W.uArm), nArm2=limb(svg,C.nearCore,C.nearEdge,W.fArm);
  var trace=el('path',{fill:'none',stroke:ACCENT,'stroke-width':3.5,'stroke-linecap':'round','stroke-linejoin':'round',opacity:'0.38'},svg);
  (mv.links||[]).forEach(function(lk,i){if(lk.layer==='front')linkEls[i]=el('path',{fill:'none',stroke:C.link,'stroke-width':2.5,'stroke-linecap':'round',opacity:'0.95'},svg);});
  var gripEls=(mv.grips||[]).map(function(){return el('circle',{r:3.4,fill:C.nearEdge,stroke:C.nearCore,'stroke-width':1.2},svg);});
  host.appendChild(svg);

  var derived=mv.frames.map(function(f){return derive(f.p);});
  var cycle=mv.frames.reduce(function(s,f){return s+f.m+f.h;},0);
  var EASE=mv.ease==='sine'?easeSine:easeCubic;

  // procedural orbit (true circular limb paths, e.g. arm circles)
  function elbowP(sh,w,side){var vx=w.x-sh.x,vy=w.y-sh.y;return{x:sh.x+vx*0.52-vy*0.1*side,y:sh.y+vy*0.52+vx*0.1*side};}
  function applyOrbit(J,t){
    var o=mv.orbit, th=(o.a0||0)+t*Math.PI*2/o.period;
    var vx=Math.cos(th)*(o.rx||o.r), vy=Math.sin(th)*(o.ry||o.r);
    J.nW={x:J.nSh.x+vx,y:J.nSh.y+vy};
    J.fW={x:J.fSh.x-vx,y:J.fSh.y+vy};
    J.nE=elbowP(J.nSh,J.nW,1); J.fE=elbowP(J.fSh,J.fW,-1);
  }

  function draw(J,pulse){
    shadow.setAttribute('cx',(mv.shadow&&mv.shadow.cx==='mid'?J.mid.x:J.pelvis.x).toFixed(1));
    shadow.setAttribute('rx',(mv.shadow&&mv.shadow.rx)||44);
    (mv.links||[]).forEach(function(lk,i){
      var a=lk.p?{x:lk.p[0],y:lk.p[1]}:J[lk.a], b=J[lk.b];
      var d2='M'+a.x.toFixed(1)+' '+a.y.toFixed(1);
      if(lk.slack){var dist=Math.hypot(b.x-a.x,b.y-a.y),sag=Math.max(0,lk.slack-dist)*0.5;
        d2+='Q'+((a.x+b.x)/2).toFixed(1)+' '+((a.y+b.y)/2+sag).toFixed(1)+' '+b.x.toFixed(1)+' '+b.y.toFixed(1);}
      else d2+='L'+b.x.toFixed(1)+' '+b.y.toFixed(1);
      linkEls[i].setAttribute('d',d2);
    });
    fArm1.set(line(J,'fSh','fE')); fArm2.set(line(J,'fE','fW'));
    fLeg1.set(line(J,'fHip','fK')); fLeg2.set(line(J,'fK','fA')); fFoot.set(line(J,'fA','fT'));
    if(shBar)shBar.set(line(J,'nSh','fSh'));
    if(hipBar)hipBar.set(line(J,'nHip','fHip'));
    torso.set(chain(J,['pelvis','mid','chest']));
    neck.set(line(J,'chest','head'));
    headE.setAttribute('cx',J.head.x.toFixed(1)); headE.setAttribute('cy',J.head.y.toFixed(1));
    nLeg1.set(line(J,'nHip','nK')); nLeg2.set(line(J,'nK','nA')); nFoot.set(line(J,'nA','nT'));
    nArm1.set(line(J,'nSh','nE')); nArm2.set(line(J,'nE','nW'));
    (mv.grips||[]).forEach(function(g,i){gripEls[i].setAttribute('cx',J[g].x.toFixed(1));gripEls[i].setAttribute('cy',J[g].y.toFixed(1));});
    if(opts.highlight!==false&&mv.hl){
      var s=mv.hl.seg,a2=J[s[0]],b2=s[1]?J[s[1]]:a2,k=mv.hl.k==null?0:mv.hl.k;
      glow.setAttribute('cx',(lerp(a2.x,b2.x,k)+(mv.hl.off?mv.hl.off[0]:0)).toFixed(1));
      glow.setAttribute('cy',(lerp(a2.y,b2.y,k)+(mv.hl.off?mv.hl.off[1]:0)).toFixed(1));
      glow.setAttribute('rx',mv.hl.r); glow.setAttribute('ry',mv.hl.r*0.86);
      glow.setAttribute('opacity',(0.72+0.18*pulse).toFixed(2));
      if(mv.tr){trace.setAttribute('d',mv.tr.map(function(pr){return line(J,pr[0],pr[1]);}).join(''));trace.setAttribute('opacity',(0.3+0.12*pulse).toFixed(2));}
    }else{glow.setAttribute('opacity','0');trace.setAttribute('opacity','0');}
  }

  function poseAt(t){
    t=t%cycle; if(t<0)t+=cycle;
    var acc=0;
    for(var i=0;i<mv.frames.length;i++){
      var f=mv.frames[i], prev=derived[(i-1+derived.length)%derived.length];
      if(t<acc+f.m){var u=EASE((t-acc)/f.m);return mixDerived(prev,derived[i],u);}
      acc+=f.m;
      if(t<acc+f.h)return derived[i];
      acc+=f.h;
    }
    return derived[derived.length-1];
  }

  return {
    tick:function(time){
      var d=poseAt(time);
      var breath=(mv.breath==null?1:mv.breath)*Math.sin(time*1.5)*1.1;
      var J=joints(d,breath);
      if(mv.orbit)applyOrbit(J,time);
      draw(J,0.5+0.5*Math.sin(time*1.5));
    },
    renderStatic:function(){
      var idx=mv.rest==null?mv.frames.length-1:mv.rest;
      var J=joints(derived[idx],0);
      if(mv.orbit)applyOrbit(J,0);
      draw(J,0.4);
    },
    destroy:function(){if(svg.parentNode)svg.parentNode.removeChild(svg);}
  };
}

/* ---------- <loop-move> web component ---------- */
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
var LoopMove=function(){return Reflect.construct(HTMLElement,[],LoopMove);};
LoopMove.prototype=Object.create(HTMLElement.prototype);
LoopMove.observedAttributes=['movement','highlight','tempo','animate'];
LoopMove.prototype.connectedCallback=function(){
  this.style.display='block';
  if(!this.style.width)this.style.width='100%';
  if(!this.style.height)this.style.height='100%';
  this._build();
};
LoopMove.prototype.disconnectedCallback=function(){this._stop();};
LoopMove.prototype.attributeChangedCallback=function(){if(this.isConnected)this._build();};
LoopMove.prototype._stop=function(){if(this._raf)cancelAnimationFrame(this._raf);this._raf=null;};
LoopMove.prototype._build=function(){
  this._stop();
  if(this._fig)this._fig.destroy();
  var id=this.getAttribute('movement')||MOVEMENTS[0].id;
  var mv=MOVEMENTS.find(function(m){return m.id===id;})||MOVEMENTS[0];
  var self=this;
  this._fig=Figure(this,mv,{highlight:this.getAttribute('highlight')!=='off'});
  var noAnim=(reduced&&reduced.matches)||this.getAttribute('animate')==='off';
  if(noAnim){this._fig.renderStatic();return;}
  var tempo=parseFloat(this.getAttribute('tempo'))||1;
  var t=0,last=performance.now();
  function loop(now){
    var dt=Math.min(0.05,(now-last)/1000); last=now;
    t+=dt*tempo;
    self._fig.tick(t);
    self._raf=requestAnimationFrame(loop);
  }
  this._fig.tick(0);
  this._raf=requestAnimationFrame(loop);
};
if(!customElements.get('loop-move'))customElements.define('loop-move',LoopMove);
if(reduced&&reduced.addEventListener)reduced.addEventListener('change',function(){
  document.querySelectorAll('loop-move').forEach(function(n){n._build&&n._build();});
});

window.LoopMovement={
  MOVEMENTS:MOVEMENTS,
  CATEGORIES:CATEGORIES,
  get:function(id){return MOVEMENTS.find(function(m){return m.id===id;})||null;}
};
})();
