// What the suite covers, and help and support (development plan task BP.7): the hub page says what the suite covers
// and links the runbook, the baselines, adding a jurisdiction, the security answers, the privacy notice and support.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
test('the hub page says what the suite covers', () => {
  assert.match(html, /<h2 id="g1">What the suite covers<\/h2>/);
  for (const t of ['Best-practice baselines for any jurisdiction', 'accountable authority', 'Four controls in every baseline', 'A client in another jurisdiction'])
    assert.ok(html.includes(t), t);
});
test('the hub page links help and support', () => {
  for (const href of ['docs/runbook.md', 'docs/baselines.md', 'docs/adding-a-jurisdiction.md', 'docs/security-answers.md', 'docs/privacy.md', 'https://triodian.com/support-the-project'])
    assert.ok(html.includes(href), href);
});
test('the guide carries no script and no inline style, so the page CSP still holds', () => {
  const g = html.slice(html.indexOf('id="guide"'), html.indexOf('</section>', html.indexOf('id="guide"')));
  assert.ok(!/<script|style="/.test(g));
});
