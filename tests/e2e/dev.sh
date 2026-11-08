#!/bin/sh
# The hub with three fictional clients, each app a stub StatusService (tests/e2e/stub-app.js), at http://localhost:8790/.
# Signs you in as partner@kestrel.example.com through LOCAL_DEV_USER, which the hub honours only on localhost.
cd "$(dirname "$0")" || exit 1
set -- -c wrangler.hub.json
for f in stub-*.json; do set -- "$@" -c "$f"; done
exec npx --yes wrangler@4 dev "$@" --port 8790
