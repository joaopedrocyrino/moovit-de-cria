#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
DEPLOY_PATH=$1
release_id=$2
export APP_IMAGE=$3 APP_HOSTNAME=$4
caddy_container=$5
registry_user=$6
for binary in docker python3 flock curl; do command -v "$binary" >/dev/null; done
exec 9>"$DEPLOY_PATH/.deploy.lock"
flock -w 1200 9
release="$DEPLOY_PATH/releases/$release_id"
mkdir -p "$release"
tar -xzf "$DEPLOY_PATH/incoming/$release_id/release.tar.gz" -C "$release"
python3 - "$DEPLOY_PATH/.env" <<'CHECK'
from pathlib import Path
import os,stat,sys
p=Path(sys.argv[1])
if p.is_symlink() or not p.is_file():sys.exit('Create the droplet-owned .env first.')
if p.stat().st_uid!=os.geteuid() or stat.S_IMODE(p.stat().st_mode)!=0o600:sys.exit('.env must belong to the deploy user and have mode 0600.')
CHECK
TRUSTED_PROXY_IP=$(docker inspect --format '{{with index .NetworkSettings.Networks "proxy"}}{{.IPAddress}}{{end}}' "$caddy_container")
[[ "$TRUSTED_PROXY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'The shared Caddy container needs an IPv4 address on proxy.' >&2; exit 1; }
export TRUSTED_PROXY_IP
registry=$(mktemp -d "$DEPLOY_PATH/.registry-XXXXXX")
export DOCKER_CONFIG="$registry"
trap 'rm -rf -- "$registry"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$registry_user" --password-stdin
unset GHCR_TOKEN
compose() { docker compose -p moovit-de-cria --env-file "$DEPLOY_PATH/.env" -f "$release/docker-compose.prod.yml" "$@"; }
previous=$(readlink -f "$DEPLOY_PATH/current" 2>/dev/null || true)
replaced=false
rollback() {
 local status=$?
 trap - ERR
 echo "Deployment failed (exit $status)."
 if [[ "$replaced" == true ]]; then
  if [[ -n "$previous" && -f "$previous/image" ]]; then
   APP_IMAGE=$(cat "$previous/image");export APP_IMAGE
   docker compose -p moovit-de-cria --env-file "$DEPLOY_PATH/.env" -f "$previous/docker-compose.prod.yml" up -d --no-deps --pull never app || true
  else compose stop app || true; fi
 fi
 exit "$status"
}
trap rollback ERR
printf 'Stage: image-pull.\n'
compose --profile tools pull app import
# Existing snapshots remain intact on an unsuccessful import. Import is a one-off job, not an idle service.
printf 'Stage: installing GTFS snapshot prepared in GitHub Actions.\n'
# The install copies/validates SQLite, without retaining the full timetable in
# Python memory. Manual refresh keeps the server's configured import limit.
IMPORT_MEMORY_LIMIT=64m compose --profile tools run --rm --no-deps import
replaced=true
printf 'Stage: application-start.\n'
compose up -d --no-deps --pull never app
ready=false
printf 'Stage: HTTPS readiness.\n'
for _attempt in $(seq 1 30); do
 if curl --silent --fail --connect-timeout 3 --max-time 5 --resolve "$APP_HOSTNAME:443:127.0.0.1" "https://$APP_HOSTNAME/api/health/ready" >/dev/null; then ready=true; break; fi
 sleep 3
done
[[ "$ready" == true ]] || { echo 'HTTPS readiness failed; inspect the app and shared Caddy logs.' >&2; false; }
printf '%s\n' "$APP_IMAGE" > "$release/image"
cp "$release/scripts/refresh-data.sh" "$release/refresh-data.sh"
ln -sfn "$release" "$DEPLOY_PATH/current"
printf 'Deployed: https://%s\n' "$APP_HOSTNAME"
