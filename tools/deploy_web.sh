#!/bin/bash
# Build and deploy the browser-only editor to occhiphoto.com/vlp/.
#
#   tools/deploy_web.sh            build, then deploy
#   tools/deploy_web.sh --dry-run  build only
#
# The Cloudflare API token lives in ~/.cloudflare/vlp-deploy-token (chmod 600) and is never printed.
# Scope, per Verona: Workers Scripts Edit (account) + Workers Routes Edit (occhiphoto.com).
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON=~/vocal-analyzer/.venv/bin/python
TOKEN_FILE=~/.cloudflare/vlp-deploy-token
export CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id

"$PYTHON" tools/gen_spec.py
"$PYTHON" tools/build_web.py
./run_tests.sh            # the Python side, including the spec.json staleness guard
node --test "web/test/*.test.mjs"

if [ "${1:-}" = "--dry-run" ]; then
  echo "Built only; nothing deployed."
  exit 0
fi

if [ ! -f "$TOKEN_FILE" ]; then
  echo "No API token at $TOKEN_FILE. Verona creates it; move it here first." >&2
  exit 1
fi
CLOUDFLARE_API_TOKEN="$(cat "$TOKEN_FILE")"
export CLOUDFLARE_API_TOKEN

cd web
npx --yes wrangler deploy

cat <<'NOTE'

Deployed to https://occhiphoto.com/vlp/ (behind Cloudflare Access: a plain curl gets a 302 to the Access login).
NOTE
