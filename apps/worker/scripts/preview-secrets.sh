#!/usr/bin/env bash
# Writes, as JSON for `wrangler deploy --secrets-file`, the secrets a deploy of Worker $1 has to add,
# so they go live with its code. The Preview workflow runs it; scripts/preview-secrets.test.ts runs
# it against a stand-in wrangler.
#
#   bash scripts/preview-secrets.sh <worker name> <secrets file>
#
# Sessions are stored keyed with SESSION_SECRET, so changing it would sign everyone out: the first
# deploy makes one and later ones keep it. Browsers subscribe to push notifications with
# VAPID_PUBLIC_KEY, so the first deploy makes a VAPID key pair too (scripts/vapid-keys.ts), and later
# ones keep it. Nothing here prints a secret except to GitHub's ::add-mask::, which keeps it out of
# the run's logs.
set -euo pipefail

worker=$1
secrets_file=$2

# Failing to list the secrets, other than because there's no Worker yet, stops here rather than
# replacing ones that may be there.
errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
if listed=$(pnpm exec wrangler secret list --name "$worker" 2> "$errors"); then
  names=$(jq -c 'map(.name)' <<< "$listed")
elif grep -qF "Worker \"$worker\" not found" "$errors" || grep -qF "Worker \"$worker\" not found" <<< "$listed"; then
  names='[]'
else
  cat "$errors" >&2
  exit 1
fi
missing() { jq -e --arg name "$1" 'all(.[]; . != $name)' <<< "$names" > /dev/null; }

session_secret=""
if missing SESSION_SECRET; then session_secret=$(openssl rand -hex 32); fi
# A Worker with only one of the pair keeps it, and says in /api/health why push is off.
vapid_public="" vapid_private=""
if missing VAPID_PUBLIC_KEY && missing VAPID_PRIVATE_KEY; then
  vapid_keys=$(node "$(dirname "$0")/vapid-keys.ts")
  vapid_public=$(sed -n 's/^VAPID_PUBLIC_KEY=//p' <<< "$vapid_keys")
  vapid_private=$(sed -n 's/^VAPID_PRIVATE_KEY=//p' <<< "$vapid_keys")
fi
for secret in "$session_secret" "$vapid_private"; do
  if [ -n "$secret" ]; then echo "::add-mask::$secret"; fi
done

(umask 077 && SESSION_SECRET="$session_secret" VAPID_PUBLIC="$vapid_public" VAPID_PRIVATE="$vapid_private" jq -n \
  '{SESSION_SECRET: env.SESSION_SECRET, VAPID_PUBLIC_KEY: env.VAPID_PUBLIC, VAPID_PRIVATE_KEY: env.VAPID_PRIVATE}
    | with_entries(select(.value != ""))' > "$secrets_file")
