'use strict';
/* A Supabase-shaped PostgreSQL in PGlite (real Postgres, in WebAssembly): the
   anon / authenticated / service_role roles, an auth schema whose uid() reads
   the request's JWT claims the way Supabase's does, and Supabase's DEFAULT
   PRIVILEGES — which grant ALL on every new table and function to anon and
   authenticated, the holding this project's security review hinges on. Then the
   repo's migrations, verbatim.

   Needs PGlite, which the app itself never does:
       npm install --no-save @electric-sql/pglite                          */
const fs = require('fs');
const path = require('path');
let PGlite;
try{ ({ PGlite } = require('@electric-sql/pglite')); }
catch(e){
  console.error('This suite runs the migrations on a real PostgreSQL and needs PGlite:\n  npm install --no-save @electric-sql/pglite');
  process.exit(2);
}
const MIG = process.env.MIG_DIR || path.join(__dirname, '..', 'migrations');

const SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const ALL = () => fs.readdirSync(MIG).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();

async function makeDb(opts){
  const o = opts || {};
  const db = new PGlite();
  await db.exec(SHIM);
  const files = o.migrations || ALL();
  for(const f of files) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  if(o.twice) for(const f of files) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  return db;
}
const apply = (db, file) => db.exec(fs.readFileSync(path.join(MIG, file), 'utf8'));

/* Run fn as a role with a JWT subject, in a transaction that commits unless fn
   throws — the shape of one PostgREST request. */
let queue = Promise.resolve();
function as(db, role, uid, fn){
  const run = async () => {
    await db.exec('begin');
    try{
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role } : { role })]);
      await db.exec('set local role ' + role);
      const out = await fn({
        q: (sql, params) => db.query(sql, params || []),
        one: async (sql, params) => (await db.query(sql, params || [])).rows[0]
      });
      await db.exec('commit');
      return out;
    }catch(e){
      try{ await db.exec('rollback'); }catch(e2){}
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.then(() => {}, () => {});
  return p;
}

async function addUser(db, email, username){
  const u = (await db.query('insert into auth.users(email) values ($1) returning id', [email])).rows[0];
  if(username) await as(db, 'authenticated', u.id, ({ q }) =>
    q('insert into public.profiles(user_id, username, username_key) values ($1, $2, lower($2))', [u.id, username]));
  return u.id;
}

module.exports = { makeDb, apply, as, addUser, SHIM, MIG, ALL };
