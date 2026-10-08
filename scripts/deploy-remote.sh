#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
DEPLOY_PATH=$1
release_id=$2
export APP_IMAGE=$3 APP_HOSTNAME=$4 API_HOSTNAME=$5
registry_user=$6
for binary in docker flock curl stat; do command -v "$binary" >/dev/null; done
exec 9>"$DEPLOY_PATH/.deploy.lock"
flock -w 1200 9
release="$DEPLOY_PATH/releases/$release_id"
mkdir -p "$release"
tar -xzf "$DEPLOY_PATH/incoming/$release_id/release.tar.gz" -C "$release"
env_file="$DEPLOY_PATH/.env"
[[ -f "$env_file" && ! -L "$env_file" ]] || { echo 'Create the droplet-owned .env first.' >&2; exit 1; }
[[ "$(stat -c %u "$env_file")" == "$EUID" && "$(stat -c %a "$env_file")" == 600 ]] || { echo '.env must belong to the deploy user and have mode 0600.' >&2; exit 1; }
registry=$(mktemp -d "$DEPLOY_PATH/.registry-XXXXXX")
export DOCKER_CONFIG="$registry"
trap 'rm -rf -- "$registry"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$registry_user" --password-stdin
unset GHCR_TOKEN
compose() { docker compose -p moovit-de-cria --env-file "$DEPLOY_PATH/.env" -f "$release/docker-compose.prod.yml" "$@"; }
# Check required server-owned settings before pulling or replacing anything.
compose config --quiet
previous=$(readlink -f "$DEPLOY_PATH/current" 2>/dev/null || true)
replaced=false
rollback() {
 local status=$?
 trap - ERR
 echo "Deployment failed (exit $status)."
 if [[ "$replaced" == true ]]; then
  if [[ -n "$previous" && -f "$previous/image" ]]; then
   APP_IMAGE=$(cat "$previous/image");export APP_IMAGE
   # Keep the private network even when rolling back an older API image.
   # Never restore the previous public Caddy labels or network membership.
   compose up -d --no-deps --pull never app || true
  else compose stop app || true; fi
 fi
 exit "$status"
}
trap rollback ERR
printf 'Stage: image-pull.\n'
compose --profile tools pull app import tunnel
# Existing snapshots remain intact on an unsuccessful import. Import is a one-off job, not an idle service.
printf 'Stage: installing GTFS snapshot prepared in GitHub Actions.\n'
# The install copies/validates SQLite, without retaining the full timetable in
# JavaScript memory. Manual refresh keeps the server's configured import limit.
IMPORT_MEMORY_LIMIT=64m compose --profile tools run --rm --no-deps import
printf 'Stage: Cloudflare Tunnel connector.\n'
compose up -d --no-deps --pull never tunnel
TRUSTED_PROXY_IP=$(docker inspect --format '{{with index .NetworkSettings.Networks "moovit-de-cria_origin"}}{{.IPAddress}}{{end}}' moovit-de-cria-tunnel-1)
[[ "$TRUSTED_PROXY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'The tunnel connector needs a private origin IP.' >&2; false; }
export TRUSTED_PROXY_IP
replaced=true
printf 'Stage: application-start.\n'
compose up -d --no-deps --pull never app
ready=false
printf 'Stage: local API and tunnel readiness.\n'
for _attempt in $(seq 1 30); do
 if compose exec -T app node /app/scripts/health-check.mjs http://127.0.0.1:8080/api/health/ready http://tunnel:2000/ready >/dev/null 2>&1; then ready=true; break; fi
 sleep 2
done
[[ "$ready" == true ]] || { echo 'Local API/tunnel readiness failed; inspect app and tunnel logs.' >&2; false; }
ready=false
printf 'Stage: HTTPS readiness through Cloudflare.\n'
for _attempt in $(seq 1 30); do
 if curl --silent --fail --connect-timeout 3 --max-time 5 "https://$API_HOSTNAME/api/health/ready" >/dev/null; then ready=true; break; fi
 sleep 3
done
[[ "$ready" == true ]] || { echo 'Cloudflare readiness failed; check the Tunnel published route http://app:8080 and API hostname.' >&2; false; }
printf '%s\n' "$APP_IMAGE" > "$release/image"
cp "$release/scripts/refresh-data.sh" "$release/refresh-data.sh"
ln -sfn "$release" "$DEPLOY_PATH/current"
printf 'API deployed: https://%s (frontend deployed separately to Pages).\n' "$API_HOSTNAME"
