# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub: open the **Security** tab of this repository and choose
**Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it, and what it could let someone do. We will acknowledge the report, keep you
informed while we fix it, and credit you when the fix is published, unless you would rather not be named.

## Supported versions

Only the latest `main` is supported.

## Scope

In scope: this repository's code and its default configuration. Out of scope: deployments run by others, denial of
service by volume, and findings that need an already compromised Cloudflare account or practice administrator.

## How the hub keeps clients apart

- Each client has its own Workers, its own D1 databases and its own sign-in, on its own subdomain
  (`<app>.<client>.<practice domain>`), so a sign-in cookie for one client is not sent to another.
- The hub holds no client data. It reads a status from each app over a service binding when the page loads and stores
  nothing. The status format (`triodian.status.v1`) carries stage, counts, roles and dates only; the hub drops any
  other field an app sends, so names, positions and findings cannot reach it.
- The hub is behind Cloudflare Access (the practice administrators by email) and checks the signed-in email against
  `HUB_ADMINS` itself as well. It has no `workers.dev` or preview URL, and sends a strict Content Security Policy.
- Secrets are never kept in this repository. The tools read the Cloudflare API token from the environment and do not
  write it anywhere.
