---
name: test
description: Run the DJI Thermal Analyzer plugin's checks (Ruff, ESLint, Jest, Django tests in the dev container) before committing or merging.
---

# Tests and checks

From the repo root, with the dev stack up (`dev/webodm.sh ps`; start it with `dev/webodm.sh up`), and before a merge
the 3.3.2 one too (`DT_WEBODM=3.3.2 dev/webodm.sh up`, containers `dt3-*`):

1. **Ruff** (Python 3.9 syntax, the oldest WebODM's, and lint): `.venv/bin/ruff check .`
2. **ESLint** (`dji-thermal/public`: `main.js` and the Analyzer's pages in ES5, `thermal/` in JSX): `npm run lint -- dji-thermal`
3. **Jest**: `npm test` (add a path or `-t "<name>"` to run fewer).
4. **Django**: `docker exec -w /webodm dt-webapp python manage.py test --noinput coreplugins.dji-thermal.tests.test_converter coreplugins.dji-thermal.tests.test_api coreplugins.dji-thermal.tests.test_sdk coreplugins.dji-thermal.tests.test_analyzer coreplugins.dji-thermal.tests.test_inspector coreplugins.dji-thermal.tests.test_frames coreplugins.dji-thermal.tests.test_portable`.
   The tests that need real R-JPEGs or DJI's SDK read `DT_SAMPLES_DIR`, `DT_FLIGHT_DIR` and `DT_SDK_ZIP` set in `.env` (see the
   README), mounted by `dev/webodm.sh up`; they are skipped, naming the variable, when those are not set. Check
   before a merge (on a machine with the images) that the run's summary has only `skipped=1`: the Windows-only
   test of `test_portable`.
   Before a merge, the same in `dt3-webapp` (WebODM 3.3.2; the plugin supports both), and WebODM's plugin tests
   (`app.tests.test_plugins`) in each. Never two Django runs at once in one stack: they share its test database
   (the two stacks' are separate).
   A test run starts WebODM in test mode, which adds a `test` plugin row to the dev database; until the webapp
   restarts, Administration > Plugins fails (500). Remove the row afterwards:
   `docker exec -w /webodm dt-webapp python manage.py shell -c "from app.plugins.functions import sync_plugin_db; sync_plugin_db()"`
   (and in `dt3-webapp` after a run there).
5. **WebODM's own Jest** (for changes to `ignored/WebODM`): `docker exec -w /webodm dt-webapp npx jest`. Some
   suites need the UI mocks first: `docker exec -w /webodm dt-webapp python manage.py test app.tests.test_generate_ui_mocks --noinput`
   (the label must come first).

6. **Windows** (after changing `portable.py`, the only code that differs on Windows): `test_portable` with a native
   Windows WebODM's Python, from a copy in a Windows folder (Windows' Python can't run from a `\\wsl.localhost`
   path). WebODM 4.0.0's Python (`apps\python314`) is an embeddable build whose `python._pth` leaves the current
   folder off its path, so a small runner adds the tests' own. From WSL, with WebODM installed in `C:\WebODM`:
   ```bash
   W=$(cmd.exe /c "echo %TEMP%" 2>/dev/null | tr -d '\r' | tail -1); D="$(wslpath "$W")/dji-thermal-portable-test"
   mkdir -p "$D/tests" && cp dji-thermal/portable.py "$D/" && cp dji-thermal/tests/test_portable.py "$D/tests/"
   printf 'import os, sys, unittest\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\nunittest.main(module="test_portable", argv=["run", "-v"])\n' > "$D/tests/run.py"
   cd /mnt/c && cmd.exe /c "cd /d $W\\dji-thermal-portable-test\\tests && C:\\WebODM\\resources\\app\\apps\\python314\\python.exe run.py"
   rm -rf "${D:?}"
   ```

7. **Workflows** (dji-thermal-cli's, or any repo's `.github/workflows`): `docker run --rm --user "$(id -u):$(id -g)"
   -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color=false` in that repo.

A failure is reported with its output. Before calling one pre-existing, check whether it also fails on `main`.
