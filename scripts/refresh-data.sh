#!/usr/bin/env bash
set -euo pipefail
umask 077
deploy_path=${1:-/opt/moovit-de-cria}
exec 9>"$deploy_path/.deploy.lock"
flock -w 1200 9
release=$(readlink -f "$deploy_path/current")
export APP_IMAGE
APP_IMAGE=$(cat "$release/image")
export TRUSTED_PROXY_IP
TRUSTED_PROXY_IP=$(docker inspect --format '{{with index .NetworkSettings.Networks "moovit-de-cria_origin"}}{{.IPAddress}}{{end}}' moovit-de-cria-tunnel-1)
[[ "$TRUSTED_PROXY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Start the Cloudflare Tunnel connector before refreshing.' >&2; exit 1; }
# Explicit manual refresh still downloads/processes the configured feed.
docker compose -p moovit-de-cria --env-file "$deploy_path/.env" -f "$release/docker-compose.prod.yml" --profile tools run --rm --no-deps --pull never import --output /data/transit.sqlite
