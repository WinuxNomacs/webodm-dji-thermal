---
name: release-check
description: Check a release of the DJI Thermal plugin before merging its release/X.Y.Z branch - build the zip, install it in WebODM through Administration > Plugins as a user would, and check it live.
---

# Release check

On the `release/X.Y.Z` branch, with the version in `dji-thermal/manifest.json`, `CHANGELOG.md` and `README.md` updated
and committed.

1. **The tests** (the `test` skill), including WebODM's `app.tests.test_plugins`.
2. **The zip:** `dev/package.sh` (the dev stack up: it builds `public/build` in `dt-webapp`). Check its listing: one
   root folder `dji-thermal/` with `manifest.json`, `plugin.py`, `LICENSE` and `public/build/` (`ThermalTaskButton.js`,
   `Leaflet.js` and their CSS), built against the WebODM version it prints; no `tests/`, `public/__tests__/`,
   `node_modules` or `__pycache__`. Note the sha256.
3. **WebODM without the mounted plugin:** `DT_PLUGIN_DIR=<an empty folder in the scratchpad> dev/webodm.sh up -d
   --force-recreate webapp worker`, and wait for http://localhost:8002 to answer. The plugin is gone from Administration > Plugins.
   Set aside the mounted copy's folder in WebODM's media (its pip installs), as a fresh WebODM has none and WebODM
   refuses an upload over it: `docker exec dt-webapp mv /webodm/app/media/plugins/dji-thermal
   /webodm/app/media/plugins/.dji-thermal-mounted`.
4. **Install the zip as a user would** (WebODM's log shows no "Running webpack for dji-thermal": the built files
   are used): log in as the dev admin (the `live-check` skill), Administration >
   Plugins > Load Plugin (.zip), upload the zip (only the plugin list sends a sha256). Restart the webapp if WebODM
   asks to. Check
   that pip installed its requirements in the plugin's site-packages
   (`docker exec dt-webapp ls /webodm/app/media/plugins/dji-thermal/site-packages`: dji-thermal-cli, with numpy
   and Pillow at WebODM's own versions), that WebODM ran npm in the installed copy if it has npm packages, and
   that the plugin is back.
5. **Live check on the installed copy** (the `live-check` skill): a thermal task from DJI R-JPEGs, uploaded,
   converted and processed, with temperatures in the result; and in the Thermal Analyzer a dataset analyzed,
   converted with mosaics shown in the viewer, and a task created from the conversion, given a node and processed.
   Use the M4T flight's first 40 thermal frames (its first 20 give OpenSfM no reconstructable pair). Delete what the
   check made (a project of its own, deleted).
6. **Leave it as found:** remove the installed plugin in Administration > Plugins (its data store stays, shared
   with the mounted copy), move `.dji-thermal-mounted` back to `dji-thermal`, then `dev/webodm.sh up -d
   --force-recreate webapp worker` without `DT_PLUGIN_DIR` to mount `dji-thermal/` again.

Then merge the release branch into `main` and tell the user: the zip and its sha256, the tag to make
(`vX.Y.Z`), where to attach the zip (the GitHub release), and the `directory.json` entry for WebODM-Plugins.
