#!/usr/bin/env node
// Stands up one client's apps in the practice's Cloudflare account and adds the client to the practice hub
// (development plan task 4.2). A second run with the same inputs changes nothing.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   node tools/provision-client.mjs --code acme --name "Acme Super" --apps regulated --admin gc@firm.com.au \
//     [--jurisdiction AU --sector AU-SUPERANNUATION] [--practice practice/practice.json] [--install ../triodian-install] [--dry-run]
//
// --apps is general (AI Board Direction and the confidentiality app), regulated (all four), or a comma-separated
// list of app ids (risk-appetite, use-assessment, confidentiality, board-direction).
// The API token needs the installer's permissions: Account · D1 · Edit, Account · Workers Scripts · Edit,
// Zone · Workers Routes · Edit (on the practice's zone), Account · Access: Apps and Policies · Edit.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provision } from './lib/provision.mjs';
import { parseArgs, loadPractice, loadInstaller, realDeps } from './lib/runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const dry = !!args['dry-run'];
const log = s => console.log(s);

async function main() {
  if (!dry && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first (see the top of this file for the permissions).');
  const practice = loadPractice(args.practice || 'practice/practice.json', resolve(HERE, '..'));
  const installer = await loadInstaller(args.install || resolve(HERE, '../../triodian-install'));
  const input = { code: args.code, name: args.name, apps: args.apps, admin: args.admin, jurisdiction: (args.jurisdiction || 'AU').toUpperCase(), sector: args.sector || '' };
  log(`Provisioning ${input.code} for ${practice.name || 'the practice'}${dry ? ' (dry run: nothing is changed in Cloudflare)' : ''}`);
  const r = await provision(practice, input, { ...realDeps({ dry, log }), installer });
  log(`\n${r.changed.length ? 'Changed:\n' + r.changed.map(x => '  · ' + x).join('\n') : 'Nothing changed: the client was already provisioned as asked.'}`);
  log(`\n${r.client.admin} can now sign in to each app and add people in Admin:`);
  r.client.apps.forEach(a => log(`  ${a.url}`));
  log(`The client is listed in the practice hub at https://hub.${practice.domain}.`);
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
