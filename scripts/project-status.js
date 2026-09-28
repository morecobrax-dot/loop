'use strict';
/* =========================================================
   PROJECT STATUS CHECK — Mission Control status contract 1
   ---------------------------------------------------------
   One checker for every repository that publishes a
   PROJECT-STATUS.json for Mission Control. It is byte-identical
   in each of them and in Mission Control, whose contract 27
   proves it agrees with the reader (validateStatusFile) on every
   shared case below. Never edit a copy: change it in Mission
   Control, run its verify, then copy the file unchanged.

     node scripts/project-status.js verify     this repository's file
     node scripts/project-status.js self-test  the shared cases

   It only reads. It never rewrites a status, clears an attention
   flag or chooses a lifecycle value; a failure says what is wrong
   and what to do. It cannot tell whether the words are still true,
   or whether work exists that was never published: that review is
   the author's, at every milestone.

   CONTRACT 1 (the reader's rules, exactly)
     Every key present: schemaVersion (1), appId, version, phase,
     status, needsQa, needsDecision, currentTask, nextAction,
     blocker, updatedAt. status is planning | building |
     release_ready | stable | paused. needsQa and needsDecision are
     true or false. version, phase, currentTask, nextAction and
     blocker are text or null, at most 24, 48, 280, 200 and 200
     characters, with no control or direction-changing characters.
     updatedAt is ISO 8601 with a zone, no more than a day ahead.
     The file is at most 8 KB.

   A PUBLISHER ALSO MUST (stricter than the reader, never looser)
     - name this repository (appId from package.json projectStatus)
     - carry no key beyond the contract: the file is public
     - carry no private link, credential or local path (the rules
       of Mission Control's scripts/secrets.js, below)
     - keep `version` equal to this repository's release version

   VERSION POLICY
     `version` is the repository's canonical release version on the
     same commit: the newest entry of its own release notes, read
     from where package.json "projectStatus.version" points. It must
     change in the commit that changes the release version — which
     is when the rest of the status is due a review too — and at no
     other time. An equal version means only that the status talks
     about this release. It never means the release is deployed,
     that QA passed or that the project is stable: production
     verification belongs to the release workflow, and the rest of
     the file says what the author declares.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTRACT = 1;
const CHECKER_REVISION = 1;
const STATUS_FILE = 'PROJECT-STATUS.json';
const KEYS = ['schemaVersion', 'appId', 'version', 'phase', 'status', 'needsQa', 'needsDecision',
              'currentTask', 'nextAction', 'blocker', 'updatedAt'];
const STATUSES = ['planning', 'building', 'release_ready', 'stable', 'paused'];
const TEXT_LIMITS = { version: 24, phase: 48, currentTask: 280, nextAction: 200, blocker: 200 };
const MAX_BYTES = 8192;
const FUTURE_MS = 24 * 60 * 60 * 1000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/* Control characters and direction overrides, written as code points so
   the source never holds the characters it refuses. */
const BAD_TEXT = (() => {
  const bs = String.fromCharCode(92);
  const u = c => bs + 'u' + c.toString(16).toUpperCase().padStart(4, '0');
  const ranges = [[0x0, 0x8], [0xB, 0xC], [0xE, 0x1F], [0x7F, 0x7F], [0x202A, 0x202E], [0x2066, 0x2069]];
  return new RegExp('[' + ranges.map(r => r[0] === r[1] ? u(r[0]) : u(r[0]) + '-' + u(r[1])).join('') + ']');
})();

/* Mission Control's secret rules (scripts/secrets.js), copied by a script
   rather than by hand; contract 27 there proves they are the same rules. */
/* SECRET-RULES-BEGIN */
const SECRET_RULES = [
  { label: "ChatGPT conversation link", re: new RegExp("\\b(?:chatgpt\\.com|chat\\.openai\\.com)\\/(?:c|share|g\\/[A-Za-z0-9-]+\\/c)\\/[A-Za-z0-9_-]{6,}", "gi") },
  { label: "Claude session link", re: new RegExp("\\bclaude\\.ai\\/(?:code|chat|share|project)\\/(?!new\\b)[A-Za-z0-9_-]{6,}", "gi") },
  { label: "Claude app session link", re: new RegExp("\\bclaude:\\/\\/code\\/(?!new\\b)[A-Za-z0-9_-]{6,}", "gi") },
  { label: "Claude session id", re: new RegExp("\\b(?:session|cse)_[A-Za-z0-9]{12,}\\b", "g") },
  { label: "Anthropic API key", re: new RegExp("\\bsk-ant-[A-Za-z0-9_-]{16,}", "g") },
  { label: "OpenAI API key", re: new RegExp("\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}", "g") },
  { label: "GitHub token", re: new RegExp("\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\\bgithub_pat_[A-Za-z0-9_]{20,}", "g") },
  { label: "AWS access key", re: new RegExp("\\bAKIA[0-9A-Z]{16}\\b", "g") },
  { label: "Slack token", re: new RegExp("\\bxox[abprs]-[A-Za-z0-9-]{10,}", "g") },
  { label: "private key", re: new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----", "g") },
  { label: "bearer token", re: new RegExp("\\bBearer\\s+[A-Za-z0-9._~+/-]{20,}", "g") },
  { label: "local user path", re: new RegExp("\\b[A-Za-z]:[\\\\/](?:Users|Documents and Settings)[\\\\/][^\\\\/\\s'\"`<>]+|(?:^|[\\s'\"`(=])\\/(?:Users|home)\\/[A-Za-z0-9._-]+", "g") }
];
/* SECRET-RULES-END */

/* ---------- the check ---------- */
function problem(code, message){ return { code: code, message: message }; }

/* Every problem with one file's text, for one repository. `release` is the
   repository's canonical release version (null when it cannot be read). */
function checkStatus(text, opts){
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const out = [];
  if(typeof text !== 'string') return [problem('missing', 'There is no ' + STATUS_FILE + ' to check.')];
  if(Buffer.byteLength(text, 'utf8') > MAX_BYTES){
    return [problem('too-large', STATUS_FILE + ' is larger than ' + MAX_BYTES + ' bytes; Mission Control refuses it unread.')];
  }
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ return [problem('not-json', STATUS_FILE + ' is not valid JSON: ' + e.message)]; }
  if(!data || typeof data !== 'object' || Array.isArray(data)){
    return [problem('not-object', STATUS_FILE + ' must hold one JSON object.')];
  }
  if(data.schemaVersion !== CONTRACT){
    return [Number.isInteger(data.schemaVersion) && data.schemaVersion > CONTRACT
      ? problem('schema-unsupported', 'schemaVersion ' + data.schemaVersion + ' is newer than contract ' + CONTRACT +
          ', which Mission Control reads: it would refuse this file. Use schemaVersion 1.')
      : problem('schema-invalid', 'schemaVersion must be the number 1.')];
  }
  if(o.appId && data.appId !== o.appId){
    out.push(problem('wrong-app', 'appId is ' + JSON.stringify(data.appId) + ', but this repository publishes as ' +
      JSON.stringify(o.appId) + '. Mission Control would refuse it as another project\'s file.'));
  }
  const missing = KEYS.filter(k => !Object.prototype.hasOwnProperty.call(data, k));
  if(missing.length) out.push(problem('missing-key', 'Missing ' + missing.join(', ') + '. Every key must be present; use null for an unknown text field.'));
  const extra = Object.keys(data).filter(k => KEYS.indexOf(k) === -1);
  if(extra.length) out.push(problem('unknown-key', 'Not part of the contract: ' + extra.join(', ') + '. The file is public; remove them.'));
  if(Object.prototype.hasOwnProperty.call(data, 'status') && STATUSES.indexOf(data.status) === -1){
    out.push(problem('status', 'status must be one of ' + STATUSES.join(', ') + '. Blocked is not a status: write the reason in blocker.'));
  }
  ['needsQa', 'needsDecision'].forEach(k => {
    if(Object.prototype.hasOwnProperty.call(data, k) && typeof data[k] !== 'boolean') out.push(problem('boolean', k + ' must be true or false.'));
  });
  Object.keys(TEXT_LIMITS).forEach(k => {
    if(!Object.prototype.hasOwnProperty.call(data, k)) return;
    const v = data[k];
    if(v === null) return;
    if(typeof v !== 'string'){ out.push(problem('text-type', k + ' must be text or null.')); return; }
    if(BAD_TEXT.test(v)) out.push(problem('text-control', k + ' contains a control or direction-changing character.'));
    const len = v.replace(/\s+/g, ' ').trim().length;
    if(len > TEXT_LIMITS[k]) out.push(problem('text-length', k + ' is ' + len + ' characters; the limit is ' + TEXT_LIMITS[k] + '.'));
  });
  if(Object.prototype.hasOwnProperty.call(data, 'updatedAt')){
    const at = (typeof data.updatedAt === 'string' && ISO_TIME.test(data.updatedAt)) ? Date.parse(data.updatedAt) : NaN;
    if(isNaN(at)) out.push(problem('time-format', 'updatedAt must be an ISO 8601 date and time with a zone, e.g. 2026-09-28T17:30:00Z.'));
    else if(at - now > FUTURE_MS) out.push(problem('time-future', 'updatedAt is more than a day in the future; Mission Control would refuse it.'));
  }
  /* The version policy. A stale version is the failure this checker exists
     for, so it says exactly what to do. */
  if(o.release === null || o.release === undefined){
    out.push(problem('release-unknown', 'This repository\'s release version could not be read, so the version cannot be checked. Fix package.json "projectStatus.version".'));
  } else if(Object.prototype.hasOwnProperty.call(data, 'version') && data.version !== o.release){
    out.push(problem('stale-version', 'version is ' + JSON.stringify(data.version) + ', but this commit\'s release version is ' +
      JSON.stringify(o.release) + '. The status describes an older release. Review every field for ' + o.release +
      ' (status, needsQa, needsDecision, currentTask, nextAction, blocker, phase), set "version": ' + JSON.stringify(o.release) +
      ' and "updatedAt" to the time you reviewed it, and commit it with the release. This check never edits the file.'));
  }
  /* Anything private, in any value, by Mission Control's own rules. */
  const texts = [];
  Object.keys(data).forEach(k => { if(typeof data[k] === 'string') texts.push([k, data[k]]); });
  texts.forEach(t => {
    SECRET_RULES.forEach(r => {
      const re = new RegExp(r.re.source, r.re.flags.replace('g', ''));
      if(re.test(t[1])) out.push(problem('private', t[0] + ' holds a ' + r.label + '. The file is public: remove it.'));
    });
  });
  return out;
}

/* ---------- where the release version is declared ----------
   package.json "projectStatus": {
     "appId": "<the id Mission Control's registry uses>",
     "version": { "file": "index.html", "list": "<the line that opens the
       release-notes array>", "pick": "first" | "last", "prefix": "<text
       before the number, if the notes spell one>" } }
   The first (or last) `version: '…'` inside that array is the release. */
function releaseVersion(root, spec){
  if(!spec || typeof spec.file !== 'string' || typeof spec.list !== 'string' || /(^|[\\/])\.\.([\\/]|$)/.test(spec.file)){
    throw new Error('package.json "projectStatus.version" needs a file inside the repository and the list line to read.');
  }
  const text = fs.readFileSync(path.join(root, spec.file), 'utf8').split('\r\n').join('\n');
  const at = text.indexOf(spec.list);
  if(at === -1) throw new Error(spec.file + ' has no line ' + JSON.stringify(spec.list) + '.');
  const end = text.indexOf('\n];', at);
  const list = text.slice(at, end === -1 ? text.length : end);
  const found = [];
  const re = /(^|[^A-Za-z0-9_$])version:\s*'([^']*)'/g;
  let m;
  while((m = re.exec(list)) !== null) found.push(m[2]);
  if(!found.length) throw new Error('No version entry in ' + spec.file + ' after ' + JSON.stringify(spec.list) + '.');
  let v = spec.pick === 'last' ? found[found.length - 1] : found[0];
  if(spec.prefix){
    if(v.indexOf(spec.prefix) !== 0) throw new Error('The release version ' + JSON.stringify(v) + ' does not start with ' + JSON.stringify(spec.prefix) + '.');
    v = v.slice(spec.prefix.length);
  }
  return v;
}

/* ---------- the shared cases ----------
   The same cases run here and in Mission Control, where each is also read
   by the app itself: `reader` is what Mission Control does with the file,
   `publisher` is whether this check lets it be published. */
const CASE_NOW = Date.parse('2026-09-28T12:30:00Z');
const CASE_APP = 'fixture-app';
const CASE_RELEASE = '1.2.3';
function caseBase(){
  return { schemaVersion: 1, appId: CASE_APP, version: CASE_RELEASE, phase: 'Phase 2', status: 'building',
           needsQa: true, needsDecision: false, currentTask: 'Fixture work', nextAction: 'Fixture next step',
           blocker: null, updatedAt: '2026-09-28T12:00:00Z' };
}
const withField = over => JSON.stringify(Object.assign(caseBase(), over));
const withoutKey = key => { const b = caseBase(); delete b[key]; return JSON.stringify(b); };
const ch = code => String.fromCharCode(code);
const CASES = [
  { name: 'a complete, current status', reader: 'ok', publisher: 'pass', text: () => withField({}) },
  { name: 'an old status that is still current', reader: 'ok', publisher: 'pass', text: () => withField({ updatedAt: '2020-01-01T00:00:00Z' }) },
  { name: 'text exactly at its limit', reader: 'ok', publisher: 'pass', text: () => withField({ nextAction: 'x'.repeat(200) }) },
  { name: 'a stale version', reader: 'ok', publisher: 'stale-version', text: () => withField({ version: '1.2.2' }) },
  { name: 'no version although the repository declares one', reader: 'ok', publisher: 'stale-version', text: () => withField({ version: null }) },
  { name: 'another project\'s appId', reader: 'wrong-app', publisher: 'wrong-app', text: () => withField({ appId: 'other-app' }) },
  { name: 'a newer schema', reader: 'unsupported', publisher: 'schema-unsupported', text: () => withField({ schemaVersion: 2 }) },
  { name: 'a schema written as text', reader: 'invalid', publisher: 'schema-invalid', text: () => withField({ schemaVersion: '1' }) },
  { name: 'a missing key', reader: 'invalid', publisher: 'missing-key', text: () => withoutKey('phase') },
  { name: 'a key the contract does not have', reader: 'ok', publisher: 'unknown-key', text: () => withField({ note: 'x' }) },
  { name: 'blocked written as a status', reader: 'invalid', publisher: 'status', text: () => withField({ status: 'blocked' }) },
  { name: 'needsQa written as text', reader: 'invalid', publisher: 'boolean', text: () => withField({ needsQa: 'true' }) },
  { name: 'a number where text belongs', reader: 'invalid', publisher: 'text-type', text: () => withField({ phase: 2 }) },
  { name: 'text over its limit', reader: 'invalid', publisher: 'text-length', text: () => withField({ nextAction: 'x'.repeat(201) }) },
  { name: 'a control character', reader: 'invalid', publisher: 'text-control', text: () => withField({ currentTask: 'a' + ch(7) + 'b' }) },
  { name: 'a direction override', reader: 'invalid', publisher: 'text-control', text: () => withField({ blocker: 'a' + ch(0x202E) + 'b' }) },
  { name: 'a time with no zone', reader: 'invalid', publisher: 'time-format', text: () => withField({ updatedAt: '2026-09-28T12:00:00' }) },
  { name: 'a time that is not one', reader: 'invalid', publisher: 'time-format', text: () => withField({ updatedAt: '2026-13-45T99:00:00Z' }) },
  { name: 'a time more than a day ahead', reader: 'invalid', publisher: 'time-future', text: () => withField({ updatedAt: '2026-09-30T12:31:00Z' }) },
  { name: 'a list instead of a record', reader: 'invalid', publisher: 'not-object', text: () => '[' + withField({}) + ']' },
  { name: 'text that is not JSON', reader: 'invalid', publisher: 'not-json', text: () => '{"schemaVersion": 1,' },
  { name: 'a file over 8 KB', reader: 'too-large', publisher: 'too-large', text: () => withField({}) + ' '.repeat(MAX_BYTES) },
  /* Private values, assembled here so no whole one sits in this file. */
  { name: 'a ChatGPT conversation link', reader: 'ok', publisher: 'private',
    text: () => withField({ nextAction: 'See https://chatgpt.com/c/' + '6f3a9c2e-1b7d-4e55' }) },
  { name: 'a Claude session link', reader: 'ok', publisher: 'private',
    text: () => withField({ currentTask: 'claude.ai/code/' + 'sess' + 'ion_01AbCdEfGhIjKl' }) },
  { name: 'a local user path', reader: 'ok', publisher: 'private',
    text: () => withField({ currentTask: 'Build in C:' + ch(92) + 'Users' + ch(92) + 'someone' + ch(92) + 'app' }) },
  { name: 'an API key', reader: 'ok', publisher: 'private',
    text: () => withField({ blocker: 'key sk-ant-' + 'api03-AbCdEfGhIjKlMnOp' }) }
];

/* Each case, checked against this checker. Mission Control runs the same
   list against its reader as well. */
function runCases(){
  return CASES.map(c => {
    const found = checkStatus(c.text(), { appId: CASE_APP, release: CASE_RELEASE, now: CASE_NOW });
    const ok = c.publisher === 'pass' ? found.length === 0 : found.some(p => p.code === c.publisher);
    return { name: c.name, ok: ok, found: found.map(p => p.code) };
  });
}

/* This file's identity across repositories, independent of line endings. */
function checkerHash(){
  const text = fs.readFileSync(__filename, 'utf8').split('\r\n').join('\n');
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/* ---------- command line ---------- */
function verify(root){
  const bad = runCases().filter(r => !r.ok);
  if(bad.length){
    console.error('  FAILED — this checker disagrees with its own contract cases (' + bad.map(r => r.name).join('; ') + ').');
    console.error('  Do not edit it here: copy scripts/project-status.js from Mission Control unchanged.');
    return 1;
  }
  let cfg;
  try{ cfg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).projectStatus; }catch(e){ cfg = null; }
  if(!cfg || typeof cfg.appId !== 'string'){
    console.error('  FAILED — package.json has no "projectStatus" { appId, version } to check against.');
    return 1;
  }
  let text = null;
  try{ text = fs.readFileSync(path.join(root, STATUS_FILE), 'utf8'); }catch(e){ text = null; }
  let release = null, releaseError = null;
  try{ release = releaseVersion(root, cfg.version); }catch(e){ releaseError = e.message; }
  const found = checkStatus(text, { appId: cfg.appId, release: release });
  console.log('project status — ' + STATUS_FILE + ' for ' + cfg.appId + ' (contract ' + CONTRACT + ', checker ' +
              CHECKER_REVISION + ' · ' + checkerHash() + ')');
  if(releaseError) console.error('  ' + releaseError);
  if(found.length){
    console.error('\n  FAILED — ' + found.length + ' problem(s):\n');
    found.forEach(p => console.error('    [' + p.code + '] ' + p.message));
    console.error('\n  Mission Control reads this file from the default branch once it is pushed.');
    return 1;
  }
  console.log('  ok — contract ' + CONTRACT + ', version ' + release + ' matches ' + cfg.version.file + ', nothing private.');
  console.log('  This checks form and version only. Whether the status still tells the truth is the');
  console.log('  author\'s review: status, needsQa, needsDecision, currentTask, nextAction, blocker, phase.');
  return 0;
}

function selfTest(){
  const results = runCases();
  results.forEach(r => console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.ok ? '' : '  (found: ' + (r.found.join(', ') || 'nothing') + ')')));
  const failed = results.filter(r => !r.ok).length;
  console.log('\n  ' + (results.length - failed) + '/' + results.length + ' shared cases');
  return failed ? 1 : 0;
}

if(require.main === module){
  const mode = (process.argv[2] || 'verify').toLowerCase();
  const root = path.join(__dirname, '..');
  process.exit(mode === 'self-test' ? selfTest() : verify(root));
}

module.exports = { CONTRACT, CHECKER_REVISION, STATUS_FILE, KEYS, STATUSES, TEXT_LIMITS, MAX_BYTES, FUTURE_MS,
  ISO_TIME, BAD_TEXT, SECRET_RULES, CASES, CASE_NOW, CASE_APP, CASE_RELEASE,
  checkStatus, releaseVersion, runCases, checkerHash, verify };
