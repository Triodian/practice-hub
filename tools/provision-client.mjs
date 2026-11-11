#!/usr/bin/env node
// Stands up one client's apps in the practice's Cloudflare account and adds the client to the practice hub
// (development plan task 4.2). A second run with the same inputs changes nothing.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   node tools/provision-client.mjs --code acme --name "Acme Super" --apps regulated --admin gc@firm.com.au \
//     [--jurisdiction AU --sector AU-SUPERANNUATION] [--practice practice/practice.json] [--install ../triodian-install] [--dry-run]
//
// From a Triodian Start request (task 5.6): node tools/provision-client.mjs --job triodian-job-<code>.json
// The job file (downloaded from Start, Requests, after approval) gives the code, name, apps, administrator and the
// people with their roles. The people are added to the client's apps, and a result file is written beside the job
// file (<job>.result.json) to upload in Start, which then sends the invitations.
//
// --apps is general (AI Board Direction and the confidentiality app), regulated (all four), or a comma-separated
// list of app ids (risk-appetite, use-assessment, confidentiality, board-direction).
// The API token needs the installer's permissions: Account · D1 · Edit, Account · Workers Scripts · Edit,
// Zone · Workers Routes · Edit (on the practice's zone), Account · Access: Apps and Policies · Edit.
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readJob, resultFor } from './lib/people.mjs';
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
  let input = { code: args.code, name: args.name, apps: args.apps, admin: args.admin, jurisdiction: (args.jurisdiction || 'AU').toUpperCase(), sector: args.sector || '' };
  let jobFile = null;
  if (args.job) {
    if (['code', 'name', 'apps', 'admin', 'jurisdiction', 'sector'].some(k => args[k] !== undefined)) throw new Error('With --job, the code, name, apps and administrator come from the job file: leave those options out.');
    jobFile = resolve(String(args.job));
    if (!existsSync(jobFile)) throw new Error(`No job file at ${jobFile}. Download it from Start, Requests, after approving the request.`);
    let job; try { job = JSON.parse(readFileSync(jobFile, 'utf8')); } catch (e) { throw new Error(`${jobFile} is not a job file (it is not JSON).`); }
    input = readJob(job);
    log(`Job ${input.requestId}: ${input.name}, ${input.people.length} people`);
  }
  log(`Provisioning ${input.code} for ${practice.name || 'the practice'}${dry ? ' (dry run: nothing is changed in Cloudflare)' : ''}`);
  const r = await provision(practice, input, { ...realDeps({ dry, log }), installer });
  log(`\n${r.changed.length ? 'Changed:\n' + r.changed.map(x => '  · ' + x).join('\n') : 'Nothing changed: the client was already provisioned as asked.'}`);
  log(`\n${r.client.admin} can now sign in to each app and add people in Admin:`);
  r.client.apps.forEach(a => log(`  ${a.url}`));
  if (jobFile) {
    const out = jobFile.replace(/\.json$/i, '') + '.result.json';
    if (dry) log(`\n(dry run) would write ${out}, the result file to upload in Start.`);
    else { writeFileSync(out, JSON.stringify(resultFor(input.requestId, r.client, r.people), null, 2) + '\n'); log(`\nResult written to ${out}.\nUpload it in Start, Requests, for this client; Start then sends the invitations.`); }
  }
  log(`The client is listed in the practice hub at https://hub.${practice.domain}.`);
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
