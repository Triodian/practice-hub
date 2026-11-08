// A stand-in for an app's StatusService (task 4.1 adds the real one to each app). Each stub reports a fixed,
// fictional engagement chosen by its STUB_STAGE variable; one app per client may leave it unset to show "not reporting".
import { WorkerEntrypoint } from 'cloudflare:workers';
const STAGES = {
  ra: { app: 'risk-appetite', stage: { label: 'Decision 4 of 8: limits', step: 4, steps: 8 }, openActions: 3, waitingOn: [{ role: 'CRO', actions: 2 }], nextSignOff: { label: 'CRO agrees the working appetite', due: '2026-11-20' }, nextBoardDate: '2026-12-03' },
  ua: { app: 'use-assessment', stage: { label: 'Review point 5 of 7', step: 5, steps: 7 }, openActions: 1, waitingOn: [{ role: 'Model owner', actions: 1 }], nextSignOff: null, nextBoardDate: '2026-12-03' },
  bd: { app: 'board-direction', stage: { label: 'Step 7 of 10: posture', step: 7, steps: 10 }, openActions: 2, waitingOn: [{ role: 'Chair', actions: 1 }], nextSignOff: { label: 'Board resolution', due: '2026-11-27' }, nextBoardDate: '2026-11-27' },
  ce: { app: 'confidentiality', stage: { label: 'Findings drafted', step: 3, steps: 5 }, openActions: 0, waitingOn: [], nextSignOff: { label: 'GC signs the findings', due: '2026-11-14' }, nextBoardDate: null },
};
export class StatusService extends WorkerEntrypoint {
  async status() {
    const s = STAGES[this.env.STUB_STAGE];
    if (!s) throw new TypeError('The RPC receiver does not implement the method "status".');
    // An extra field the hub must drop.
    return { format: 'triodian.status.v1', generated: new Date().toISOString(), lastActivity: '2026-11-08', people: ['should not appear'], ...s };
  }
}
export default { fetch: () => new Response('stub app') };
