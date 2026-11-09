# Practice hub

For an adviser who runs the Triodian app suite for several clients: a law firm, a board adviser or a fractional GC.

- **Provisioning** (`tools/provision-client.mjs`). One command stands up a client's apps in the practice's Cloudflare
  account: its own D1 databases, sign-in, configuration and deployment, with the client's administrator ready to
  sign in. A second run with the same answers changes nothing; a run after an app update deploys only what changed.
- **The hub** (`src/worker.js`, `public/`). A small Worker behind Cloudflare Access that lists the practice's clients
  and, for each app, where the engagement stands: stage, open actions, who they are waiting on, the next sign-off and
  the next board date. It holds no client content.
- **The runbook** ([docs/runbook.md](docs/runbook.md)). Provisioning, rotating keys and API tokens, changing the
  practice administrators, and closing a client: archiving its data, then destroying it.

It builds on [Triodian/triodian-install](https://github.com/Triodian/triodian-install), which writes each app's
configuration; this repo adds the per-client layout, the Cloudflare resources and the hub.

## How clients are kept apart

```
hub.<practice domain>                          the hub (practice administrators only)
<app>.<client>.<practice domain>               each client's apps, e.g. board-direction.acme.apps.firm.com.au
```

Each client has its own Workers (`<app>-<client>`), its own D1 databases (`<app>-<client>`, `triodian-identity-<client>`)
and its own email sign-in. The suite's sign-in cookie is scoped to `<client>.<practice domain>`, so it is never sent to
another client's apps, and its name is the client's own (`tri_suite_<code>`), so a suite on a parent domain
cannot shadow it. Databases are created with the location hint in `practice.json` (`oc`, Oceania, by default;
a hint, not a guarantee: see the installer's [security answers](https://github.com/Triodian/triodian-install/blob/main/docs/security-answers.md)).

The hub reads each app's status over a service binding when the page loads, and stores nothing. It keeps only the
fields of `triodian.status.v1` (below) and drops anything else, so names, positions and findings cannot reach it.

## Setting up a practice

1. Clone this repo and [triodian-install](https://github.com/Triodian/triodian-install) side by side. You need
   Node 20 or later and git.
2. Add the practice's domain to Cloudflare, and turn on Zero Trust (the free plan is enough) with the
   **One-time PIN** login method. Note the team domain (`<team>.cloudflareaccess.com`).
3. Create an API token (My Profile → API Tokens → Create custom token) with:
   Account · D1 · Edit, Account · Workers Scripts · Edit, Account · Access: Apps and Policies · Edit,
   Zone · Workers Routes · Edit (on the practice's zone).
4. Copy `practice.example.json` to `practice/practice.json` and fill it in:

   | Field | |
   |---|---|
   | `name` | The practice's name, shown on the hub |
   | `domain` | The domain the apps live under, e.g. `apps.firm.com.au` |
   | `teamDomain` | The Zero Trust team domain |
   | `admins` | Emails allowed into the hub |
   | `locationHint` | D1 location hint for new databases (default `oc`) |
   | `appsDir` | Where the app checkouts go, relative to `practice.json` (default `apps`) |
   | `hubWorker` | The hub's Worker name (default `practice-hub`) |

   `practice/` is ignored by git. It holds the client records and generated configurations, which name clients:
   keep it on the practitioner's machine, backed up, and out of any repository.

## Provisioning a client

```
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
node tools/provision-client.mjs --code acme --name "Acme Super" --apps regulated \
  --admin gc@firm.com.au --jurisdiction AU --sector AU-SUPERANNUATION
```

`--apps` is `general` (AI Board Direction and AI Confidentiality Exposure), `regulated` (all four), or a list of app
ids (`risk-appetite,use-assessment,confidentiality,board-direction`; Use Assessment brings Risk Appetite with it).
`--code` is lowercase letters, digits and hyphens. Add `--dry-run` to see every step without changing anything.
The [runbook](docs/runbook.md) has the full procedure and the checks after it.

## The status contract (for task 4.1)

Each app exports a `StatusService` entrypoint with one method, `status()`, returning:

```json
{
  "format": "triodian.status.v1",
  "app": "risk-appetite",
  "generated": "2026-11-08T09:00:00Z",
  "stage": { "label": "Decision 4 of 8: limits", "step": 4, "steps": 8 },
  "openActions": 3,
  "waitingOn": [{ "role": "CRO", "actions": 2 }],
  "nextSignOff": { "label": "CRO agrees the working appetite", "due": "2026-11-20" },
  "nextBoardDate": "2026-12-03",
  "lastActivity": "2026-11-08"
}
```

Roles, not names; counts, not content. Dates are `YYYY-MM-DD`. An app that does not export the entrypoint yet shows
as *Not reporting yet*; one that fails or takes longer than three seconds shows as *Unreachable*.

## Developing

```
npm test           # unit tests: status filter, administrator check, provisioning against a fake account
npm run dev:e2e    # the hub at http://localhost:8790 with three fictional clients (stub apps)
```

The tests need triodian-install beside this repo (or `INSTALL_DIR`). Nothing here talks to Cloudflare except the two
tools in `tools/`.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The apps record facts and the positions people take;
they are not legal advice.
