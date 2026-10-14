#!/usr/bin/env bash
# Writes, as JSON for `wrangler deploy --secrets-file`, the secrets a deploy of Worker $1 has to add,
# so they go live with its code. The Preview workflow runs it; scripts/preview-secrets.test.ts runs
# it against a stand-in wrangler.
#
#   EMBER_SETUP_TOKEN=<optional> bash scripts/preview-secrets.sh <worker name> <secrets file>
#
# Sessions are stored keyed with SESSION_SECRET, so changing it would sign everyone out: the first
# deploy makes one and later ones keep it. EMBER_SETUP_TOKEN is the one given, or, without one, a
# first deploy makes one nobody knows, which keeps setup locked until it's given. Nothing here
# prints a secret except to GitHub's ::add-mask::, which keeps it out of the run's logs.
set -euo pipefail

worker=$1
secrets_file=$2
setup_token=${EMBER_SETUP_TOKEN:-}

if [ -n "$setup_token" ] && ! [[ "$setup_token" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error::EMBER_SETUP_TOKEN must be 64 lowercase hex characters (openssl rand -hex 32)"
  exit 1
fi

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
if [ -z "$setup_token" ] && missing EMBER_SETUP_TOKEN; then setup_token=$(openssl rand -hex 32); fi
for secret in "$session_secret" "$setup_token"; do
  if [ -n "$secret" ]; then echo "::add-mask::$secret"; fi
done

(umask 077 && SESSION_SECRET="$session_secret" SETUP_TOKEN="$setup_token" jq -n \
  '{SESSION_SECRET: env.SESSION_SECRET, EMBER_SETUP_TOKEN: env.SETUP_TOKEN} | with_entries(select(.value != ""))' > "$secrets_file")
