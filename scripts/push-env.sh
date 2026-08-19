#!/usr/bin/env bash
# Pushes the deployment's server-side configuration to Vercel.
#
# Reads .env.deploy, which is gitignored and never committed, and sets each
# name on the linked project for the production environment. Values are never
# printed: the script echoes the name and whether it was set, and nothing else.
#
#   1. put the values in .env.deploy   (see .env.deploy.example)
#   2. bash scripts/push-env.sh
#   3. npx vercel deploy --prod --yes
#
# Only names in the list below are pushed. A stray value in the file is
# ignored rather than uploaded, so a pasted block containing unrelated
# credentials cannot leak into a deployment by accident.
set -u

FILE="${1:-.env.deploy}"
[ -f "$FILE" ] || { echo "no $FILE. Copy .env.deploy.example and fill it in."; exit 1; }

# The server needs these. Anything else in the file is skipped on purpose.
# Every variable the deployment reads, matching .env.deploy.example, which is
# itself generated from the code that consumes them. This list was missing the
# cloud credentials and the Google client, which are exactly the ones the
# production deployment cannot run without, so the documented deploy path could
# not actually configure a deployment.
ALLOWED="HYDRA_CLOUD_URL HYDRA_CLOUD_TOKEN HYDRA_DATABASE HYDRA_COLLECTION LACUNA_PROFILE HYDRA_HTTP_URL HYDRA_NAMESPACE HYDRA_GRAPH HYDRA_CELL HYDRA_TOKEN HYDRA_ALLOW_PLAINTEXT_REMOTE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET LACUNA_SITE_ORIGIN GROQ_API_KEY ANTHROPIC_API_KEY DEEPSEEK_API_KEY OLLAMA_BASE_URL VLLM_BASE_URL ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID LACUNA_SESSION_SECRET LACUNA_ACCOUNTS_DIR LACUNA_SECURE_COOKIES"

set -a
# shellcheck disable=SC1090
. "$FILE"
set +a

for name in $ALLOWED; do
  value="${!name-}"
  if [ -z "${value}" ]; then
    printf '%-24s skipped, not set\n' "$name"
    continue
  fi
  # Remove first so a re-run updates rather than duplicating.
  npx vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  if printf '%s' "$value" | npx vercel env add "$name" production >/dev/null 2>&1; then
    printf '%-24s set\n' "$name"
  else
    printf '%-24s FAILED\n' "$name"
  fi
done

echo
echo "Now redeploy so the function picks them up:"
echo "  npx vercel deploy --prod --yes"
