---
name: test
description: Run the DJI Thermal plugin's checks (Ruff, ESLint, Jest, Django tests in the dev container) before committing or merging.
---

# Tests and checks

From the repo root, with the dev stack up (`dev/webodm.sh ps`; start it with `dev/webodm.sh up`):

1. **Ruff** (Python 3.9 syntax and lint): `.venv/bin/ruff check .`
2. **ESLint** (the ES5 scripts in `dji-thermal/public`): `npm run lint -- dji-thermal`
3. **Jest**: `npm test` (add a path or `-t "<name>"` to run fewer).
4. **Django**: `docker exec -w /webodm dt-webapp python manage.py test --noinput coreplugins.dji-thermal.tests.test_converter coreplugins.dji-thermal.tests.test_api`.
   The tests that need real R-JPEGs read the folders `DT_SAMPLES_DIR` and `DT_FLIGHT_DIR` set in `.env` (see the
   README), mounted by `dev/webodm.sh up`; they are skipped, naming the variable, when those are not set. Check
   that the run's summary has no `skipped=` before a merge (on a machine with the images).
   Before a merge, also WebODM's plugin tests: `app.tests.test_plugins`. Never two Django runs at once: they
   share the test database.
   A test run starts WebODM in test mode, which adds a `test` plugin row to the dev database; until the webapp
   restarts, Administration > Plugins fails (500). Remove the row afterwards:
   `docker exec -w /webodm dt-webapp python manage.py shell -c "from app.plugins.functions import sync_plugin_db; sync_plugin_db()"`.
5. **WebODM's own Jest** (for changes to `ignored/WebODM`): `docker exec -w /webodm dt-webapp npx jest`. Some
   suites need the UI mocks first: `docker exec -w /webodm dt-webapp python manage.py test app.tests.test_generate_ui_mocks --noinput`
   (the label must come first).

A failure is reported with its output. Before calling one pre-existing, check whether it also fails on `main`.
