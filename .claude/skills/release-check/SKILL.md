---
name: release-check
description: Check a release of the DJI Thermal plugin before merging its release/X.Y.Z branch - build the zip, install it in WebODM through Administration > Plugins as a user would, and check it live.
---

# Release check

On the `release/X.Y.Z` branch, with the version in `dji-thermal/manifest.json`, `CHANGELOG.md` and `README.md` updated
and committed.

1. **The tests** (the `test` skill), including WebODM's `app.tests.test_plugins`.
2. **The zip:** `dev/package.sh`. Check its listing: one root folder `dji-thermal/` with `manifest.json`, `plugin.py`,
   `LICENSE`; no `tests/`, `public/__tests__/`, `node_modules` or `__pycache__`. Note the sha256.
3. **WebODM without the mounted plugin:** `DT_PLUGIN_DIR=<an empty folder in the scratchpad> dev/webodm.sh up -d
   --force-recreate webapp worker`, and wait for http://localhost:8002 to answer. The plugin is gone from Administration > Plugins.
4. **Install the zip as a user would:** log in as the dev admin (the `live-check` skill), Administration >
   Plugins, upload the zip with its sha256 (WebODM checks it). Restart the webapp if WebODM asks to. Check
   that pip installed its requirements in the plugin's site-packages
   (`docker exec dt-webapp ls /webodm/app/media/plugins/dji-thermal/site-packages`: dji-thermal-cli, with numpy
   and Pillow at WebODM's own versions), that WebODM ran npm in the installed copy if it has npm packages, and
   that the plugin is back.
5. **Live check on the installed copy** (the `live-check` skill): a thermal task from DJI R-JPEGs, uploaded,
   converted and processed, with temperatures in the result. Delete what the check made.
6. **Leave it as found:** remove the installed plugin in Administration > Plugins (its data store stays, shared
   with the mounted copy), then `dev/webodm.sh up -d --force-recreate webapp worker` without `DT_PLUGIN_DIR` to
   mount `dji-thermal/` again.

Then merge the release branch into `main` and tell the user: the zip and its sha256, the tag to make
(`vX.Y.Z`), where to attach the zip (the GitHub release), and the `directory.json` entry for WebODM-Plugins.
