// The practice hub (development plan task 4.3): a small Worker, behind Cloudflare Access, listing one practitioner's
// client deployments with their status. It holds no client content: the client list is configuration written by the
// provisioning script, and each status is read live from the app over a service binding and reduced to stage and
// counts (lib/status.js).
import { readClients, viewer, clientsWithStatus } from '../lib/hub.js';

const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const withHeaders = (res, extra = {}) => {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY, ...extra })) r.headers.set(k, v);
  return r;
};
const json = (body, status = 200) => withHeaders(new Response(JSON.stringify(body), { status }), { 'Content-Type': 'application/json; charset=utf-8' });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true });
    const who = viewer(request.headers, env, url.hostname);
    if (!who) return json({ error: 'You are not an administrator of this practice hub.' }, 403);
    if (url.pathname === '/api/clients' && request.method === 'GET') {
      const clients = await clientsWithStatus(readClients(env.CLIENTS), env);
      return json({ practice: env.PRACTICE_NAME || '', viewer: who, generated: new Date().toISOString(), clients });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
