// Provisioning a client deployment (development plan task 4.2). Builds on the installer (Triodian/triodian-install):
// each app's configuration comes from the installer's clientConfig(), so a provisioned client is configured exactly as
// a hand install would be. Every step checks before it changes anything, so a second run with the same inputs changes
// nothing. Side effects come in through `deps`, so the tests can run it against a fake Cloudflare account.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const STATUS_ENTRYPOINT = 'StatusService';

/** The client's sign-in cookie name: tri_suite_<code>, hyphens as underscores. */
export const sessionCookie = code => `tri_suite_${String(code).replace(/-/g, '_')}`;
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
const SUB = { 'risk-appetite': 'risk-appetite', 'use-assessment': 'use-assessment', confidentiality: 'confidentiality', 'board-direction': 'board-direction' };

/** The service binding name the hub uses for one client's app. */
export const bindingFor = (code, appId) => `S_${code}_${appId}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
/** Where a client's apps live: one subdomain per client under the practice's domain, so each client's sign-in cookie
 *  is scoped to that client alone (risk-appetite.acme.example.com, cookie domain acme.example.com). */
export const clientDomain = (practice, code) => `${code}.${practice.domain}`;
export const hubHost = practice => `hub.${practice.domain}`;

export function checkInputs(practice, input, installer) {
  const errs = [];
  // Hyphens are allowed (test-a, c-014), but not at the end or twice in a row: the code is part of hostnames,
  // Worker and database names, and the hub's binding names (where hyphens become underscores).
  if (!/^[a-z](?:[a-z0-9]|-(?!-)){0,18}[a-z0-9]$/.test(input.code || '')) errs.push('The client code is 2 to 20 lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(practice.domain || '')) errs.push('practice.json needs the practice\'s domain, on a zone in this Cloudflare account.');
  if (!/\.cloudflareaccess\.com$/.test(practice.teamDomain || '')) errs.push('practice.json needs the Zero Trust team domain (it ends in .cloudflareaccess.com).');
  if (!Array.isArray(practice.admins) || !practice.admins.length) errs.push('practice.json needs at least one hub administrator email in admins.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.admin || '')) errs.push('Give the practitioner\'s administrator email with --admin.');
  if (input.sector && !installer.SECTORS.some(s => s.id === input.sector && s.jurisdiction === (input.jurisdiction || 'AU'))) errs.push(`${input.sector} is not a regulated sector of ${input.jurisdiction || 'AU'}.`);
  const apps = appsWanted(input.apps, installer);
  if (!apps.length) errs.push('Choose the apps with --apps general, --apps regulated, or a comma-separated list of app ids.');
  return errs;
}

/** general, regulated, or a list of app ids. */
export function appsWanted(spec, installer) {
  if (spec === 'general' || spec === 'regulated') return installer.appsFor(spec);
  const ids = String(spec || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.includes('use-assessment') && !ids.includes('risk-appetite')) ids.push('risk-appetite'); // Use Assessment binds to Risk Appetite
  return installer.APPS.filter(a => ids.includes(a.id));
}

/** The hub's Worker configuration, from the practice and every provisioned client. */
export function hubConfig(practice, clients) {
  const list = clients.map(c => ({ code: c.code, name: c.name, apps: c.apps.map(a => ({ id: a.id, name: a.name, url: a.url, binding: a.binding })) }));
  return {
    name: practice.hubWorker || 'practice-hub',
    main: '../src/worker.js',
    compatibility_date: '2026-10-01',
    workers_dev: false,
    preview_urls: false,
    assets: { directory: '../public', binding: 'ASSETS', run_worker_first: true },
    routes: [{ pattern: hubHost(practice), custom_domain: true }],
    services: clients.flatMap(c => c.apps.map(a => ({ binding: a.binding, service: a.worker, entrypoint: STATUS_ENTRYPOINT }))),
    vars: { PRACTICE_NAME: practice.name || '', HUB_ADMINS: practice.admins.map(e => e.toLowerCase()).join(','), CLIENTS: JSON.stringify(list) },
    observability: { enabled: true },
  };
}

/**
 * Provision one client. Returns { changed: [...], unchanged: [...], client } where each entry is a short line.
 * deps: { cf, wrangler(cwd, argv, input?), gitHead(dir), fetchApp(app, dir), fs: { exists, read, write, list, mkdir },
 *         installer: { APPS, appsFor, SECTORS, clientConfig }, log, today }
 */
export async function provision(practice, input, deps) {
  const { cf, fs, installer, log = () => {} } = deps;
  const errs = checkInputs(practice, input, installer);
  if (errs.length) throw new Error(errs.join('\n'));
  const changed = [], unchanged = [];
  const did = (what, isChange) => (isChange ? changed : unchanged).push(what);
  const apps = appsWanted(input.apps, installer);
  const appsDir = practice.appsDir, stateDir = practice.stateDir, hubDir = practice.hubDir;
  const code = input.code, domain = clientDomain(practice, code);
  const statePath = join(stateDir, 'clients', `${code}.json`);
  const before = fs.exists(statePath) ? JSON.parse(fs.read(statePath)) : null;

  log('\n· The apps');
  fs.mkdir(appsDir);
  const head = {};
  for (const app of apps) { await deps.fetchApp(app, join(appsDir, app.dir)); head[app.id] = deps.gitHead(join(appsDir, app.dir)); }

  log('· The databases (location hint ' + (practice.locationHint || 'none') + ')');
  const ids = {};
  for (const [key, name] of [['identity', `triodian-identity-${code}`], ...apps.map(a => [a.id, `${a.worker}-${code}`])]) {
    const found = await cf.d1Find(name);
    if (found) { ids[key] = found.uuid || found.id; did(`database ${name} exists`, false); }
    else { ids[key] = await cf.d1Create(name, practice.locationHint || ''); did(`database ${name} created`, true); }
  }

  log('· Each app\'s configuration');
  const a = { code, domain, teamDomain: practice.teamDomain, firstAdmins: [input.admin.toLowerCase()], dir: appsDir, jurisdiction: input.jurisdiction || 'AU', sector: input.sector || '' };
  const made = apps.map(app => ({ app, ...installer.clientConfig(app, a, ids) }));
  // Each client's sign-in cookie has its own name. The cookie is scoped to <client>.<practice domain>, but a suite on a
  // parent domain (the Triodian demo on triodian.com, or a practice's own) sets a cookie that browsers also send here;
  // a shared name would let that cookie shadow this client's and break sign-in.
  for (const m of made) m.config.vars = { ...m.config.vars, SUITE_SESSION_COOKIE: sessionCookie(input.code) };
  for (const m of made) {
    const text = JSON.stringify(m.config, null, 2) + '\n';
    if (fs.exists(m.file) && fs.read(m.file) === text) did(`configuration for ${m.app.name} unchanged`, false);
    else { fs.write(m.file, text); did(`configuration for ${m.app.name} written`, true); }
  }

  log('· Email sign-in (Cloudflare Access, /auth/email on each app)');
  for (const m of made) {
    const domainPath = `${m.host}/auth/email`;
    let accessApp = await cf.accessFind(domainPath), created = false;
    if (!accessApp) {
      created = true;
      accessApp = await cf.accessCreate({ name: `${m.app.name} (${code}) sign-in`, domain: domainPath, type: 'self_hosted', session_duration: '24h',
        policies: [{ name: 'Anyone with an email code', decision: 'allow', include: [{ everyone: {} }] }] });
      did(`Access application for ${m.host} created`, true);
    } else did(`Access application for ${m.host} exists`, false);
    const secrets = await cf.workerSecrets(m.config.name);
    // A new Access application has a new audience tag, so the app's ACCESS_AUD is set again (this is how it is rotated).
    if (created || !secrets.includes('ACCESS_AUD')) { deps.wrangler(join(appsDir, m.app.dir), ['secret', 'put', 'ACCESS_AUD', '-c', m.file], accessApp.aud); did(`ACCESS_AUD set on ${m.config.name}`, true); }
    else did(`ACCESS_AUD on ${m.config.name} already set`, false);
  }

  log('· Deploying, Risk Appetite first');
  const deployed = { ...((before && before.deployed) || {}) };
  for (const m of made) {
    const fp = hash([head[m.app.id], m.config]);
    if (deployed[m.app.id] === fp && await cf.workerExists(m.config.name)) { did(`${m.config.name} already deployed at this version`, false); continue; }
    deps.wrangler(join(appsDir, m.app.dir), ['deploy', '-c', m.file]);
    deployed[m.app.id] = fp; did(`${m.config.name} deployed`, true);
  }

  const client = {
    code, name: input.name || (before && before.name) || code, profile: input.apps, domain,
    jurisdiction: a.jurisdiction, sector: a.sector, admin: a.firstAdmins[0],
    createdOn: (before && before.createdOn) || deps.today(),
    apps: made.map(m => ({ id: m.app.id, name: m.app.name, worker: m.config.name, url: `https://${m.host}`, binding: bindingFor(code, m.app.id) })),
    databases: ids, deployed,
  };
  const stateText = JSON.stringify(client, null, 2) + '\n';
  if (!before || fs.read(statePath) !== stateText) { fs.mkdir(join(stateDir, 'clients')); fs.write(statePath, stateText); did(`client record ${code} saved`, true); }
  else did(`client record ${code} unchanged`, false);

  await updateHub(practice, deps, did);
  return { changed, unchanged, client };
}

/** Brings the hub up to date with every client record: its configuration, its Access application and its deployment. */
export async function updateHub(practice, deps, did) {
  const { cf, fs, log = () => {} } = deps;
  log('· The practice hub');
  const clientsDir = join(practice.stateDir, 'clients');
  const clients = (fs.exists(clientsDir) ? fs.list(clientsDir) : []).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.read(join(clientsDir, f))));
  const config = hubConfig(practice, clients);
  const cfgDir = join(practice.hubDir, '.provisioned'), cfgPath = join(cfgDir, `${config.name}.json`), text = JSON.stringify(config, null, 2) + '\n';
  fs.mkdir(cfgDir);
  if (fs.exists(cfgPath) && fs.read(cfgPath) === text) did('hub configuration unchanged', false); else { fs.write(cfgPath, text); did('hub configuration written', true); }

  // The hub admits the practice administrators only. When practice.json's admins change, the policy follows.
  const host = hubHost(practice), admins = [...new Set(practice.admins.map(e => e.toLowerCase()))].sort();
  const hubApp = { name: `${practice.name || 'Practice'} hub`, domain: host, type: 'self_hosted', session_duration: '12h',
    policies: [{ name: 'Practice administrators', decision: 'allow', include: admins.map(e => ({ email: { email: e } })) }] };
  const existing = await cf.accessFind(host);
  const admitted = existing && (existing.policies || []).flatMap(p => (p.include || []).map(i => i.email && i.email.email)).filter(Boolean).map(e => e.toLowerCase()).sort();
  if (!existing) { await cf.accessCreate(hubApp); did(`Access application for ${host} created`, true); }
  else if (JSON.stringify(admitted) !== JSON.stringify(admins)) {
    // An application taken over from a hand setup may cover other hostnames too (hub-test.<domain>, say). Keep them,
    // hub first: an update with the hub's domain alone would drop them, and leave them without Access in front.
    const others = (existing.destinations || []).filter(d => !(d.type === 'public' && d.uri === host));
    await cf.accessUpdate(existing.id, others.length ? { ...hubApp, destinations: [{ type: 'public', uri: host }, ...others] } : hubApp);
    did(`Access policy for ${host} now admits ${admins.join(', ')}`, true); }
  else did(`Access application for ${host} admits the practice administrators`, false);

  const statePath = join(practice.stateDir, 'hub.json');
  const state = fs.exists(statePath) ? JSON.parse(fs.read(statePath)) : {};
  const fp = hash([deps.gitHead(practice.hubDir), config]);
  if (state.deployed === fp && await cf.workerExists(config.name)) did('hub already deployed with this configuration', false);
  else {
    deps.wrangler(practice.hubDir, ['deploy', '-c', cfgPath]);
    fs.write(statePath, JSON.stringify({ deployed: fp }, null, 2) + '\n'); did(`hub deployed at https://${host}`, true);
  }
}
