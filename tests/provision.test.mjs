// Provisioning against a fake Cloudflare account (no network): the first run creates everything, a second run with
// the same inputs changes nothing, a second client is added beside the first, and bad inputs are refused.
// Needs Triodian/triodian-install checked out beside this repo (or INSTALL_DIR), as the provisioning builds on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provision, hubConfig, bindingFor, checkInputs } from '../tools/lib/provision.mjs';
import { loadInstaller } from '../tools/lib/runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const installer = await loadInstaller(process.env.INSTALL_DIR || resolve(HERE, '../../triodian-install'));

/** An in-memory Cloudflare account that records every change. */
function fakeAccount() {
  const st = { d1: [], access: [], workers: new Map(), calls: [] };
  return {
    st,
    cf: {
      async d1Find(name) { return st.d1.find(d => d.name === name) || null; },
      async d1Create(name, hint) { st.calls.push(`d1Create ${name} ${hint}`); const d = { name, uuid: `id-${name}`, hint }; st.d1.push(d); return d.uuid; },
      async accessUpdate(id, body) { st.calls.push(`accessUpdate ${body.domain}`); Object.assign(st.access.find(a => a.id === id), body); },
      async accessFind(domain) { return st.access.find(a => a.domain === domain) || null; },
      async accessCreate(body) { st.calls.push(`accessCreate ${body.domain}`); const a = { ...body, id: `acc-${st.access.length}`, aud: `aud-${body.domain}` }; st.access.push(a); return a; },
      async workerExists(name) { return st.workers.has(name); },
      async workerSecrets(name) { return st.workers.has(name) ? Object.keys(st.workers.get(name).secrets) : []; },
    },
    wrangler(cwd, argv, input) {
      const cfgFile = argv[argv.indexOf('-c') + 1], cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
      const w = st.workers.get(cfg.name) || { secrets: {}, deploys: 0 };
      if (argv[0] === 'secret') { w.secrets[argv[2]] = input; st.calls.push(`secret ${cfg.name} ${argv[2]}`); }
      if (argv[0] === 'deploy') { w.deploys++; w.config = cfg; st.calls.push(`deploy ${cfg.name}`); }
      st.workers.set(cfg.name, w);
    },
  };
}

/** A practice folder with app checkouts that carry a minimal wrangler.jsonc, like the real apps' client profile. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'hub-test-'));
  const practice = { name: 'Kestrel Board Advisory', domain: 'kestrel.example.com', teamDomain: 'kestrel.cloudflareaccess.com', admins: ['Partner@Kestrel.example.com'],
    locationHint: 'oc', stateDir: join(root, 'practice'), appsDir: join(root, 'practice', 'apps'), hubDir: join(root, 'hub') };
  mkdirSync(practice.stateDir, { recursive: true }); mkdirSync(practice.hubDir, { recursive: true });
  return { root, practice };
}
function deps(practice, acct) {
  return {
    cf: acct.cf, installer, today: () => '2026-11-08', log: () => {},
    wrangler: (cwd, argv, input) => acct.wrangler(cwd, argv, input),
    gitHead: () => 'commit-1',
    fetchApp: async (app, dir) => {
      if (existsSync(join(dir, 'wrangler.jsonc'))) return;
      mkdirSync(dir, { recursive: true });
      const services = app.id === 'use-assessment' ? [{ binding: 'APPETITE', service: 'risk-appetite', entrypoint: 'AppetiteService' }] : [];
      writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify({ name: app.worker, main: 'src/worker.js', compatibility_date: '2026-10-01',
        env: { client: { vars: { NOTIFY_SENDING: 'off' }, services: services.map(s => ({ ...s, service: s.service + '-client' })) } } }));
    },
    fs: { exists: existsSync, read: p => readFileSync(p, 'utf8'), write: (p, t) => writeFileSync(p, t), list: readdirSync, mkdir: p => mkdirSync(p, { recursive: true }) },
  };
}
const acme = { code: 'acme', name: 'Acme Super (fictional)', apps: 'regulated', admin: 'gc@kestrel.example.com', jurisdiction: 'AU', sector: 'AU-SUPERANNUATION' };

test('a first run stands up the client: databases with the location hint, configurations, sign-in, deploys, and the hub', async () => {
  const { practice } = setup(), acct = fakeAccount();
  const r = await provision(practice, acme, deps(practice, acct));
  assert.equal(acct.st.d1.length, 5, 'four app databases and the identity database');
  assert.ok(acct.st.d1.every(d => d.hint === 'oc'), 'every database created with the oc location hint');
  for (const w of ['risk-appetite-acme', 'use-assessment-acme', 'confidentiality-exposure-assessment-acme', 'board-direction-acme', 'practice-hub'])
    assert.equal(acct.st.workers.get(w)?.deploys, 1, `${w} deployed once`);
  assert.deepEqual(acct.st.calls.filter(c => c.startsWith('deploy')).slice(0, 2), ['deploy risk-appetite-acme', 'deploy use-assessment-acme'], 'Risk Appetite deploys before Use Assessment');
  const ua = acct.st.workers.get('use-assessment-acme').config;
  assert.equal(ua.services[0].service, 'risk-appetite-acme', 'Use Assessment binds to this client\'s Risk Appetite');
  assert.equal(ua.vars.SUITE_COOKIE_DOMAIN, 'acme.kestrel.example.com', 'the sign-in cookie is scoped to this client alone');
  assert.equal(ua.vars.FIRST_ADMINS, 'gc@kestrel.example.com');
  assert.equal(ua.vars.SUITE_SESSION_COOKIE, 'tri_suite_acme', 'its own cookie name, so a suite on a parent domain cannot shadow it');
  assert.equal(ua.vars.DEFAULT_SECTOR, 'AU-SUPERANNUATION');
  assert.ok(acct.st.access.some(a => a.domain === 'risk-appetite.acme.kestrel.example.com/auth/email'), 'email sign-in on each app');
  assert.ok(acct.st.workers.get('risk-appetite-acme').secrets.ACCESS_AUD, 'ACCESS_AUD set from the Access application');
  const hubAccess = acct.st.access.find(a => a.domain === 'hub.kestrel.example.com');
  assert.deepEqual(hubAccess.policies[0].include, [{ email: { email: 'partner@kestrel.example.com' } }], 'the hub admits only the practice administrators');
  const hub = acct.st.workers.get('practice-hub').config;
  assert.equal(hub.services.length, 4, 'one status binding per app');
  assert.ok(hub.services.every(s => s.entrypoint === 'StatusService' && s.service.endsWith('-acme')));
  assert.equal(JSON.parse(hub.vars.CLIENTS)[0].name, 'Acme Super (fictional)');
  assert.ok(r.changed.length > 0 && r.client.apps.length === 4);
});

test('a second run with the same inputs changes nothing', async () => {
  const { practice } = setup(), acct = fakeAccount();
  await provision(practice, acme, deps(practice, acct));
  const callsBefore = acct.st.calls.length;
  const r = await provision(practice, acme, deps(practice, acct));
  assert.deepEqual(r.changed, [], 'no change reported');
  assert.equal(acct.st.calls.length, callsBefore, 'no Cloudflare call that changes anything');
});

test('a new app version is deployed on the next run, and nothing else changes', async () => {
  const { practice } = setup(), acct = fakeAccount(), d = deps(practice, acct);
  await provision(practice, acme, d);
  const r = await provision(practice, acme, { ...d, gitHead: dir => (dir.includes('board-direction') ? 'commit-2' : 'commit-1') });
  assert.deepEqual(r.changed, ['board-direction-acme deployed', 'client record acme saved']);
});

test('a second client sits beside the first, and the hub lists both', async () => {
  const { practice } = setup(), acct = fakeAccount();
  await provision(practice, acme, deps(practice, acct));
  await provision(practice, { code: 'harrow', name: 'Harrow Valley Foods (fictional)', apps: 'general', admin: 'gc@kestrel.example.com' }, deps(practice, acct));
  assert.equal(acct.st.workers.get('board-direction-harrow')?.deploys, 1);
  assert.ok(!acct.st.workers.has('risk-appetite-harrow'), 'a general company gets no Risk Appetite');
  const hub = acct.st.workers.get('practice-hub');
  assert.equal(hub.deploys, 2, 'the hub is redeployed once for the new client');
  assert.deepEqual(JSON.parse(hub.config.vars.CLIENTS).map(c => c.code), ['acme', 'harrow']);
  assert.ok(hub.config.services.some(s => s.binding === bindingFor('harrow', 'board-direction')));
});

test('a change of practice administrators updates the hub policy and nothing at the clients', async () => {
  const { practice } = setup(), acct = fakeAccount();
  await provision(practice, acme, deps(practice, acct));
  const p2 = { ...practice, admins: ['partner@kestrel.example.com', 'second@kestrel.example.com'] };
  const r = await provision(p2, acme, deps(p2, acct));
  assert.deepEqual(r.changed, ['hub configuration written', 'Access policy for hub.kestrel.example.com now admits partner@kestrel.example.com, second@kestrel.example.com', 'hub deployed at https://hub.kestrel.example.com']);
  assert.deepEqual((await provision(p2, acme, deps(p2, acct))).changed, [], 'and a further run changes nothing');
});

test('recreating an app\'s Access application rotates its ACCESS_AUD, and only that app changes', async () => {
  const { practice } = setup(), acct = fakeAccount();
  await provision(practice, acme, deps(practice, acct));
  acct.st.access = acct.st.access.filter(a => a.domain !== 'board-direction.acme.kestrel.example.com/auth/email');
  const r = await provision(practice, acme, deps(practice, acct));
  assert.deepEqual(r.changed, ['Access application for board-direction.acme.kestrel.example.com created', 'ACCESS_AUD set on board-direction-acme']);
  assert.equal(acct.st.workers.get('board-direction-acme').secrets.ACCESS_AUD, 'aud-board-direction.acme.kestrel.example.com/auth/email');
});

test('bad inputs are refused before anything is touched', async () => {
  const { practice } = setup(), acct = fakeAccount();
  await assert.rejects(provision(practice, { ...acme, code: 'Bad Code' }, deps(practice, acct)), /client code/);
  for (const code of ['test-', '-test', 'te--st', '1test', 'a'])
    await assert.rejects(provision(practice, { ...acme, code }, deps(practice, acct)), /client code/, code);
  await assert.rejects(provision(practice, { ...acme, sector: 'SG-BANKING' }, deps(practice, acct)), /not a regulated sector of AU/);
  await assert.rejects(provision(practice, { ...acme, apps: 'nonsense' }, deps(practice, acct)), /Choose the apps/);
  assert.equal(acct.st.calls.length, 0);
  assert.deepEqual(checkInputs({ ...practice, admins: [] }, acme, installer).length, 1);
});

test('the hub configuration is closed to the public internet except through its own host', () => {
  const c = hubConfig({ name: 'P', domain: 'p.example.com', admins: ['a@p.example.com'] }, []);
  assert.equal(c.workers_dev, false); assert.equal(c.preview_urls, false);
  assert.deepEqual(c.routes, [{ pattern: 'hub.p.example.com', custom_domain: true }]);
  assert.equal(c.assets.run_worker_first, true, 'the page itself is behind the administrator check');
});

test('a hyphenated client code provisions, and a second run changes nothing', async () => {
  const { practice } = setup(), acct = fakeAccount(), input = { code: 'test-a', name: 'Test A (fictional)', apps: 'general', admin: 'gc@kestrel.example.com' };
  await provision(practice, input, deps(practice, acct));
  assert.ok(acct.st.workers.has('board-direction-test-a'));
  assert.ok(acct.st.workers.get('practice-hub').config.services.some(s => s.binding === 'S_TEST_A_BOARD_DIRECTION'));
  assert.deepEqual((await provision(practice, input, deps(practice, acct))).changed, []);
});

test('taking over a hand-made hub application keeps its other hostnames and replaces who it admits', async () => {
  const { practice } = setup(), acct = fakeAccount();
  acct.st.access.push({ id: 'hand', name: 'hub', domain: 'hub.kestrel.example.com', aud: 'aud-hand',
    destinations: [{ type: 'public', uri: 'hub.kestrel.example.com' }, { type: 'public', uri: 'hub-test.kestrel.example.com' }],
    policies: [{ name: 'Allow', decision: 'allow', include: [{ email: { email: 'someone@else.example.com' } }] }] });
  const r = await provision(practice, acme, deps(practice, acct));
  assert.ok(r.changed.includes('Access policy for hub.kestrel.example.com now admits partner@kestrel.example.com'));
  const hub = acct.st.access.find(a => a.id === 'hand');
  assert.deepEqual(hub.destinations.map(d => d.uri), ['hub.kestrel.example.com', 'hub-test.kestrel.example.com']);
  assert.deepEqual(hub.policies[0].include, [{ email: { email: 'partner@kestrel.example.com' } }]);
  assert.ok(!(await provision(practice, acme, deps(practice, acct))).changed.some(c => /Access/.test(c)), 'and a second run leaves it alone');
});
