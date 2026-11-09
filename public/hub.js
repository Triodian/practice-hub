// The practice hub page: loads /api/clients and lists each client's apps with their status. No external scripts.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) n.setAttribute(k, v); });
    kids.flat().forEach(k => n.append(k == null ? '' : k));
    return n;
  };
  const day = d => {
    if (!d) return '';
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const STATE = { notReporting: 'Not reporting yet', unreachable: 'Unreachable', notLinked: 'Not linked', invalid: 'Status not readable' };

  function appRow(a) {
    const link = a.url ? el('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name) : a.name;
    if (a.state !== 'ok') {
      return el('tr', { class: 'muted' },
        el('td', { 'data-label': 'App' }, link),
        el('td', { 'data-label': 'Stage', colspan: '4' }, el('span', { class: 'pill pill-grey' }, STATE[a.state] || 'Unknown'), ' ', a.note || ''));
    }
    const s = a.status;
    // Add "(4 of 8)" only when the app's own label does not already say it.
    const counted = s.stage.step > 0 && s.stage.steps && !new RegExp(`\\b${s.stage.step} of ${s.stage.steps}\\b`).test(s.stage.label || '');
    const stage = counted ? `${s.stage.label} (${s.stage.step} of ${s.stage.steps})` : s.stage.label || '—';
    const waiting = s.waitingOn.length ? s.waitingOn.map(w => `${w.role} ${w.actions}`).join(', ') : '';
    const next = s.nextSignOff ? `${s.nextSignOff.label}${s.nextSignOff.due ? ' · ' + day(s.nextSignOff.due) : ''}` : '—';
    return el('tr', null,
      el('td', { 'data-label': 'App' }, link),
      el('td', { 'data-label': 'Stage' }, stage),
      el('td', { 'data-label': 'Open actions' }, s.openActions == null ? '—' : String(s.openActions), waiting ? el('span', { class: 'sub' }, waiting) : ''),
      el('td', { 'data-label': 'Next sign-off' }, next),
      el('td', { 'data-label': 'Board date' }, s.nextBoardDate ? day(s.nextBoardDate) : '—'));
  }

  function clientCard(c) {
    const ok = c.apps.filter(a => a.state === 'ok').length;
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', null, c.name),
        el('span', { class: 'code' }, c.code),
        el('span', { class: 'pill ' + (ok === c.apps.length ? 'pill-green' : ok ? 'pill-amber' : 'pill-grey') }, `${ok} of ${c.apps.length} reporting`)),
      el('table', { class: 'rtable' },
        el('thead', null, el('tr', null, ['App', 'Stage', 'Open actions', 'Next sign-off', 'Board date'].map(h => el('th', null, h)))),
        el('tbody', null, c.apps.map(appRow))));
  }

  fetch('/api/clients', { headers: { Accept: 'application/json' } })
    .then(r => r.json().then(j => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok) throw new Error(j.error || 'The hub could not load.');
      if (j.practice) $('practice').textContent = j.practice;
      $('meta').textContent = `Signed in as ${j.viewer} · read ${new Date(j.generated).toLocaleString('en-AU')}`;
      if (!j.clients.length) { $('message').hidden = false; $('message').textContent = 'No client deployments yet. Provision one with tools/provision-client.mjs.'; return; }
      j.clients.forEach(c => $('clients').append(clientCard(c)));
    })
    .catch(e => { $('message').hidden = false; $('message').textContent = e.message; });
})();
