#!/usr/bin/env bash
# A WebODM checkout in dev mode, with this repo's plugin mounted (see dev/compose.yml).
#   [DT_WEBODM=3.3.2] dev/webodm.sh up | down | logs [service] | ps | <any docker compose command>
# WebODM 4.0.0 (the default): ignored/WebODM, port 8002, livereload 35731, containers dt-webapp, dt-worker, ...
# WebODM 3.3.2 (DT_WEBODM=3.3.2): ignored/WebODM-3.3.2 (a worktree of it), port 8003, livereload 35732, containers
# dt3-webapp, dt3-worker, ..., project and volumes webodm-dji-thermal-3: the plugin is checked on both.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"

# Each version's images, pinned by digest: a tag can be pushed again (3.3.2 was, on 2026-11-04), and a local
# `latest` tag can be another build (a fork's). Upgrading: move ignored/WebODM to the new tag, pull its images,
# move the digests here, `dev/webodm.sh up`, run the tests.
case "${DT_WEBODM:=4.0.0}" in
    4.0.0)
        webodm="$repo/ignored/WebODM" project=webodm-dji-thermal DT_PREFIX=dt port=8002 livereload=35731
        export DT_WEBAPP_IMAGE=webodm/webodm_webapp@sha256:4572838208348c189fce3bfeabd1eaa08285efd841520ff2f08460611aac14a5
        export DT_DB_IMAGE=webodm/webodm_db@sha256:6d43e32ec24c388c5d5975bf6462d21abd6959af3c43d146a2473c1db4d5019c
        export DT_BROKER_IMAGE=valkey/valkey@sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b
        export DT_NODE_IMAGE=webodm/nodeodx@sha256:f3621054cec0829ff8d94272fa4ec9138621f034135ff9a792fe309bd7d964ad ;;
    3.3.2)
        webodm="$repo/ignored/WebODM-3.3.2" project=webodm-dji-thermal-3 DT_PREFIX=dt3 port=8003 livereload=35732
        export DT_WEBAPP_IMAGE=webodm/webodm_webapp@sha256:55a1d7d1eee7c1220edfb75da2b67044ebcda1b6b61b25a369cc5c087bb47d71
        export DT_DB_IMAGE=webodm/webodm_db@sha256:03f18ec0089325ec2b8975ba1781277bcdc212b6d86c9de33f6409d313e90430
        export DT_BROKER_IMAGE=redis:7.0.10
        export DT_NODE_IMAGE=webodm/nodeodx@sha256:d75a3957076af0efbbbd03a6c6d753b29802b9f1715235b42c5d7154ba68fa55 ;;
    *) echo "DT_WEBODM: 4.0.0 or 3.3.2" >&2; exit 1 ;;
esac
if [ ! -d "$webodm" ]; then
    echo "No WebODM checkout at $webodm (CLAUDE.md, Dev environment, says how to make it)" >&2; exit 1
fi
export DT_PREFIX
export WO_PORT="${WO_PORT:-$port}" DT_LIVERELOAD_PORT="${DT_LIVERELOAD_PORT:-$livereload}"
export WO_HOST=localhost WO_DEBUG=YES WO_DEV=YES WO_BROKER=redis://broker WO_DEFAULT_NODES=1
export WO_MEDIA_DIR=appmedia WO_DB_DIR=dbdata WO_SECRET_KEY="${WO_SECRET_KEY:-}"
# DT_PLUGIN_DIR=<empty dir> runs WebODM without the mounted plugin (the release check installs the zip instead)
export DT_PLUGIN_DIR="${DT_PLUGIN_DIR:-$repo/dji-thermal}"
# The tests' images, never in git: DJI's SDK sample images (one folder per camera) and a real flight's images.
# Set in the environment or in .env (untracked); unset, an empty folder is mounted and those tests are skipped.
if [ -f "$repo/.env" ]; then set -a; . "$repo/.env"; set +a; fi
mkdir -p "$repo/dev/no-images"
export DT_SAMPLES_DIR="${DT_SAMPLES_DIR:-$repo/dev/no-images}" DT_FLIGHT_DIR="${DT_FLIGHT_DIR:-$repo/dev/no-images}"
# DJI's Thermal SDK zip as DJI's site gives it (DT_SDK_ZIP), for the tests that install it; unset, an empty file
touch "$repo/dev/no-images/no-sdk.zip"
export DT_SDK_ZIP="${DT_SDK_ZIP:-$repo/dev/no-images/no-sdk.zip}"

# The processing node is dev/compose.yml's: WebODM's own file for it was renamed in 4.0.0
compose=(docker compose -p "$project" --project-directory "$webodm"
         -f "$webodm/docker-compose.yml" -f "$webodm/docker-compose.dev.yml" -f "$repo/dev/compose.yml")

case "${1:-}" in
    # New anonymous volumes: the dev compose keeps the image's venv in one, which a new image must not reuse
    up) shift; exec "${compose[@]}" up -d --renew-anon-volumes "$@" ;;
    down) shift; exec "${compose[@]}" down --remove-orphans "$@" ;;
    logs) shift; exec "${compose[@]}" logs -f --tail 100 "$@" ;;
    "") sed -n '2,4p' "$0"; exit 1 ;;
    *) exec "${compose[@]}" "$@" ;;
esac
