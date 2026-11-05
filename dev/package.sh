#!/usr/bin/env bash
# Builds the release zip, dist/dji-thermal-<version>.zip (the version from dji-thermal/manifest.json), from the committed
# files of dji-thermal/ with LICENSE added, without the tests and with the React parts built (public/build), and
# prints its sha256 for WebODM-Plugins' directory.json. Commit first: uncommitted changes are not in the zip. Needs the
# dev stack up (dev/webodm.sh up). DT_ZIP=<path> writes it there instead (a zip for a check, leaving dist/ as it is).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

version="$(python3 -c 'import json; print(json.load(open("dji-thermal/manifest.json"))["version"])')"
zip="${DT_ZIP:-$repo/dist/dji-thermal-$version.zip}"
if [ -n "$(git status --porcelain -- dji-thermal LICENSE)" ]; then
    echo "dji-thermal/ or LICENSE has uncommitted changes: commit them first" >&2
    exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The single root folder WebODM expects; the tests stay out (public/ is served to browsers)
git archive HEAD dji-thermal LICENSE | tar -x -C "$work"
mv "$work/LICENSE" "$work/dji-thermal/LICENSE"
rm -rf "$work/dji-thermal/tests" "$work/dji-thermal/public/__tests__"

# The React parts (plugin.py's build_jsx_components), built by WebODM's webpack in the dev container: WebODM's native
# Windows installer has no webpack, and WebODM skips its own build when public/build is there. Built against the dev
# container's WebODM, in a folder of its own, so the dev server's public/build is left alone.
if ! docker exec dt-webapp test -f /webodm/coreplugins/dji-thermal/public/webpack.config.js; then
    echo "The dev container (dt-webapp) is not running, or has not generated dji-thermal's webpack.config.js:" \
         "start it with dev/webodm.sh up" >&2
    exit 1
fi
webodm_version="$(docker exec dt-webapp python3 -c 'import json; print(json.load(open("/webodm/package.json"))["version"])')"
build_tmp="/tmp/dji-thermal-release-build"
docker exec dt-webapp rm -rf "$build_tmp"
docker exec -w /webodm/coreplugins/dji-thermal/public dt-webapp webpack-cli --output-path "$build_tmp" >/dev/null
docker cp -q "dt-webapp:$build_tmp" "$work/dji-thermal/public/build"
docker exec dt-webapp rm -rf "$build_tmp"

mkdir -p "$(dirname "$zip")"
rm -f "$zip"
# Python's zipfile, so that no zip tool is needed; folders first, sorted, as unzip lists them
python3 - "$work" "$zip" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for folder, dirs, files in sorted(os.walk(os.path.join(root, "dji-thermal"))):
        dirs.sort()
        z.write(folder, os.path.relpath(folder, root))
        for name in sorted(files):
            path = os.path.join(folder, name)
            z.write(path, os.path.relpath(path, root))
PY
echo "$zip"
unzip -l "$zip" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
echo "public/build: built against WebODM $webodm_version"
echo "sha256: $(sha256sum "$zip" | cut -d' ' -f1)"
