// The hub's server logic: only practice administrators see it, a status is reduced to stage and counts, and an app
// that cannot answer is shown as such instead of breaking the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStatus } from '../lib/status.js';
import { readClients, viewer, readStatus, clientsWithStatus } from '../lib/hub.js';
import worker from '../src/worker.js';

const status = (over = {}) => ({ format: 'triodian.status.v1', app: 'risk-appetite', generated: '2026-11-08T09:00:00Z',
  stage: { label: 'Decision 4', step: 4, steps: 8 }, openActions: 3, waitingOn: [{ role: 'CRO', actions: 2 }],
  nextSignOff: { label: 'The CRO agrees the working appetite', due: '2026-11-20' }, nextBoardDate: '2026-12-03', lastActivity: '2026-11-08', ...over });

test('a status keeps stage and counts, and drops anything else an app might send', () => {
  const s = sanitizeStatus(status({ positions: { P1: 'A3' }, findings: ['F2'], people: ['Priya'], waitingOn: [{ role: 'CRO', actions: 2, name: 'Priya' }] }));
  assert.deepEqual(Object.keys(s).sort(), ['app', 'format', 'generated', 'lastActivity', 'nextBoardDate', 'nextSignOff', 'openActions', 'stage', 'waitingOn'].sort());
  assert.deepEqual(s.waitingOn, [{ role: 'CRO', actions: 2 }], 'no names, even inside a list');
  assert.equal(JSON.stringify(s).includes('Priya'), false);
  assert.equal(sanitizeStatus({ format: 'something.else' }), null);
  assert.equal(sanitizeStatus(status({ openActions: -1 })).openActions, null);
  assert.equal(sanitizeStatus(status({ nextBoardDate: 'next Tuesday' })).nextBoardDate, null);
  assert.equal(sanitizeStatus(status({ stage: { label: 'x', step: 9, steps: 8 } })).stage.steps, null, 'a step past the last is not shown as progress');
});

test('only the practice administrators may see the hub', () => {
  const env = { HUB_ADMINS: 'partner@kestrel.example.com, Other@Kestrel.example.com' };
  const h = e => new Headers(e ? { 'cf-access-authenticated-user-email': e } : {});
  assert.equal(viewer(h('Partner@Kestrel.example.com'), env, 'hub.kestrel.example.com'), 'partner@kestrel.example.com');
  assert.equal(viewer(h('other@kestrel.example.com'), env, 'hub.kestrel.example.com'), 'other@kestrel.example.com');
  assert.equal(viewer(h('someone@else.com'), env, 'hub.kestrel.example.com'), '');
  assert.equal(viewer(h(''), env, 'hub.kestrel.example.com'), '');
  assert.equal(viewer(h(''), { ...env, LOCAL_DEV_USER: 'partner@kestrel.example.com' }, 'hub.kestrel.example.com'), '', 'the local sign-in works only on localhost');
  assert.equal(viewer(h(''), { ...env, LOCAL_DEV_USER: 'partner@kestrel.example.com' }, 'localhost'), 'partner@kestrel.example.com');
});

test('an app that cannot answer is shown as such', async () => {
  assert.equal((await readStatus({ status: async () => status() })).state, 'ok');
  assert.equal((await readStatus(undefined)).state, 'notLinked');
  assert.equal((await readStatus({ status: async () => { throw new TypeError('The RPC receiver does not implement the method "status".'); } })).state, 'notReporting');
  assert.equal((await readStatus({ status: async () => { throw new Error('network'); } })).state, 'unreachable');
  assert.equal((await readStatus({ status: () => new Promise(() => {}) }, 20)).state, 'unreachable');
  assert.equal((await readStatus({ status: async () => ({ hello: 1 }) })).state, 'invalid');
  // An app with other named entrypoints but no StatusService answers "internal error"; its Worker still serves /login.
  const internal = { status: async () => { throw new Error('internal error; reference = abc123'); } };
  const up = { fetch: async (u, o) => (new URL(u).pathname === '/login' && o.method === 'HEAD' ? new Response(null) : null) };
  assert.equal((await readStatus(internal, 3000, 'S_X', up)).state, 'notReporting');
  assert.equal((await readStatus(internal, 3000, 'S_X', { fetch: async () => { throw new Error('internal error'); } })).state, 'unreachable');
  assert.equal((await readStatus(internal, 20, 'S_X', { fetch: () => new Promise(() => {}) })).state, 'unreachable');
  assert.equal((await readStatus(internal)).state, 'unreachable', 'without the ping binding it cannot tell');
});

test('three clients, one with an app not reporting yet', async () => {
  const clients = readClients(JSON.stringify([
    { code: 'acme', name: 'Acme Super', apps: [{ id: 'risk-appetite', name: 'AI Risk Appetite', url: 'https://ra', binding: 'S_ACME_RA' }] },
    { code: 'bolt', name: 'Bolt Bank', apps: [{ id: 'board-direction', name: 'AI Board Direction', url: 'https://bd', binding: 'S_BOLT_BD' }] },
    { code: 'harrow', name: 'Harrow Valley Foods', apps: [{ id: 'board-direction', name: 'AI Board Direction', url: 'https://bd2', binding: 'S_HARROW_BD' }] },
  ]));
  const env = { S_ACME_RA: { status: async () => status() }, S_BOLT_BD: { status: async () => status({ app: 'board-direction' }) }, S_HARROW_BD: { status: async () => { throw new TypeError('does not implement the method "status"'); } } };
  const out = await clientsWithStatus(clients, env);
  assert.deepEqual(out.map(c => c.apps[0].state), ['ok', 'ok', 'notReporting']);
});

test('the Worker refuses a stranger and serves the list to an administrator, with security headers', async () => {
  const env = { HUB_ADMINS: 'partner@kestrel.example.com', PRACTICE_NAME: 'Kestrel', CLIENTS: '[]', ASSETS: { fetch: async () => new Response('<html>') } };
  const no = await worker.fetch(new Request('https://hub.kestrel.example.com/api/clients'), env);
  assert.equal(no.status, 403);
  const page = await worker.fetch(new Request('https://hub.kestrel.example.com/'), env);
  assert.equal(page.status, 403, 'the page itself is behind the check');
  const yes = await worker.fetch(new Request('https://hub.kestrel.example.com/api/clients', { headers: { 'cf-access-authenticated-user-email': 'partner@kestrel.example.com' } }), env);
  assert.equal(yes.status, 200);
  assert.match(yes.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await yes.json()).practice, 'Kestrel');
});
