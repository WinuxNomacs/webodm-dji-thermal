#!/usr/bin/env bash
# The WebODM checkout in ignored/WebODM, in dev mode, with this repo's plugin mounted (see dev/compose.yml).
#   dev/webodm.sh up | down | logs [service] | ps | <any docker compose command>
# Port 8002 (WO_PORT), livereload 35731 (DT_LIVERELOAD_PORT); containers dt-webapp, dt-worker, dt-db, ...
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
webodm="$repo/ignored/WebODM"

export WO_PORT="${WO_PORT:-8002}" DT_LIVERELOAD_PORT="${DT_LIVERELOAD_PORT:-35731}"
export WO_HOST=localhost WO_DEBUG=YES WO_DEV=YES WO_BROKER=redis://broker WO_DEFAULT_NODES=1
export WO_MEDIA_DIR=appmedia WO_DB_DIR=dbdata WO_SECRET_KEY="${WO_SECRET_KEY:-}"
# DT_PLUGIN_DIR=<empty dir> runs WebODM without the mounted plugin (the release check installs the zip instead)
export DT_PLUGIN_DIR="${DT_PLUGIN_DIR:-$repo/dji-thermal}"

compose=(docker compose -p webodm-dji-thermal --project-directory "$webodm"
         -f "$webodm/docker-compose.yml" -f "$webodm/docker-compose.nodeodm.yml"
         -f "$webodm/docker-compose.dev.yml" -f "$repo/dev/compose.yml")

case "${1:-}" in
    up) shift; exec "${compose[@]}" up -d "$@" ;;
    down) shift; exec "${compose[@]}" down --remove-orphans "$@" ;;
    logs) shift; exec "${compose[@]}" logs -f --tail 100 "$@" ;;
    "") sed -n '2,4p' "$0"; exit 1 ;;
    *) exec "${compose[@]}" "$@" ;;
esac
