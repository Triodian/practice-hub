#!/usr/bin/env node
// Closes a client deployment (development plan task 4.4, runbook "Closing a client").
//
//   node tools/close-client.mjs --code acme --archive ./archive/acme          exports every database, changes nothing else
//   node tools/close-client.mjs --code acme --archive ./archive/acme --destroy --confirm acme
//        exports, then deletes the client's Workers, databases and Access applications, removes it from the hub
//
// Destroying needs --confirm with the client code typed again, and always exports first. Add --dry-run to see the
// steps without changing anything.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateHub, hubHost } from './lib/provision.mjs';
import { parseArgs, loadPractice, realDeps } from './lib/runtime.mjs';
import { unlinkSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const dry = !!args['dry-run'];
const log = s => console.log(s);

async function main() {
  const practice = loadPractice(args.practice || 'practice/practice.json', resolve(HERE, '..'));
  const deps = realDeps({ dry, log });
  const code = args.code, statePath = join(practice.stateDir, 'clients', `${code}.json`);
  if (!code || !deps.fs.exists(statePath)) throw new Error(`No client record for ${code || '(no --code)'} in ${join(practice.stateDir, 'clients')}.`);
  if (!args.archive) throw new Error('Give a folder for the export with --archive. Every close exports the databases first.');
  if (args.destroy && args.confirm !== code) throw new Error(`Destroying ${code} cannot be undone. Repeat the code with --confirm ${code}.`);
  if (!dry && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.');
  const client = JSON.parse(deps.fs.read(statePath)), out = resolve(args.archive);
  deps.fs.mkdir(out);

  log(`\n· Exporting ${code}'s databases to ${out}`);
  const names = [`triodian-identity-${code}`, ...client.apps.map(a => a.worker)];
  for (const n of names) deps.wrangler(practice.hubDir, ['d1', 'export', n, '--remote', '--output', join(out, `${n}.sql`)]);
  deps.fs.write(join(out, 'client.json'), JSON.stringify(client, null, 2) + '\n');
  if (!args.destroy) { log(`\nExported. Nothing else changed. Check the files, then run again with --destroy --confirm ${code} to remove the deployment.`); return; }

  log(`\n· Removing ${code}'s apps`);
  for (const a of [...client.apps].reverse()) {
    const host = new URL(a.url).host, access = await deps.cf.accessFind(`${host}/auth/email`);
    if (access) await deps.cf.accessDelete(access.id);
    if (dry || await deps.cf.workerExists(a.worker)) await deps.cf.workerDelete(a.worker);
  }
  log('· Deleting the databases');
  for (const n of names) { const d = await deps.cf.d1Find(n); if (d) await deps.cf.d1Delete(d.uuid || d.id); }
  if (!dry) unlinkSync(statePath); else log(`  (dry run) would remove ${statePath}`);
  await updateHub(practice, deps, (what, changed) => changed && log('  · ' + what));
  log(`\n${code} is closed. Its export is in ${out}; keep or destroy it under the engagement letter. The hub at https://${hubHost(practice)} no longer lists it.`);
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
