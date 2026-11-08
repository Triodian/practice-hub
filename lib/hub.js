// The practice hub's server logic: who may see it, and each client deployment's status. Cloud-neutral: the Worker
// entry point (src/worker.js) passes in the configuration and one status reader per app.
import { sanitizeStatus } from './status.js';

/** The client list from the CLIENTS variable: [{ code, name, apps: [{ id, name, url, binding }] }]. */
export function readClients(json) {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch (e) { return []; }
  return (Array.isArray(list) ? list : []).filter(c => c && typeof c.code === 'string').map(c => ({
    code: c.code, name: String(c.name || c.code),
    apps: (Array.isArray(c.apps) ? c.apps : []).filter(a => a && a.id && a.binding)
      .map(a => ({ id: String(a.id), name: String(a.name || a.id), url: String(a.url || ''), binding: String(a.binding) })),
  }));
}

/** The signed-in email, or '' when the person may not see the hub. Cloudflare Access protects the whole hub host and
 *  passes the verified email in a header; the hub also checks it against its own list of administrators. */
export function viewer(headers, env, hostname) {
  const admins = String(env.HUB_ADMINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  let email = String(headers.get('cf-access-authenticated-user-email') || '').toLowerCase().trim();
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!email && local && env.LOCAL_DEV_USER) email = String(env.LOCAL_DEV_USER).toLowerCase();
  return email && admins.includes(email) ? email : '';
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** One app's status, read through its service binding (the app's StatusService entrypoint). Never throws. */
export async function readStatus(service, ms = 3000) {
  if (!service || typeof service.status !== 'function') return { state: 'notLinked', note: 'This hub has no link to the app.' };
  try {
    const s = sanitizeStatus(await withTimeout(service.status(), ms));
    return s ? { state: 'ok', status: s } : { state: 'invalid', note: 'The app sent something that is not a status.' };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/timeout/.test(m)) return { state: 'unreachable', note: 'The app did not answer in time.' };
    if (/status|entrypoint|not a function|does not (exist|implement)|RPC/i.test(m)) return { state: 'notReporting', note: 'This version of the app does not report its status yet.' };
    return { state: 'unreachable', note: 'The app could not be reached.' };
  }
}

/** Every client with each app's status. */
export async function clientsWithStatus(clients, env) {
  return Promise.all(clients.map(async c => ({
    code: c.code, name: c.name,
    apps: await Promise.all(c.apps.map(async a => ({ id: a.id, name: a.name, url: a.url, ...(await readStatus(env[a.binding])) }))),
  })));
}
