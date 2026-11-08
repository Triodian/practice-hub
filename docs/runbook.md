# Practice runbook

For the person who runs the Triodian apps for a practice's clients. Every command runs from the `practice-hub`
folder, with `triodian-install` checked out beside it, and needs the practice's Cloudflare details in the shell:

```
export CLOUDFLARE_API_TOKEN=...     # from the password manager; never written to a file
export CLOUDFLARE_ACCOUNT_ID=...
```

Both tools take `--dry-run`, which prints every step and changes nothing in Cloudflare. Use it first whenever you
are unsure.

Contents: [1. Provisioning a client](#1-provisioning-a-client) ·
[2. Updating the apps](#2-updating-the-apps) ·
[3. Rotating keys and API tokens](#3-rotating-keys-and-api-tokens) ·
[4. Changing who can see the hub](#4-changing-who-can-see-the-hub) ·
[5. Closing a client](#5-closing-a-client) ·
[6. When something goes wrong](#6-when-something-goes-wrong)

---

## 1. Provisioning a client

**Before you start**

- The engagement letter is signed and says where the client's data is held (see the installer's
  [security answers](https://github.com/Triodian/triodian-install/blob/main/docs/security-answers.md) for the
  wording on location hints).
- You have chosen a client code: short, lowercase, not the client's full name if the engagement is confidential
  (it appears in hostnames, which are public in certificate logs). For example `acme` or `c014`.
- You know the client's first administrator (usually their GC or company secretary) and, for a regulated
  client, its jurisdiction and sector.

**Run**

```
node tools/provision-client.mjs --code c014 --name "Acme Super" --apps regulated \
  --admin gc@acme.com.au --jurisdiction AU --sector AU-SUPERANNUATION
```

`--apps general` gives AI Board Direction and AI Confidentiality Exposure; `--apps regulated` gives all four. The
command, in order:

1. fetches or updates each app from GitHub into `practice/apps/`;
2. creates the client's D1 databases (one per app, plus `triodian-identity-<code>`) with the practice's location hint;
3. writes each app's configuration (`practice/apps/<app>/wrangler.<code>.json`) through the installer;
4. creates an email sign-in (Cloudflare Access, one-time PIN) on each app's `/auth/email`, and sets the app's
   `ACCESS_AUD` secret from it;
5. deploys the apps, Risk Appetite first so Use Assessment can bind to it;
6. saves the client record (`practice/clients/<code>.json`) and redeploys the hub with the client added.

It ends by listing the app addresses. Certificates for new hostnames can take a few minutes.

**Check**

- [ ] Run the same command again. It must say *Nothing changed*. If it changes something, stop and find out why.
- [ ] Before the client's administrator signs in, open one app address in a private window, sign in with your own
      email and confirm you are **refused**: the apps admit only their own active users (your attempt shows in the
      app's access requests).
- [ ] Ask the client's administrator to sign in. They should land in Admin and be able to add their people.
- [ ] Open the hub. The client appears; each app shows a stage or *Not reporting yet* (an app version before task
      4.1). *Unreachable* means the deployment failed: see section 6.
- [ ] Back up `practice/` (it holds the client records and is not in git).

## 2. Updating the apps

Run the provisioning command again for each client, with the same answers. It pulls each app's `main`, and deploys
only the apps whose code or configuration changed. Run it for one client first, check that client, then the rest.

To see what would change without deploying, add `--dry-run`.

## 3. Rotating keys and API tokens

| What | Where it lives | How often | How |
|---|---|---|---|
| Cloudflare API token | Your password manager and the shell, nowhere else | Every 90 days, when someone leaves, or on any suspicion | 3.1 |
| Access signing keys | Cloudflare | Cloudflare rotates them; rotate yourself on suspicion | 3.2 |
| An app's `ACCESS_AUD` | A Worker secret on each app | On suspicion, or if the Access application was changed by hand | 3.3 |
| Sign-in sessions | The client's identity database (hashed) | When a person leaves the client, or on suspicion | 3.4 |

### 3.1 The Cloudflare API token

1. In Cloudflare, My Profile → API Tokens → *Create custom token* with the permissions in the README. Give it an
   expiry date and, if your office has fixed addresses, an IP filter.
2. Put it in the password manager and in your shell, then run any provisioning command with `--dry-run` to check it
   works (it reads the account).
3. Roll or delete the old token in the same page.

The token is never stored by these tools, so nothing else needs changing. If a token may have leaked, delete it
first and check the account's audit log (Manage Account → Audit Log) for changes you did not make.

### 3.2 Access signing keys

Zero Trust → Settings → Authentication, or the API (`POST /accounts/<id>/access/keys/rotate`). The apps read the
current keys from the team domain and fetch them again when they meet a new key, so nothing else changes. Everyone
signs in again.

### 3.3 An app's ACCESS_AUD

Each app's email sign-in is an Access application with its own audience tag (AUD), which the app checks. To rotate it,
delete that Access application (Zero Trust → Access → Applications, named *<App> (<code>) sign-in*), then run the
provisioning command for the client again. It creates a new application and sets the new `ACCESS_AUD` on that app;
nothing else changes. Sign-in to that app fails for the minute in between.

### 3.4 Sign-in sessions

Removing a person in the app's Admin stops them signing in again. To end every current session for a client at once
(everyone signs in again):

```
npx wrangler@4 d1 execute triodian-identity-<code> --remote --command "DELETE FROM sessions"
```

## 4. Changing who can see the hub

Edit `admins` in `practice/practice.json`, then run the provisioning command for any one client. It updates the
hub's Access policy and the hub's own check (`HUB_ADMINS`) together, and changes nothing at the clients. The hub
checks the signed-in email itself as well as through Access, so a hand edit to the Access policy alone does not let
anyone in.

Who can see a client's **apps** is managed in each app's Admin, by the client's administrator, not here.

## 5. Closing a client

Closing has two stages: **archive**, which changes nothing, and **destroy**, which cannot be undone. Do them at
least a day apart, and only as the engagement letter says (return the data, keep it for a period, or destroy it).

### 5.1 Archive

```
node tools/close-client.mjs --code c014 --archive ~/Engagements/c014/archive
```

This exports every database of the client (`<database>.sql`, a full SQL dump) and its client record into the folder.
The export **is client data**: put it on encrypted storage that only the engagement team can open, and record where
it is in the engagement file.

Check it before going further:

- [ ] There is one `.sql` file per app plus `triodian-identity-<code>.sql`, none empty.
- [ ] Each file holds the tables and rows: `grep -c '^INSERT' ~/Engagements/c014/archive/*.sql` shows a count for each.
- [ ] If the client asked for its data back, also give them each app's own exports (the board pack, register and
      record exports in each app), which are readable without these tools.

### 5.2 Destroy

```
node tools/close-client.mjs --code c014 --archive ~/Engagements/c014/archive-final --destroy --confirm c014
```

`--confirm` repeats the client code. The command exports once more (so the archive matches the last state), then:

1. deletes each app's email sign-in (Access application) and Worker;
2. deletes the client's D1 databases;
3. removes the client record and redeploys the hub without the client.

Afterwards:

- [ ] The app addresses no longer answer, and the hub no longer lists the client.
- [ ] In Cloudflare, no Worker, D1 database or Access application carries the client code.
- [ ] D1's Time Travel can restore a deleted database's recent history only while the database exists; once deleted,
      Cloudflare's copies are gone under its own retention. Record the date of destruction in the engagement file.
- [ ] When the retention period in the engagement letter ends, destroy the archive and record that too.

## 6. When something goes wrong

| What you see | Likely cause | What to do |
|---|---|---|
| The command stops with a Cloudflare API error | Token lacks a permission, or has expired | Check the token's permissions against the README; run again. The run picks up where it stopped. |
| *Unreachable* on the hub for one app | Its deployment failed, or the app is erroring | Run the provisioning command for that client and read the deploy output; check the Worker's logs in Cloudflare (Workers → `<app>-<code>` → Logs). |
| *Not reporting yet* | The app's version predates the status report (task 4.1) | Nothing to fix; it reports once the app is updated (section 2). |
| A client's administrator cannot sign in | Their email differs from `--admin`, or the one-time PIN went to spam | Check the email. If no administrator has signed in yet, rerun with the corrected `--admin`. Once one has, they add others in Admin; `--admin` no longer applies. |
| A second run keeps redeploying an app | Its checkout has local changes, or the app's `main` moved | `git -C practice/apps/<app> status`; discard local changes. |
| You ran `--destroy` by mistake | | The archive from the same run is complete. Provision the client again with the same code and, **before anyone opens the apps** (they create their tables on first use), load each file: `npx wrangler@4 d1 execute <database> --remote --file <file>`. |
