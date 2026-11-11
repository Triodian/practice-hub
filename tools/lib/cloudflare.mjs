// A small Cloudflare API client for provisioning. In a dry run nothing is sent: reads return "nothing there yet" and
// writes are only printed, so a dry run shows every step a first run would take.
const API = 'https://api.cloudflare.com/client/v4';

export function cloudflare({ token, accountId, dry = false, log = () => {}, fetchImpl = globalThis.fetch }) {
  const acct = `/accounts/${accountId || 'ACCOUNT'}`;
  async function call(method, path, body) {
    if (dry) { if (method !== 'GET') log(`  → Cloudflare API ${method} ${path}`); return method === 'GET' ? [] : { id: 'DRY-RUN', aud: 'DRY-RUN-AUD', uuid: 'DRY-RUN' }; }
    if (method !== 'GET') log(`  → Cloudflare API ${method} ${path}`);
    const r = await fetchImpl(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (method === 'GET' && r.status === 404) return null;
    const j = await r.json().catch(() => ({}));
    if (!j.success) throw new Error(`Cloudflare API ${method} ${path}: ${JSON.stringify(j.errors || r.status)}`);
    return j.result;
  }
  return {
    dry,
    /** The D1 database with exactly this name, or null. */
    async d1Find(name) { const r = await call('GET', `${acct}/d1/database?name=${encodeURIComponent(name)}&per_page=100`); return (r || []).find(d => d.name === name) || null; },
    /** Creates a D1 database with a location hint (a preference, not a guarantee). Returns its id. */
    async d1Create(name, hint) { const r = await call('POST', `${acct}/d1/database`, hint ? { name, primary_location_hint: hint } : { name }); return r.uuid || r.id; },
    /** Runs one SQL statement on a D1 database and returns its rows. In a dry run nothing is sent: reads return no rows. */
    async d1Query(id, sql, params = []) {
      if (dry) { if (!/^\s*SELECT/i.test(sql)) log(`  → D1 ${sql.replace(/\s+/g, ' ').slice(0, 70)}…`); return []; }
      const r = await fetchImpl(`${API}${acct}/d1/database/${id}/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: params.map(String) }) }); // D1's API takes parameters as text; a column's type turns them back
      const j = await r.json().catch(() => ({}));
      if (!j.success) throw new Error(`Cloudflare D1 query failed: ${JSON.stringify(j.errors || r.status)}`);
      return ((j.result || [])[0] || {}).results || [];
    },
    async d1Delete(id) { return call('DELETE', `${acct}/d1/database/${id}`); },
    /** Access applications whose domain is exactly this one. */
    async accessFind(domain) { const r = await call('GET', `${acct}/access/apps?per_page=1000`); return (r || []).find(a => a.domain === domain) || null; },
    async accessCreate(body) { return call('POST', `${acct}/access/apps`, body); },
    async accessUpdate(id, body) { return call('PUT', `${acct}/access/apps/${id}`, body); },
    async accessDelete(id) { return call('DELETE', `${acct}/access/apps/${id}`); },
    /** True when a Worker with this name exists. */
    async workerExists(name) { if (dry) return false; const r = await call('GET', `${acct}/workers/scripts/${encodeURIComponent(name)}/settings`); return !!r; },
    /** The names of a Worker's secrets ([] if it has none or does not exist). */
    async workerSecrets(name) { const r = await call('GET', `${acct}/workers/scripts/${encodeURIComponent(name)}/secrets`); return (r || []).map(s => s.name); },
    async workerDelete(name) { return call('DELETE', `${acct}/workers/scripts/${encodeURIComponent(name)}?force=true`); },
  };
}
