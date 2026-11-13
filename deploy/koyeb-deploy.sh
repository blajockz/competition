#!/usr/bin/env bash
# Optional: create the Koyeb service from the command line instead of the
# dashboard. Needs the Koyeb CLI (https://www.koyeb.com/docs/cli/installation)
# and `koyeb login` done once.
#
#   ./deploy/koyeb-deploy.sh github.com/<your-user>/<your-repo> [app-name]
#
# It reads the values from .env (never commit .env) and creates one web
# service: Dockerfile build, Free instance, Frankfurt, port 8080, one instance.
set -euo pipefail

REPO="${1:-}"
APP="${2:-competition}"
if [[ -z "$REPO" ]]; then
  echo "Usage: $0 github.com/<user>/<repo> [app-name]" >&2
  exit 1
fi
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env not found (copy .env.example to .env and fill it in)" >&2; exit 1; }

ENV_ARGS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# || -z "${line// }" ]] && continue
  key="${line%%=*}"; value="${line#*=}"
  case "$key" in DOMAIN|ACME_EMAIL|PORT|HOST|DATA_DIR) continue ;; esac
  ENV_ARGS+=(--env "$key=$value")
done < .env

koyeb app init "$APP" \
  --git "$REPO" \
  --git-branch main \
  --git-builder docker \
  --instance-type free \
  --regions fra \
  --ports "8080:http" \
  --routes "/:8080" \
  --checks "8080:http:/api/health" \
  --min-scale 1 \
  --max-scale 1 \
  --env "PORT=8080" \
  --env "TRUST_PROXY=true" \
  "${ENV_ARGS[@]}"

echo
echo "Done. Follow the build with:  koyeb service logs $APP/$APP -t build"
echo "Your address will be shown in the Koyeb dashboard (https://<app>-<org>.koyeb.app)."
