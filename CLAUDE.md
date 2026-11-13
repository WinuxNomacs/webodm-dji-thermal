# CLAUDE.md

What Claude needs to know to work on the DJI Thermal Analyzer plugin for WebODM. General working rules (branches, phases,
testing) live in the user's own CLAUDE.md; this file holds what is specific to this repository. It is committed
and may be public: nothing private, nothing true only on one machine. Keep it short; edit in place.

## Rules for this repository

- **The plugin is `dji-thermal/`** (its id): the released zip has that folder as its single root. Dev tools
  (`dev/`, `package.json`, `eslint.config.mjs`, `ruff.toml`, `requirements-dev.txt`) stay outside it.
- **Official plugin rules only** (https://docs.webodm.org/plugin-development-guide): no Django models or
  migrations (data goes in the plugin's data stores), only the `PluginsAPI` hooks and server signals WebODM has,
  no changes to WebODM itself.
- **WebODM 3.3.2 and 4.0.0 both**: 3.3.2 is Python 3.9, Django 2.2, PostGIS, numpy 1.26.2, Pillow 11.3.0, rio-tiler
  installed; 4.0.0 is Python 3.14, Django 5.2, no GIS (a task's crop is GeoJSON), numpy 2.5.4, Pillow 13.0.0,
  rio-tiler only as WebODM's trimmed copy (`app.vendor.rio_tiler`). Ruff targets py39. What differs is in
  `webodm_versions.py`; shapes go through `shapes.py` (GDAL's OGR, WebODM's own; never Django's GEOS, nor a
  compiled package of the plugin's: on native Windows a DLL WebODM loaded can't be deleted, so the plugin couldn't
  be removed). WebODM installs a plugin's `requirements.txt` with `pip install -U --target`, dependencies included,
  so it pins numpy and Pillow per Python with environment markers, at each WebODM's own versions. It installs them when it loads the plugin
  and the file's md5 changed or a package's name is missing; `Plugin.check_requirements` makes it install them
  again when they were built for another Python (WebODM upgraded), and removes the old versions' `.dist-info`
  pip leaves behind.
- **Linux, Windows and macOS**: WebODM runs in Docker on all three (the plugin's Python in its Linux container; the
  macOS installer is a manager for Docker) or from its native Windows installer (the plugin's Python on Windows,
  with no node, npm or webpack). So: no POSIX-only module at import time (OS differences in `portable.py`), no
  outside tool (exiftool: dji-thermal-cli writes the TIFFs' metadata), the JSX shipped built (`dev/package.sh`
  puts `public/build` in the zip; WebODM then skips its own webpack), every dji-thermal-cli call that can start
  processes given `jobs=1` (Windows' worker can start them, but they lack the plugin's site-packages), and no Mac
  runs (plan: "Done: Linux, Windows and macOS").
- **Temperatures come from [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/)** (pure Python, AGPL),
  a separate package; a change it needs is made and released there first (its `RELEASING.md`: a `release/X.Y.Z`
  branch and its local checks; pushing its `main` runs nothing, its `vX.Y.Z` tag runs CI on three systems, then
  publishes to TestPyPI and PyPI), then pinned here exactly.
- **What applies to AI-assisted work here is the user's call**: the WebODM-Plugins guidance ("never add tests")
  and the WebODM maintainer's wishes for PRs to WebODM are raised with the user, not applied on their own. The
  plugin keeps its own tests, outside the zip.
- **Never push and never tag.** Nothing is published by a push: the repo has no GitHub workflows, and gets none
  without the user's say (Actions minutes). A release: Claude prepares a
  `release/X.Y.Z` branch (manifest version, `CHANGELOG.md`, `README.md`), builds the zip with `dev/package.sh`
  (`dist/dji-thermal-X.Y.Z.zip` and its sha256, with `public/build` built in the dev container against its WebODM), runs the `release-check` skill and merges; the user tags `vX.Y.Z`,
  attaches the zip to the GitHub release and adds `{url, sha256}` to WebODM-Plugins' `directory.json`.
- **`README.md` is the plugin's public page**: every feature change updates it on the same branch (what the
  plugin does, installing, using it, the outside services it calls).
- **`docs/` is the plugin's documentation** (Markdown, served by GitHub Pages from `main` `/docs` once the repo is
  public): quickstarts with screenshots, guides, reference. A change to what a user sees updates the page that
  describes it and retakes its screenshots on the same branch (the `docs` skill). The screenshots
  (`docs/images/*.png`, made by `dev/screenshots.js`, but for the user's `splash.png`, kept with its full-size
  `splash-source.png`) are the only images the repo takes: they never show where a
  flight was (no coordinates, addresses or basemap), nor a camera's serial number, and each is looked at before
  it is committed.
- **`docs/developing.md` is the developers' guide** (the code's map, running, testing, recipes for the usual
  additions): a change that moves what it describes (a module's job, a list a recipe names, a step) updates it on
  the same branch.
- Planned in `upcoming-changes.md`; new requests arrive in `new.md` (untracked).

## Dev environment

- `ignored/WebODM` is a checkout of https://github.com/WebODM/WebODM (ignored by git), at the commit the pinned
  image was built from (tag `v4.0.0`), and `ignored/WebODM-3.3.2` a worktree of it at `v3.3.2`
  (`git -C ignored/WebODM worktree add ../WebODM-3.3.2 v3.3.2`). The dev servers run those checkouts, so a branch
  checked out there is live. `ignored/WebODM-Docs` is https://github.com/WebODM/Docs (the plugin guide), `ignored/WebODM-Plugins` is
  https://github.com/WebODM/WebODM-Plugins (the directory and its guidance).
- `dev/webodm.sh up | down | logs [service] | ps` runs WebODM 4.0.0 in dev mode with `dji-thermal/` mounted as
  `/webodm/coreplugins/dji-thermal`, on http://localhost:8002, containers `dt-webapp`, `dt-worker`, `dt-db`,
  `dt-broker`, `dt-node-odx-1`, project and volumes `webodm-dji-thermal`, so it runs beside another WebODM (port
  8000 or 8001). `DT_WEBODM=3.3.2 dev/webodm.sh ...` runs 3.3.2 alike on http://localhost:8003, containers `dt3-*`,
  project and volumes `webodm-dji-thermal-3`. Each version's images are pinned by digest in `dev/webodm.sh` (a
  local `webodm/webodm_webapp:latest` tag may be a fork's build).
- The first start runs WebODM's dev setup (migrations, npm, webpack) for several minutes before the server
  answers.
- Host tools: `uv venv --python 3.9 .venv && uv pip install -r requirements-dev.txt` (Django, DRF, numpy, Pillow
  as on 3.3.2, for the IDE, Ruff); `npm ci` (Jest, ESLint, Playwright). VSCode: interpreter `.venv`, `ignored/WebODM` on
  Pylance's extra paths (local `.vscode/settings.json`).

## Tests and checks

The `test`, `live-check`, `release-check` and `docs` skills in `.claude/skills` have the steps.

- Django: `docker exec -w /webodm dt-webapp python manage.py test --noinput coreplugins.dji-thermal.tests.test_converter coreplugins.dji-thermal.tests.test_api coreplugins.dji-thermal.tests.test_sdk coreplugins.dji-thermal.tests.test_analyzer coreplugins.dji-thermal.tests.test_inspector coreplugins.dji-thermal.tests.test_frames coreplugins.dji-thermal.tests.test_model3d coreplugins.dji-thermal.tests.test_portable`. The tests'
  images come from `DT_SAMPLES_DIR` and `DT_FLIGHT_DIR`, DJI's SDK zip from `DT_SDK_ZIP` (`.env`, untracked);
  never commit an image (but the docs' screenshots) or DJI's files. Each run installs `requirements.txt` afresh in WebODM's test media
  folder, so the tests use the pinned dji-thermal-cli. They run in `dt-webapp` (4.0.0) and, before a merge, in
  `dt3-webapp` (3.3.2) too. One run at a time per stack: a stack's runs share its test database (the two stacks'
  are separate).
- Jest: `npm test` at the repo root (jsdom, babel-jest; Babel's settings in `package.json`). ESLint: `npm run lint
  -- dji-thermal` (`public/main.js` is ES5; `public/thermal/` is JSX and ES modules, built by WebODM's webpack
  into `public/build/` when the plugin is registered, with `public/webpack.config.js` generated: both untracked).
  After changing `thermal/`, rebuild in the dev container:
  `docker exec -w /webodm/coreplugins/dji-thermal/public dt-webapp webpack-cli`.
- Ruff: `.venv/bin/ruff check .`
- Live checks: headless Playwright (Node) against http://localhost:8002 with a dev account from the user, read
  only unless the check must write (the `live-check` skill). A bug in what a page draws is confirmed there, from the
  requests the page makes: the viewers and the Inspector colour temperatures in the browser (`recolour.js`), so a
  tile WebODM refuses when asked directly (4.0.0's tiler lacks `hot`, `rainbow`, `gray_r`) may never be requested.
  Switching branches here reloads the dev server; wait for `/login/` to answer before checking.
- The worker (`dt-worker`) keeps the plugin's Python as it was when it started: after changing it, it runs old code,
  and WebODM's `run_function_async` sends a function's lines from the changed file (a `KeyError` naming the
  function). Ask the user to restart it (`docker restart dt-worker`) before a check that runs jobs.
- After changing `requirements.txt`, reload the dev server (touch `dji-thermal/plugin.py`) and check the version it
  installed in `app/media/plugins/dji-thermal/site-packages` (in `dt-webapp`). Pin a version only once it is on PyPI: WebODM
  checks the installed packages by name only, so a failed install still records the file as installed
  (`site-packages/install_md5`); remove that file and reload to install again.
