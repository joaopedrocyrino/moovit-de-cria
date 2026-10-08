#!/usr/bin/env bash
set -euo pipefail
umask 077

DEPLOY_PATH=${DEPLOY_PATH:-/opt/moovit-de-cria}
APP_HOSTNAME=${APP_HOSTNAME:-moovit.joaocyrino.com}
API_HOSTNAME=${API_HOSTNAME:-moovit-api.joaocyrino.com}

for required in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_SSH_KNOWN_HOSTS DEPLOY_PATH APP_HOSTNAME APP_IMAGE RELEASE_SHA GHCR_USERNAME GHCR_TOKEN API_HOSTNAME; do
  [[ -n "${!required:-}" ]] || { printf 'Missing production setting: %s\n' "$required" >&2; exit 1; }
done
DEPLOY_PORT=${DEPLOY_PORT:-22}
# Required variables were validated through indirect expansion above.
# shellcheck disable=SC2153
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$DEPLOY_PORT > 0 && 10#$DEPLOY_PORT <= 65535))
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9_/-]+$ && "$DEPLOY_PATH" != / && "$DEPLOY_PATH" != /opt ]]
[[ "$APP_HOSTNAME" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ && "$API_HOSTNAME" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]]
[[ "$APP_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ && "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$GHCR_USERNAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]]

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$work/deploy_key"
printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" > "$work/known_hosts"
ssh_options=(-i "$work/deploy_key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
destination="$DEPLOY_USER@$DEPLOY_HOST"
incoming="${RELEASE_SHA}-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
[[ "$incoming" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
remote_dir="$DEPLOY_PATH/incoming/$incoming"

# Configuration and provisioning code only: no .env or source credentials.
tar -czf "$work/release.tar.gz" docker-compose.prod.yml scripts/refresh-data.sh
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$destination" "umask 077; mkdir -p '$remote_dir'"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" "$work/release.tar.gz" "$destination:$remote_dir/release.tar.gz"

# The token goes through encrypted stdin, never SSH arguments or a remote token file.
# Buffer the script before executing so Docker commands cannot consume script stdin.
# The quoted program expands on the remote host.
# shellcheck disable=SC2016
remote_command=$(node scripts/shell-quote.mjs bash -c \
  'set -e; umask 077; IFS= read -r GHCR_TOKEN; export GHCR_TOKEN; runner=$(mktemp); trap '\''rm -f -- "$runner"'\'' EXIT; cat > "$runner"; bash "$runner" "$@"' -- \
  "$DEPLOY_PATH" "$incoming" "$APP_IMAGE" "$APP_HOSTNAME" "$API_HOSTNAME" "$GHCR_USERNAME")
if {
  printf '%s\n' "$GHCR_TOKEN"
  cat scripts/deploy-remote.sh
} | ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$destination" "$remote_command"; then
  exit 0
else
  status=$?
  if [[ "$status" == 255 ]]; then
    printf 'SSH connection lost. Deployment completion is unknown; inspect %s/current and the moovit-de-cria containers on the droplet before retrying.\n' "$DEPLOY_PATH" >&2
  fi
  exit "$status"
fi
