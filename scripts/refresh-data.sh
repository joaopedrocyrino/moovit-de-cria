#!/usr/bin/env bash
set -euo pipefail
umask 077
deploy_path=${1:-/opt/moovit-de-cria}
caddy_container=${2:-csl-caddy-1}
exec 9>"$deploy_path/.deploy.lock"
flock -w 1200 9
release=$(readlink -f "$deploy_path/current")
export APP_IMAGE
APP_IMAGE=$(cat "$release/image")
export TRUSTED_PROXY_IP
TRUSTED_PROXY_IP=$(docker inspect --format '{{with index .NetworkSettings.Networks "proxy"}}{{.IPAddress}}{{end}}' "$caddy_container")
[[ "$TRUSTED_PROXY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'The shared Caddy container needs an IPv4 address on proxy.' >&2; exit 1; }
# Explicit manual refresh still downloads/processes the configured feed.
docker compose -p moovit-de-cria --env-file "$deploy_path/.env" -f "$release/docker-compose.prod.yml" --profile tools run --rm --no-deps --pull never import --output /data/transit.sqlite
