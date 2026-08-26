/* =========================================================
   LOOP — movement renderer sync
   ---------------------------------------------------------
   Copies loop-movement.js into the vendored region of
   index.html, between the LOOP-MOVEMENT-BEGIN / END markers.

   loop-movement.js is the source of truth. Edit it, then:

       node sync-movement.js

   The two copies exist because index.html is the whole app —
   a linked script would need its own service-worker cache
   entry to survive a gym with no signal, and the test harness
   only evaluates the largest inline <script> block, so a
   linked file would be invisible to every contract. A
   contract asserts the two stay byte-identical, so forgetting
   to run this fails the suite rather than shipping a renderer
   that disagrees with the review tool.

   This script only ever rewrites the region between the
   markers. It touches no other line of index.html.
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const APP = path.join(ROOT, 'index.html');
const LIB = path.join(ROOT, 'loop-movement.js');

const OPEN = 'LOOP-MOVEMENT-BEGIN */';
const CLOSE = '/* LOOP-MOVEMENT-END */';

const raw = fs.readFileSync(APP, 'utf8');
const hadCRLF = raw.indexOf('\r\n') !== -1;
const nl = String.fromCharCode(10);

let s = raw.split('\r\n').join(nl);
const lib = fs.readFileSync(LIB, 'utf8').split('\r\n').join(nl).trim();

const a = s.indexOf(OPEN);
const b = s.indexOf(CLOSE);
if (a === -1 || b === -1 || b < a) {
  console.error('markers not found in index.html — refusing to guess where the renderer goes');
  process.exit(1);
}

const before = s.slice(0, a + OPEN.length);
const after = s.slice(b);
const current = s.slice(a + OPEN.length, b).trim();

if (current === lib) {
  console.log('already in sync — index.html matches loop-movement.js');
  process.exit(0);
}

s = before + nl + lib + nl + after;
if (hadCRLF) s = s.split(nl).join('\r\n');
fs.writeFileSync(APP, s);

console.log('synced loop-movement.js -> index.html (' + lib.length + ' bytes)');
console.log('run `npm run verify` before committing');
