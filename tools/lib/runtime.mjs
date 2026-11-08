// The real side effects for the provisioning tools: files, git, wrangler, and the installer from triodian-install.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudflare } from './cloudflare.mjs';

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) o[k.slice(2)] = true; else { o[k.slice(2)] = n; i++; } }
    else o._.push(k);
  }
  return o;
}

/** practice.json, with its folders resolved: apps beside it in apps/, client records in clients/, the hub repo here. */
export function loadPractice(path, hubDir) {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`No practice file at ${file}. Copy practice.example.json to it and fill it in (see README).`);
  const p = JSON.parse(readFileSync(file, 'utf8')), base = dirname(file);
  return { ...p, file, stateDir: base, appsDir: resolve(base, p.appsDir || 'apps'), hubDir: resolve(hubDir), locationHint: p.locationHint === undefined ? 'oc' : p.locationHint };
}

export async function loadInstaller(dir) {
  const d = resolve(dir);
  if (!existsSync(join(d, 'install.mjs'))) throw new Error(`The installer was not found at ${d}. Check out Triodian/triodian-install there, or pass --install <folder>.`);
  const inst = await import(pathToFileURL(join(d, 'install.mjs')).href);
  const lib = await import(pathToFileURL(join(d, 'lib-config.mjs')).href);
  return { clientConfig: inst.clientConfig, APPS: lib.APPS, appsFor: lib.appsFor, SECTORS: lib.SECTORS };
}

export function realDeps({ dry, log }) {
  const say = s => log(s);
  const run = (cmd, argv, opts = {}) => {
    say(`  $ ${cmd} ${argv.map(x => /\s/.test(x) ? JSON.stringify(x) : x).join(' ')}`);
    if (dry) return '';
    return execFileSync(cmd, argv, { encoding: 'utf8', stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'], ...opts });
  };
  const cf = cloudflare({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, dry, log: say });
  return {
    cf,
    log: say,
    today: () => new Date().toISOString().slice(0, 10),
    wrangler: (cwd, argv, input) => run('npx', ['--yes', 'wrangler@4', ...argv], { cwd, input }),
    fetchApp: async (app, dir) => {
      if (existsSync(join(dir, '.git'))) execFileSync('git', ['-C', dir, 'pull', '--ff-only', '-q'], { stdio: 'inherit' });
      else execFileSync('git', ['clone', '-q', '--depth', '1', `https://github.com/Triodian/${app.repo}.git`, dir], { stdio: 'inherit' });
    },
    gitHead: dir => { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return 'no-git'; } },
    fs: {
      exists: p => existsSync(p),
      read: p => readFileSync(p, 'utf8'),
      write: (p, t) => { if (dry && !/wrangler\.[a-z0-9]+\.json$|\.provisioned/.test(p)) { say(`  (dry run) would write ${p}`); return; } writeFileSync(p, t); },
      list: p => readdirSync(p),
      mkdir: p => mkdirSync(p, { recursive: true }),
    },
  };
}
