// People from a Triodian Start job (development plan task 5.6): the job file is read and checked, the people are
// added to the client's identity database with their roles, and a second run changes nothing. The identity database
// here is a real SQLite one with the suite's own tables, so the statements are the ones that run on D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readJob, peopleErrors, seedPeople, resultFor, JOB_FORMAT, RESULT_FORMAT } from '../tools/lib/people.mjs';
import { IDENTITY_SCHEMA, SUITE_APPS } from './fixtures/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export function sqliteQuery() {
  const db = new DatabaseSync(':memory:'); const writes = [];
  const q = async (sql, params = []) => { const st = db.prepare(sql); if (/^\s*SELECT/i.test(sql)) return st.all(...params); if (!/^\s*CREATE/i.test(sql)) writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); st.run(...params); return []; };
  return { db, q, writes };
}
const job = () => ({ format: JOB_FORMAT, requestId: 'P-1234abcd', code: 'quay', name: 'Quay Logistics', apps: 'board-direction,confidentiality', admin: 'Zed@Quay.example', jurisdiction: 'au', sector: '',
  runBy: { mode: 'self' }, approvedBy: 'admin@triodian.com', approvedAt: '2026-11-11T09:00:00Z',
  people: [
    { email: 'zed@quay.example', name: 'Zed', organisation: 'Quay Logistics', admin: true, apps: { 'board-direction': ['chair'], confidentiality: [] } },
    { email: 'Gia@Quay.example', name: 'Gia', organisation: 'Quay Logistics', admin: false, apps: { 'board-direction': ['gc'], confidentiality: ['gc', 'counsel'] } },
    { email: 'mo.owner@triodian.com', name: 'Mo Owner', organisation: 'Triodian', admin: false, apps: { 'board-direction': ['methodOwner'], confidentiality: ['methodOwner'] } },
  ] });
const APPS = ['board-direction', 'confidentiality'];

test('a job file is read into the provisioning inputs', () => {
  const j = readJob(job());
  assert.deepEqual({ code: j.code, name: j.name, apps: j.apps, admin: j.admin, jurisdiction: j.jurisdiction, requestId: j.requestId }, { code: 'quay', name: 'Quay Logistics', apps: 'board-direction,confidentiality', admin: 'zed@quay.example', jurisdiction: 'AU', requestId: 'P-1234abcd' });
  assert.equal(j.people[1].email, 'gia@quay.example', 'emails are lowercased');
  assert.deepEqual(j.people[0].apps, { 'board-direction': ['chair'], confidentiality: [] });
});

test('a file that is not a job, or a job with bad people, is refused with every problem named', () => {
  assert.throws(() => readJob({ format: 'something/else' }), /not a Triodian Start job file/);
  assert.throws(() => readJob(null), /not a Triodian Start job file/);
  const bad = job(); bad.people.push({ email: 'nope', apps: { 'board-direction': ['chair'] } }, { email: 'zed@quay.example', apps: { 'board-direction': ['chair'] } }, { email: 'x@quay.example', apps: {} }, { email: 'y@quay.example', apps: { 'board-direction': ['chair; DROP TABLE people'] } });
  delete bad.admin;
  assert.throws(() => readJob(bad), e => /no admin/.test(e.message) && /“nope”/.test(e.message) && /zed@quay.example is in the job file twice/.test(e.message) && /x@quay.example has no app/.test(e.message) && /y@quay.example: the roles/.test(e.message));
});

test('people are checked against the client\'s apps and the apps\' own role names before anything changes', () => {
  const people = readJob(job()).people;
  assert.deepEqual(peopleErrors(people, APPS, SUITE_APPS), []);
  assert.match(peopleErrors(people, ['board-direction'], SUITE_APPS)[0], /confidentiality, which is not one of this client's apps/);
  const odd = readJob(job()).people; odd[1].apps['board-direction'] = ['wizard'];
  assert.match(peopleErrors(odd, APPS, SUITE_APPS)[0], /gia@quay.example: board-direction has no role wizard/);
});

test('the people are added with their roles, the first administrator as administrator, and a second run changes nothing', async () => {
  const { db, q, writes } = sqliteQuery(), people = readJob(job()).people;
  const r = await seedPeople(q, people, { schema: IDENTITY_SCHEMA, now: '2026-11-11T10:00:00Z' });
  assert.equal(r.changed.length, 3 + 6, 'three people, six memberships');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 3);
  const m = (email, app) => db.prepare('SELECT m.roles, m.is_admin, m.active, m.local_id, p.id, p.name, p.organisation, m.created_by FROM memberships m JOIN people p ON p.id = m.person_id WHERE p.email = ? AND m.app = ?').get(email, app);
  assert.deepEqual({ ...m('gia@quay.example', 'confidentiality') }, { roles: 'gc,counsel', is_admin: 0, active: 1, local_id: m('gia@quay.example', 'board-direction').id, id: m('gia@quay.example', 'board-direction').id, name: 'Gia', organisation: 'Quay Logistics', created_by: 'provisioning' });
  assert.equal(m('zed@quay.example', 'board-direction').is_admin, 1); assert.equal(m('zed@quay.example', 'confidentiality').is_admin, 1);
  assert.equal(m('zed@quay.example', 'confidentiality').roles, '', 'the administrator is in every app, with or without a role');
  assert.equal(m('mo.owner@triodian.com', 'board-direction').is_admin, 0);
  assert.equal(m('zed@quay.example', 'board-direction').local_id, m('zed@quay.example', 'confidentiality').local_id, 'one id for a person across the apps');
  const before = writes.length;
  const again = await seedPeople(q, people, { schema: IDENTITY_SCHEMA });
  assert.deepEqual(again.changed, []); assert.equal(again.unchanged, 6); assert.equal(writes.length, before, 'no write on the second run');
});

test('it only adds: what an administrator changed in the apps is kept, and a later job adds what is missing', async () => {
  const { db, q } = sqliteQuery(), people = readJob(job()).people;
  await seedPeople(q, people, { schema: IDENTITY_SCHEMA });
  // In the app's Admin: Gia is renamed, gains a role and is switched off in one app; Mo is made an administrator.
  db.prepare("UPDATE people SET name = 'Gia Renamed' WHERE email = 'gia@quay.example'").run();
  db.prepare("UPDATE memberships SET roles = 'gc,director', active = 0 WHERE app = 'board-direction' AND person_id = (SELECT id FROM people WHERE email = 'gia@quay.example')").run();
  db.prepare("UPDATE memberships SET is_admin = 1 WHERE person_id = (SELECT id FROM people WHERE email = 'mo.owner@triodian.com')").run();
  const later = readJob(job()).people; later[1].apps['board-direction'] = ['gc', 'ceo']; later[2].admin = false;
  later.push({ email: 'new@quay.example', name: 'New', organisation: 'Quay Logistics', admin: false, apps: { 'board-direction': ['director'] } });
  const r = await seedPeople(q, later, { schema: IDENTITY_SCHEMA });
  assert.deepEqual(r.changed, ['gia@quay.example in board-direction: added ceo', 'new@quay.example added', 'new@quay.example joined board-direction as director']);
  const gia = db.prepare("SELECT m.roles, m.active, p.name FROM memberships m JOIN people p ON p.id = m.person_id WHERE p.email = 'gia@quay.example' AND m.app = 'board-direction'").get();
  assert.deepEqual({ ...gia }, { roles: 'gc,director,ceo', active: 0, name: 'Gia Renamed' }, 'kept her name, her extra role and her switched-off state');
  assert.equal(db.prepare("SELECT MIN(is_admin) AS a FROM memberships WHERE person_id = (SELECT id FROM people WHERE email = 'mo.owner@triodian.com')").get().a, 1, 'an administrator is never demoted');
});

test('the result file names the client and where each app lives, and nothing about the people but their number', () => {
  const r = resultFor('P-1234abcd', { code: 'quay', apps: [{ id: 'board-direction', url: 'https://board-direction.quay.apps.example.com', worker: 'board-direction-quay', binding: 'S_QUAY_BOARD_DIRECTION' }] }, 3);
  assert.deepEqual(r, { format: RESULT_FORMAT, requestId: 'P-1234abcd', code: 'quay', people: 3, apps: [{ id: 'board-direction', url: 'https://board-direction.quay.apps.example.com' }] });
});

test('the copy of the identity tables used here matches an app checkout, when one is at hand', async t => {
  const dir = [process.env.APP_DIR, resolve(HERE, '../../board-direction'), resolve(HERE, '../practice/apps/board-direction')].filter(Boolean).find(d => existsSync(join(d, 'lib', 'identity', 'people.js')));
  if (!dir) return t.skip('no app checkout beside this repo (set APP_DIR to check)');
  const real = await import(pathToFileURL(join(dir, 'lib', 'identity', 'people.js')).href);
  assert.deepEqual(IDENTITY_SCHEMA, real.IDENTITY_SCHEMA);
  assert.deepEqual(SUITE_APPS.map(a => [a.id, Object.keys(a.roles)]), real.SUITE_APPS.map(a => [a.id, Object.keys(a.roles)]));
});
