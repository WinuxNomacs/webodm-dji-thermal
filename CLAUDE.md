# CLAUDE.md

What Claude needs to know to work on the DJI Thermal plugin for WebODM. General working rules (branches, phases,
testing) live in the user's own CLAUDE.md; this file holds what is specific to this repository. It is committed
and may be public: nothing private, nothing true only on one machine. Keep it short; edit in place.

## Rules for this repository

- **The plugin is `dji-thermal/`** (its id): the released zip has that folder as its single root. Dev tools
  (`dev/`, `package.json`, `eslint.config.mjs`, `ruff.toml`, `requirements-dev.txt`) stay outside it.
- **Official plugin rules only** (https://docs.webodm.org/plugin-development-guide): no Django models or
  migrations (data goes in the plugin's data stores), only the `PluginsAPI` hooks and server signals WebODM has,
  no changes to WebODM itself.
- **Python 3.9 and Django 2.2** (WebODM 3.3.2, numpy 1.26.2, Pillow 11.3.0): Ruff targets py39. WebODM installs a
  plugin's `requirements.txt` with `pip install -U --target`, dependencies included, so it pins numpy and Pillow
  to WebODM's own versions.
- **Temperatures come from [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/)** (pure Python, AGPL),
  a separate package; a change it needs is made and released there first.
- **What applies to AI-assisted work here is the user's call**: the WebODM-Plugins guidance ("never add tests")
  and the WebODM maintainer's wishes for PRs to WebODM are raised with the user, not applied on their own. The
  plugin keeps its own tests, outside the zip.
- **Never push and never tag.** Nothing is published by a push yet (no CI). A release: Claude prepares a
  `release/X.Y.Z` branch (manifest version, `CHANGELOG.md`, `README.md`), builds the zip with `dev/package.sh`
  (`dist/dji-thermal-X.Y.Z.zip` and its sha256), runs the `release-check` skill and merges; the user tags `vX.Y.Z`,
  attaches the zip to the GitHub release and adds `{url, sha256}` to WebODM-Plugins' `directory.json`.
- **`README.md` is the plugin's public page**: every feature change updates it on the same branch (what the
  plugin does, installing, using it, the outside services it calls).
- Planned in `upcoming-changes.md`; new requests arrive in `new.md` (untracked).

## Dev environment

- `ignored/WebODM` is a checkout of https://github.com/WebODM/WebODM (ignored by git), at the commit the pinned
  image was built from (tag `v3.3.2`). The dev server runs that checkout, so a branch checked out there is live on
  :8002. `ignored/WebODM-Docs` is https://github.com/WebODM/Docs (the plugin guide), `ignored/WebODM-Plugins` is
  https://github.com/WebODM/WebODM-Plugins (the directory and its guidance).
- `dev/webodm.sh up | down | logs [service] | ps` runs it in dev mode with `dji-thermal/` mounted as
  `/webodm/coreplugins/dji-thermal`, on http://localhost:8002, containers `dt-webapp`, `dt-worker`, `dt-db`,
  `dt-broker`, `dt-node-odx-1`, project and volumes `webodm-dji-thermal`, so it runs beside another WebODM (port
  8000 or 8001). Images are pinned by digest in `dev/compose.yml` (a local `webodm/webodm_webapp:latest` tag may be
  a fork's build).
- The first start runs WebODM's dev setup (migrations, npm, webpack) for several minutes before the server
  answers.
- Host tools: `uv venv --python 3.9 .venv && uv pip install -r requirements-dev.txt` (Django, DRF, numpy and
  Pillow for the IDE, Ruff); `npm ci` (Jest, ESLint, Playwright). VSCode: interpreter `.venv`, `ignored/WebODM` on
  Pylance's extra paths (local `.vscode/settings.json`).

## Tests and checks

The `test`, `live-check` and `release-check` skills in `.claude/skills` have the steps.

- Django: `docker exec -w /webodm dt-webapp python manage.py test --noinput coreplugins.dji-thermal.tests.test_converter coreplugins.dji-thermal.tests.test_api coreplugins.dji-thermal.tests.test_sdk coreplugins.dji-thermal.tests.test_analyzer`. The tests'
  images come from `DT_SAMPLES_DIR` and `DT_FLIGHT_DIR`, DJI's SDK zip from `DT_SDK_ZIP` (`.env`, untracked);
  never commit an image or DJI's files. Each run installs `requirements.txt` afresh in WebODM's test media
  folder, so the tests use the pinned dji-thermal-cli. One run
  at a time: every run uses the same test database.
- Jest: `npm test` at the repo root (jsdom, babel-jest; Babel's settings in `package.json`). ESLint: `npm run lint
  -- dji-thermal` (`public/main.js` is ES5; `public/thermal/` is JSX and ES modules, built by WebODM's webpack
  into `public/build/` when the plugin is registered, with `public/webpack.config.js` generated: both untracked).
  After changing `thermal/`, rebuild in the dev container:
  `docker exec -w /webodm/coreplugins/dji-thermal/public dt-webapp webpack-cli`.
- Ruff: `.venv/bin/ruff check .`
- Live checks: headless Playwright (Node) against http://localhost:8002 with a dev account from the user.
