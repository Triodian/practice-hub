// The engagement status an app reports to the practice hub (triodian.status.v1; development plan task 4.1).
// The hub shows stage and counts only. This module keeps only the fields the format allows, so a name, a finding or a
// position can never reach the hub's page, even if an app sent one. Cloud-neutral: no platform code.

export const FORMAT = 'triodian.status.v1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
const count = v => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
const date = v => (typeof v === 'string' && DATE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** The status as the hub keeps it, or null when it is not a status in this format. */
export function sanitizeStatus(s) {
  if (!s || typeof s !== 'object' || s.format !== FORMAT) return null;
  const st = s.stage && typeof s.stage === 'object' ? s.stage : {};
  const step = count(st.step), steps = count(st.steps);
  const sign = s.nextSignOff && typeof s.nextSignOff === 'object' ? s.nextSignOff : null;
  return {
    format: FORMAT,
    app: text(s.app, 40),
    generated: text(s.generated, 40),
    stage: { label: text(st.label, 120), step, steps: steps && step !== null && step <= steps ? steps : null },
    openActions: count(s.openActions),
    waitingOn: (Array.isArray(s.waitingOn) ? s.waitingOn : []).slice(0, 10)
      .map(w => ({ role: text(w && w.role, 40), actions: count(w && w.actions) }))
      .filter(w => w.role && w.actions !== null),
    nextSignOff: sign && text(sign.label, 120) ? { label: text(sign.label, 120), due: date(sign.due) } : null,
    nextBoardDate: date(s.nextBoardDate),
    lastActivity: date(s.lastActivity),
  };
}
