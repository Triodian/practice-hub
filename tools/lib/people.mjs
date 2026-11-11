// Adds a client's people, with their roles in each app, to the client's shared identity database (development plan
// task 5.6). The people come from a Triodian Start job file: the team the client formed, the delivery side's people
// named at approval, and the client's first administrator.
//
// The identity database's tables and each app's role names come from the app checkout itself
// (lib/identity/people.js: IDENTITY_SCHEMA and SUITE_APPS), so this adds people exactly as an app's Admin would.
// It only adds: a person already there keeps their name; a membership already there keeps its roles and gains any
// missing ones; nothing is removed and no one is switched off. A second run with the same job changes nothing.
import { randomBytes } from 'node:crypto';

export const JOB_FORMAT = 'triodian.provisionJob/1', RESULT_FORMAT = 'triodian.provisionResult/1';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Reads a Start job file's contents into the provisioning inputs. Throws with every problem found. */
export function readJob(job) {
  const errs = [];
  if (!job || typeof job !== 'object' || job.format !== JOB_FORMAT) throw new Error(`This is not a Triodian Start job file (format ${JOB_FORMAT}). Download it from Start, Requests, after approving the request.`);
  for (const k of ['requestId', 'code', 'apps', 'admin']) if (typeof job[k] !== 'string' || !job[k]) errs.push(`The job file has no ${k}.`);
  if (!Array.isArray(job.people) || !job.people.length) errs.push('The job file names no people.');
  const people = [];
  for (const p of Array.isArray(job.people) ? job.people : []) {
    const email = String((p && p.email) || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) { errs.push(`“${(p && p.email) || ''}” in the job file is not an email address.`); continue; }
    if (people.some(x => x.email === email)) { errs.push(`${email} is in the job file twice.`); continue; }
    if (!p.apps || typeof p.apps !== 'object' || Array.isArray(p.apps) || !Object.keys(p.apps).length) { errs.push(`${email} has no app in the job file.`); continue; }
    const apps = {};
    for (const [app, roles] of Object.entries(p.apps)) {
      if (!Array.isArray(roles) || roles.some(r => typeof r !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(r))) { errs.push(`${email}: the roles for ${app} are not in the expected form.`); continue; }
      apps[app] = [...new Set(roles)];
    }
    people.push({ email, name: String(p.name || '').trim().slice(0, 120), organisation: String(p.organisation || '').trim().slice(0, 120), admin: p.admin === true, apps });
  }
  if (errs.length) throw new Error(errs.join('\n'));
  return { requestId: job.requestId, code: job.code, name: job.name || job.code, apps: job.apps, admin: String(job.admin).toLowerCase(),
    jurisdiction: String(job.jurisdiction || 'AU').toUpperCase(), sector: job.sector || '', people };
}

/** Problems with the people against the apps being provisioned and the apps' own role names. Returns a list of lines. */
export function peopleErrors(people, appIds, suiteApps) {
  const errs = [];
  for (const p of people) for (const [app, roles] of Object.entries(p.apps)) {
    if (!appIds.includes(app)) { errs.push(`${p.email} has roles in ${app}, which is not one of this client's apps (${appIds.join(', ')}).`); continue; }
    const known = (suiteApps.find(a => a.id === app) || {}).roles;
    if (!known) { errs.push(`The apps do not know an app called ${app}. Update the app checkouts and try again.`); continue; }
    for (const r of roles) if (!(r in known)) errs.push(`${p.email}: ${app} has no role ${r}. Update the app checkouts, or download the job file again.`);
  }
  return errs;
}

const rolesList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);

/**
 * Adds the people. q(sql, params) runs one statement on the identity database and returns its rows.
 * Returns { changed: [...lines], unchanged: n }.
 */
export async function seedPeople(q, people, { schema, now = new Date().toISOString(), by = 'provisioning', newId = () => 'p' + randomBytes(6).toString('hex') }) {
  const changed = []; let unchanged = 0;
  for (const s of schema) await q(s, []);
  for (const p of people) {
    let person = (await q('SELECT id FROM people WHERE email = ?', [p.email]))[0];
    if (!person) {
      person = { id: newId() };
      await q(`INSERT INTO people (id, email, name, organisation, notify_email, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [person.id, p.email, p.name, p.organisation, now, by, now, by]);
      changed.push(`${p.email} added`);
    }
    for (const [app, roles] of Object.entries(p.apps)) {
      const m = (await q('SELECT local_id, roles, is_admin FROM memberships WHERE app = ? AND person_id = ?', [app, person.id]))[0];
      if (!m) {
        await q(`INSERT INTO memberships (app, local_id, person_id, roles, is_admin, active, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [app, person.id, person.id, roles.join(','), p.admin ? 1 : 0, now, by, now, by]);
        changed.push(`${p.email} joined ${app}${roles.length ? ' as ' + roles.join(', ') : ''}${p.admin ? ' (administrator)' : ''}`);
        continue;
      }
      const have = rolesList(m.roles), missing = roles.filter(r => !have.includes(r)), makeAdmin = p.admin && !m.is_admin;
      if (!missing.length && !makeAdmin) { unchanged++; continue; }
      await q('UPDATE memberships SET roles = ?, is_admin = ?, updated_at = ?, updated_by = ? WHERE app = ? AND local_id = ?', [[...have, ...missing].join(','), m.is_admin || makeAdmin ? 1 : 0, now, by, app, m.local_id]);
      changed.push(`${p.email} in ${app}: ${[missing.length ? 'added ' + missing.join(', ') : '', makeAdmin ? 'made administrator' : ''].filter(Boolean).join('; ')}`);
    }
  }
  return { changed, unchanged };
}

/** The result file Start takes back: which client, and where each app lives. */
export const resultFor = (requestId, client, people) => ({ format: RESULT_FORMAT, requestId, code: client.code, people, apps: client.apps.map(a => ({ id: a.id, url: a.url })) });
