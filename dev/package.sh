#!/usr/bin/env bash
# Builds the release zip, dist/dji-thermal-<version>.zip (the version from dji-thermal/manifest.json), from the committed
# files of dji-thermal/ with LICENSE added and without the tests, and prints its sha256 for WebODM-Plugins'
# directory.json. Commit first: uncommitted changes are not in the zip.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

version="$(python3 -c 'import json; print(json.load(open("dji-thermal/manifest.json"))["version"])')"
zip="dist/dji-thermal-$version.zip"
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

mkdir -p dist
rm -f "$zip"
# Python's zipfile, so that no zip tool is needed; folders first, sorted, as unzip lists them
python3 - "$work" "$repo/$zip" <<'PY'
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
echo "sha256: $(sha256sum "$zip" | cut -d' ' -f1)"
