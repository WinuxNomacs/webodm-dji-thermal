# Upcoming changes

## Phases (current and upcoming)

**Up next**
- **The user's testing and polishing** (2026-10-30): bugs and polish they report go here, each fixed on its own
  branch. Publishing 1.0.0 waits for it.
  - Done: the dataset page's summary as a table (2026-10-30, `dataset-summary-table`): a row per camera and one for
    all of them, the temperatures as a bar on the dataset's scale with the median frame mean, GPS coverage, capture
    span and duration, height range, size; a row opens the camera's frames on the Files tab, a figure opens them
    sorted by it or only those without GPS (a chip on the Files tab clears it); stacked at phone width.
    `public/dataset.js` (`summaryRows`, `duration`, `overviewHtml`, the Files tab's `camera` / `nogps` scope),
    `analyzer.css`; Jest 119.
  - Done: a conversion's menu items aligned (2026-10-30, `conversion-menu-align`): WebODM's theme padded the menu's
    link (Download all) 10px less than its buttons; links and buttons now share one rule in `analyzer.css`.
  - Done: **Use for parent task** (the user, 2026-10-30), `use-for-parent-task`: a conversion's menu sends its °C TIFFs to
    the dataset's own task (the holder, "Thermal dataset: *name*") instead of a new task, replacing all the images
    sent there before, so one task is reused rather than a task per conversion; on success, a link to the task on
    the dashboard to configure it there. The holder can be processed: WebODM reads only the images at its folder's
    root and writes only `assets/`, never `thermal/`; its Edit panel keeps the hidden tag. Decided (the user):
    - **Old results removed** when its images are replaced: the task goes back to waiting for a processing node
      (as WebODM itself starts a task again: no node task, no status, assets and console cleared, the old node task
      removed), never showing results of other images; refused while it is queued or processing.
    - **Deleting the dataset keeps a task a conversion was sent to**, as an ordinary task (tag and name prefix
      dropped, `thermal/` removed) with those images and what it processed; otherwise the task goes, as before.
    - **"Use settings" renamed "Copy settings to form"** (it fills the Convert form with the conversion's settings,
      for a new conversion).
    Also: a task without options gets the plan's recommended ones (options set in WebODM are kept next time);
    `thermal/parent.json` records which conversion it holds, shown on that conversion. Code: `conversion_tasks.py`
    (`use_for_parent`, `clear_parent`, `parent`, `release`), `analyzer_api.py` (`ConversionParent`, the dataset's
    `parent`, Delete), `public/conversions.js` (`parentHtml`, `useForParent`), `analyzer_core.js` (`deleteText`).
    Tests: Django 112 with `app.tests.test_plugins` (analyzer 47), Jest 122. Live check on :8002, a dataset of its own
    (40 M4T frames): sent from the menu (no replace asked), 40 images and the plan's options, no node; given a node and
    processed (8.5 min); a second conversion sent with the Replace dialog (images replaced, results gone, waiting
    again); the dataset deleted, its task kept as "Live check parent task" without the tag, then removed.
  - **To look into**: that live check's orthophoto (40 frames not normalized, 6.9 to 31.8 °C, the plan's options
    with orthophoto-resolution 2.1) read -601 to 603 °C in WebODM's statistics, where the release check's
    (normalized) gave 6.9 to 45.0 °C: not from sending (the same TIFFs a new task gets), to find out before 1.0.0.
    **Not reproduced** (2026-10-30): the same 40 frames, the same workset settings and options, processed three
    times on ODM 3.8.5: a task from Create task (5.6 to 32.1 °C), the same with `texturing-skip-global-seam-leveling`
    (6.7 to 32.2 °C), and sent with Use for parent task as the bad run was (6.2 to 32.0 °C); every visible pixel
    within the frames' range, the masked area 0. Not seam leveling, not the route. The bad run (511 s against
    295-330 s) had a different reconstruction, likely ODM's own once-off; its task is gone, so nothing more to read.
    The user's own orthophotos are within their frames' range (HomerunObliqueII's frames -45.4 to 65.0 °C with sky in
    the oblique views; its orthophoto -42.5 to 56.7 °C). Open for the user: whether the plugin should warn when a
    processed task's orthophoto reads outside the frames' range.
  - Done: **a link from a WebODM task to its thermal dataset** (the user, 2026-10-30), `task-dataset-link`: a
    **Thermal dataset** button in a task's expanded panel on the dashboard, through `PluginsAPI.Dashboard.
    addTaskActionButton` (the official hook; it adds to the action row only, not the details table or title, which
    would need a WebODM change). The dataset's own task is known by its hidden `.dji-thermal-dataset` tag, in the
    browser, with no request. Decided (the user): **tasks made from a workset (Create task) link back too**, through
    a hidden tag naming the dataset added when the task is made (kept by WebODM's Edit panel), opening it on
    Worksets; tasks made before have no tag and no button. Built: `public/main.js` (the button, a link styled as
    WebODM's own `btn btn-sm btn-primary`); `conversion_tasks.py` (`FROM_TAG` on `create`, `unlink_made` when the
    dataset goes: deleted, from the Analyzer or WebODM, through `datasets.task_removing`, or released). Also: the
    flight test's `skip_without` moved back from `parent_url`, where the parent-task branch had put it. Tests: Django
    113 with `app.tests.test_plugins`, Jest 125. Live check on :8002: the button on the user's dataset task and the
    check dataset's, on a task made from a workset (opens the dataset), none on ordinary tasks or tasks made before.
  - **To look into**: WebODM answers 404 for a processed thermal task's dashboard thumbnail (`/thumbnail?size=164`,
    seen on the user's "HomerunObliqueII - default-webodm-recommendations" and a check task): WebODM's own, with a
    float °C orthophoto; to find out whether the plugin can do anything about it.
  - Done: **The Convert tab as Worksets** (the user, `new.md`, 2026-10-30), `worksets`: the dataset page's
    Convert tab renamed **Worksets** and moved first, left of Files. In it, the **Settings:** section expandable and
    collapsible, and its **Outputs** subsection too; collapsed, each still shows what is selected that differs from
    the defaults (as the chips do), not the defaults. Builds on the tab's summary chips (`differences`, `chipsHtml`)
    and its sections (`details.ta-section`; Outputs is a plain section today). Decided (the user): **"workset"
    everywhere in the UI** (the tab, its heading, buttons, menu items, messages, the README; code and API names stay
    "conversion"); **a dataset's page opens on Worksets**. Built: the tab first and default (`templates/dataset.html`,
    `dataset.js`); "workset" in the pages, scripts and the server's messages (the default name "Workset N"), the
    verb kept (Convert, Converting, Converted); **Settings:** a toggle with a caret (`ta-collapse`), its chips shown
    open or closed; **Outputs** a closed `details` section whose header shows its own chips when closed; every
    section's caret drawn by the plugin (WebODM hid the browser's). Jest 122; live check on HomerunObliqueII (read
    only): the tabs Worksets, Files, Problems, WebODM plan, opened on Worksets; no console error.

**Last**
- **Publish 1.0.0**, the final step, when the user says so: after any change to `dji-thermal/`, the release is redone
  (CHANGELOG, README, the zip rebuilt by `dev/package.sh` on the merge, its new sha256, the `release-check` skill);
  then the user tags `v1.0.0`, attaches the zip to the GitHub release and adds `{url, sha256}` to WebODM-Plugins'
  `directory.json` (details under "Done: Release 1.0.0" below).

**Later**
- **Thermal Analyzer, part 2** — measurements (spot, line, area), comparisons and frame views (below).
- **Pixel Inspector** — the map control (value under the cursor, region statistics), with its point and region
  endpoints served by the plugin (below).
- **Server-folder datasets** for administrators (photos read in place on the server), in the Analyzer; replaces
  the earlier "Folder conversion" item (below).
- **macOS**: the dev setup and checks run on macOS, at the very end.

**Done**
- **Release 1.0.0** — 2026-10-30, `release/1.0.0` (details below).
- **Thermal Analyzer, part 1** — 2026-10-29, in four steps (`analyzer-datasets`, `analyzer-conversions`,
  `analyzer-mosaics`, `analyzer-task`; details under "1. Thermal Analyzer, part 1" below).
- **The DJI Thermal page under Administration** — 2026-10-29, `admin-page` (details below).
- **DJI's own Thermal SDK** — 2026-10-29, `native-sdk` here and in dji-thermal-cli (details below).
- **Thermal task flow** — 2026-10-29, `thermal-task-flow` (details below).
- **Conversion core** — 2026-10-29, `conversion-core`. `dji-thermal/converter.py`: `is_thermal_rjpeg` (by content,
  dji-thermal-cli's `classify`), `measure` (the camera's recorded parameters, `distance="embedded"`),
  `convert(source, dest)` (float32 TIFF written as `.part`, metadata by exiftool with `exiftool_camera.config`,
  then renamed; never raises, returns '' or the reason; the source is left as it is), `decoder_status`; the
  library imported from the plugin's site-packages (`library()`, also in the worker). `requirements.txt` pins
  dji-thermal-cli 1.7.0, numpy 1.26.2, Pillow 11.3.0, installed by WebODM's own `pip install -U --target`.
  `Plugin.enable()` logs the library's version. Tests: `dji-thermal/tests/test_converter.py`, 20 (17 without
  images; 3 with the SDK samples, all 9 cameras' 49 images, and 5 frames plus the detection of all 434 photos of
  the M4T flight), via `DT_SAMPLES_DIR` / `DT_FLIGHT_DIR` in `.env` (untracked), mounted read-only by
  `dev/webodm.sh`; WebODM's `app.tests.test_plugins` passes. Found while building it: `classify` costs 6 ms per
  thermal frame and 17 ms (37 at worst) per 2.8 MB RGB photo, so no header-only check in front; exiftool 12.40
  (WebODM's) copies only the DJI XMP tags it can write, which include all ODM and OpenSfM read (the test checks
  them), not `ImageSource` or the rangefinder's tags.
- **dji-thermal-cli 1.7.0 for Python 3.9** — 2026-10-29, in `~/gitrepos/python/dji-thermal-cli`: branch
  `python-3.9` (b8eeb28) and `release/1.7.0` (5223ac1), merged to its `main` (fd5e0ea), not pushed. No code
  change: on Python 3.9 with numpy 1.26.2 and Pillow 11.3.0 its full suite passes with the SDK and flight data
  (903 passed; 3 skipped: `math.fma`, 3.13+, has an exact fallback; one native SDK crash). `requires-python >=3.9`,
  Ruff py39, classifiers 3.9 to 3.14; dev group: pytest 8.4 and tifffile 2024.8.30 on 3.9, tomli before 3.11
  (`test_packaging.py`); CI's lowest-direct job (numpy 1.26.2, Pillow 11.3.0) and the wheel smoke test on 3.9.
  The lock only adds versions for Pythons below 3.12. Checks: Ruff, pytest on 3.14 (197) and on 3.9 lowest-direct
  (195), build, `check_dist.py`, twine, the wheel on 3.9 and 3.14. In the dev container: `pip install -U --target`
  of the wheel with `numpy==1.26.2` and `pillow==11.3.0` gave those versions, and M4T and H20T samples converted.
  Published 2026-10-29 by Claude, on the user's word ("go ahead and push and publish to pypi"): `main` pushed,
  CI passed (Linux, Windows, macOS on 3.14; Linux 3.9 lowest-direct; the wheel on the three), tag `v1.7.0` (SSH
  signed, on fd5e0ea), the Release workflow published to TestPyPI and PyPI; PyPI's files have the local build's
  sha256 (wheel 3659e9c0..., sdist e573d183...), `uvx dji-thermal-cli@1.7.0` runs on 3.9 and 3.14. Not done: the
  macOS run from a fresh clone (RELEASING.md step 3). The GitHub release (its notes the changelog's 1.7.0 entry)
  was created by the user: https://github.com/WinuxNomacs/dji-thermal-cli/releases/tag/v1.7.0
- **Project setup** — 2026-10-29, `project-setup`. The repo from the GeoJSON plugin's: `CLAUDE.md`, this plan,
  `new.md` (untracked), AGPLv3 `LICENSE`, `dev/` (`webodm.sh`, `compose.yml` with the WebODM 3.3.2 images pinned
  by digest, `package.sh`), `ruff.toml` (py39), `eslint.config.mjs`, `package.json` (Jest, ESLint, Playwright),
  `requirements-dev.txt` (Django, DRF, numpy, Pillow at WebODM's versions; Ruff), the `test`, `live-check` and
  `release-check` skills, and `dji-thermal/` with a manifest and an empty `Plugin`. The dev stack runs on :8002
  (`dt-*` containers, project `webodm-dji-thermal`) beside the GeoJSON one on :8001; its log has
  `Registered [coreplugins.dji-thermal.plugin]`. `ignored/WebODM` is at `v3.3.2`, `ignored/WebODM-Docs` and
  `ignored/WebODM-Plugins` on their upstream `main`. Ruff passes; Jest and ESLint have nothing to check until
  `dji-thermal/public/` exists.

## Evaluation: porting the existing DJI thermal plugin (2026-10-29)

An earlier DJI thermal plugin works on a modified WebODM. It converts DJI R-JPEGs into temperature images as
they are uploaded, and it has a page for converting a folder already on the server. Its parts:

| Part | What it needs | On WebODM 3.3.2 |
| --- | --- | --- |
| Detecting R-JPEGs (EXIF `Model`, XMP `drone-dji:ImageSource` = `InfraredCamera`) | Pillow | ports as is |
| Temperatures | dji-thermal-cli | its tests pass on Python 3.9 with numpy 1.26.2 and Pillow 11.3.0 (193 passed, 107 skipped; its packaging test uses `tomllib`), but it declares `requires-python >=3.12`, so pip will not install it |
| A float32 TIFF with the source's EXIF/XMP and `Camera:BandName` = `LWIR` (so ODM treats it as thermal) | exiftool, a config file | exiftool is in WebODM's image; ports as is |
| Converting each file on upload | a per-upload plugin hook | **missing**: WebODM has no hook between upload and processing (its one signal there, `task_resizing_images`, fires only when the user resizes images) |
| Choosing per task whether to convert | a task option of its own, removed before the options reach the node | **missing**: the Task Options hook (`presetDialogOptionsReady`) adds controls beside the node's own options and sets their values, but cannot add an option |
| The admin page | an Administration menu for plugins | **missing**: `main.js` adds the link to WebODM's Administration menu, the page checks for a superuser |
| Folder conversion in the background | `run_function_async` | ports as is |

Conversion time on Python 3.9: 0.02 to 1 s per image (DJI's sample images, H20N, H20T, H30T), so converting each
file as it arrives is fine. The library also decodes cameras other than the M4T (the earlier plugin took the M4T
only).

**Decided (the user, 2026-10-29):**
- Plugin id `dji-thermal`.
- The plugin keeps its own tests (Django, Jest), outside the zip, as the GeoJSON plugin does. Tests for anything
  that would go into WebODM itself only when the user says so.
- The conversion runs in **the plugin's own upload flow**, with no change to WebODM (phase 2).
- **dji-thermal-cli gets a release for Python 3.9**, rather than being copied into the plugin (1.7.0, done).

## Done: dji-thermal-cli for Python 3.9

In the library's own repository (the user's package: Claude prepares the `release/X.Y.Z` branch there, the user
publishes).
- `requires-python = ">=3.9"`; CI and the lowest-direct resolution also on 3.9 with numpy 1.26.2 and
  Pillow 11.3.0; `test_packaging.py` without `tomllib` on 3.9 (`tomli`, or skip there); Ruff's target py39.
- A minor version (1.7.0): it widens what installs it, with no API change.
- The plugin's `requirements.txt`: `dji-thermal-cli==1.7.0`, `numpy==1.26.2`, `pillow==11.3.0` (WebODM runs
  `pip install -U --target` with dependencies, and an unpinned numpy would land in the plugin's site-packages,
  ahead of WebODM's own).

## Done: Conversion core

- `dji-thermal/converter.py`: which files are thermal R-JPEGs (dji-thermal-cli's `classify`, which reads the file's
  content; to check: its cost on every uploaded JPEG, against the earlier header-only check), decoding with the
  camera's recorded parameters (`measure`, `distance="embedded"`), the TIFF with the source's metadata and
  `Camera:BandName` = `LWIR` (`exiftool_camera.config`), never raising (a failed file is left as it is and
  logged).
- `Plugin.enable()` logs whether dji-thermal-cli loads; imports through `python_imports()` (the plugin's
  site-packages). `requirements.txt`: `dji-thermal-cli==1.7.0`, `numpy==1.26.2`, `pillow==11.3.0`.
- **Tests without images** (always run): detection on JPEGs the tests make (with and without DJI's XMP, an RGB
  photo's `ImageSource`), a corrupt file, a non-JPEG, the exiftool command and its failure handling.
- **Tests with images** (skipped, naming the variable, when it is not set), as dji-thermal-cli's own:
  `DJI_THERMAL_SAMPLES_DIR` (DJI's SDK sample images, one folder per camera: every camera converts, with the
  library's temperatures) and `DJI_THERMAL_FLIGHT_DIR` (a real flight's images, thermal and RGB mixed: the thermal
  ones convert, the RGB ones are left alone, the TIFFs keep GPS and orientation and are marked LWIR).
  `dev/compose.yml` mounts the two folders read-only in the webapp and worker (`DT_SAMPLES_DIR`, `DT_FLIGHT_DIR`
  on the host), the `test` skill passes the variables to `docker exec`.

**Decided (the user, 2026-10-29):**
- **No images in the repo**, DJI's or the user's: none of them is to be published. The tests read them from the
  folders above; anyone working on the plugin brings their own (README and the `test` skill say how).
- **Every camera dji-thermal-cli decodes** is converted (H20N, H20T, H30T, M2EA, M30T, M3T/M3TD, M4T, XT S). The
  README says which were checked on a real flight (the M4T) and which on DJI's sample images only.

**Dependabot and the pins** (2026-10-29): the user's rule is that only the plugin's own code is ours to fix. The
dev-only alerts (`requirements-dev.txt`, `package-lock.json`) are dismissed. `requirements.txt`'s `pillow==11.3.0`
and `numpy==1.26.2` will raise alerts too and stay pinned: they are WebODM 3.3.2's own versions, which its Python
3.9 cannot move past (Pillow 11.3.0 is the last for 3.9), and unpinned, `pip install -U --target` would put
numpy 2.x in the plugin's site-packages, ahead of WebODM's own. The pins install nothing WebODM does not already
run; when those alerts appear they are dismissed with that reason, and the pins move when WebODM's do.

## Done: Thermal task flow

**Built** (2026-10-29, branch `thermal-task-flow`):
- `converter.py`: `settings(values)` (the form's values as text or numbers, C or F, '' keeping the recorded value;
  distance `lrf` by default, `embedded` or metres; a bad value raises naming the field), `measure` returning the
  whole Measurement, `describe` (camera, recorded values and ranges, without the parameters a camera does not
  use), and the values used written in each TIFF's XMP in dji-thermal-cli's own `dtc` namespace
  (`exiftool_camera.config` defines it). A value outside a camera's range fails that photo with the library's
  reason.
- `api.py`, mounted by `plugin.py`: `POST /api/plugins/dji-thermal/describe` (one photo) and
  `.../projects/<id>/tasks/<id>/convert` (one photo into a partial task, `change_project`; `converted`,
  `ignored` or `failed` with the reason), converted in a work folder under `MEDIA_TMP` and moved in when complete
  (WebODM counts every file in a task's folder as an image).
- `public/main.js` (ES5) adds the button; `public/thermal/` (JSX, built by WebODM's webpack): `rjpeg.js` (the
  photos picked sorted by an APP3 segment before the image data: RGB photos never uploaded), `measurement.js`,
  `MeasurementSettings.jsx`, `ThermalTaskPanel.jsx`, `ThermalTaskButton.jsx` (the panel rendered by a portal at
  the top of the project's content, where WebODM's own opens), `upload.js` (three conversions at a time; a task
  with no image removed; cancel), `textFiles.js` (GCP, `geo.txt`, `image_groups.txt` with the photos' names
  changed to the `.tif` images'), `serverApi.js` (jQuery, with WebODM's CSRF token).
- Found while building it: NewTaskPanel shows plugin items (`addNewTaskPanelItem`) only with `showResize`, so
  the Measurement section is its own panel, **above** WebODM's (below would put it after the Start button). Its
  Start button cannot be disabled from outside: a refused value resets the panel through its ref (`loading`,
  `inReview`). WebODM's components bring a bundled React 16.14 into the plugin's build (as with the Lightning
  plugin); class components work across the two copies. The suggested name skips WebODM's Nominatim lookup. The
  SDK sample images carry no rangefinder reading; every frame of the M4T flight does.
- Tests: Django 45 with `app.tests.test_plugins` (`test_converter` 29, `test_api` 11; none skipped with the
  images), Jest 28 (`public/__tests__`, babel-jest with Babel 7.29.7), ESLint, Ruff. Live check on :8002 (admin):
  the whole M4T flight picked (434 files), 217 thermal photos found and 217 RGB ignored, an emissivity of 1.5
  refused, the task created with 217 TIFFs (all `DistanceSource` rangefinder, LWIR, GPS),
  processed on node-odx-1 with the default options in 7.3 minutes to a float32 orthophoto (690 x 793 px, UTM 16N,
  median 20.3 °C, -16.8 to 44.9) that WebODM shows as its Thermal layer, on the house in the basemap; no console
  error from the plugin (only WebODM's dev livereload); the project it created deleted afterwards.

**Design** (agreed with the user, 2026-10-29):
- **A "Thermal task" button** beside "Select Images and GCP" (`Dashboard.addNewTaskButton`, which gives
  `{projectId, onNewTaskAdded}`): the user picks the flight's photos (and a GCP file). The plugin counts the
  thermal R-JPEGs among them in the browser; the others are ignored.
- **WebODM's own task panel** (`webodm/components/NewTaskPanel`: name, processing node, options, the photos on the
  map; `showResize` off), as WebODM's core plugins reuse its components, with a **Measurement** section below it.
  This makes the plugin's scripts JSX built by WebODM's webpack at install (`build_jsx_components`), no longer
  ES5: ESLint and Jest are set up for that.
- **Upload**: the browser creates a partial task with WebODM's API (`POST /api/projects/<id>/tasks/`,
  `partial`), sends each thermal photo to the plugin's mount point (the same project permission as WebODM's
  upload, `change_project`), which converts it and saves the TIFF in the task's folder (`task.get_image_path`);
  the GCP file goes in unchanged. The browser then commits with WebODM's API (`.../commit/`). Progress per photo;
  a photo that fails stays out, with its reason; a task left with no image is removed.
- **Measurement settings**: emissivity, reflected (background) temperature, ambient temperature, humidity,
  distance; each shows and keeps the camera's recorded value unless changed. Limits per camera, from the photos
  picked (the library's `measurement_params_range`; distance to 25 m on the H20N, M2EA, M30T and M3T, 300 m on
  the H30T and M4T), checked before the upload starts. The H20T and XT S record no ambient temperature: the form
  says their photos do not use it. The values used are written in each TIFF's XMP.
- **Why not Task Options alone** (the user asked, 2026-10-29): `presetDialogOptionsReady` (added to WebODM on
  2026-10-28, in 3.3.2, not yet in its docs) can put controls in Task Options, and its `getExifData()` entries
  carry each photo's browser `File` (`image`, an internal field of the map preview since 2024), so a control can
  see the photos are DJI thermal ones. But the conversion has no place there: WebODM uploads the originals and
  its worker sends them to the node with no plugin code in between, except `task_resizing_images`. Converting
  in that signal would need the user to pick "Resize images" with a size larger than the frames (WebODM never
  enlarges), the settings carried to the worker without a task (the dialog has none for a new task), and the RGB
  photos deleted there: rejected for the button.

**Decided (the user, 2026-10-29):**
- **Only the thermal photos are processed**: RGB photos (`_V`, `_W`, `_Z`) and unsupported ones (another camera's
  R-JPEG, a corrupt file) picked with them are simply ignored, neither refused nor sent to a second task.
- **No resizing** offered: the task's thermal frames keep their size.
- **The measurement settings can be changed at upload** (above).
- **Distance by default: the rangefinder's, else the recorded one**: each photo's laser rangefinder distance
  where it has a valid one (dji-thermal-cli's `distance="lrf"`, its default), else the distance the camera
  recorded (usually 5 m, whatever the flight height). The temperatures then differ slightly from DJI's own apps.
  This changes the conversion core's `distance="embedded"`.
- **Temperature unit selectable in the form**, defaulting to WebODM's unit system (degrees C when metric, F when
  imperial: `Units.js`). The TIFFs are always in degrees Celsius.
- **The Thermal task button is the only entry point**: no hint in the regular upload's Task Options.

**Build order**: the conversion's settings (`converter.measure` with overrides and `distance="lrf"`, the values in
the XMP) and the upload API with Django tests first; then the button, panel and Measurement section, with Jest
tests and a live check on the M4T flight (a real task processed to a thermal orthophoto on the dev node).

## Done: DJI's own Thermal SDK

**Built** (2026-10-29):
- **dji-thermal-cli** (its repo, branch `native-sdk`, then `release/1.9.0`): `dji_thermal_cli/native`
  (bindings of `dirp_api.h` apart from the tests' oracle, a child process serving the port's `RJpeg` calls over a
  pipe, a proxy with the port's interface, DJI's error codes mapped to the port's exceptions); `Settings(sdk=)`,
  `describe`/`list_dataset(sdk=)`, `check_sdk()`, `--sdk` on `process` and `list`. The child is restarted after a
  crash, a timeout, or a library file replaced in place. `tests/test_native.py`: 20 (a stand-in child that crashes,
  hangs and prints; with the SDK: every sample measured bit for bit as the port, `describe`, `process`, a real
  SIGSEGV in `dirp_process` (H20T, palette -1) leaving the caller running, no libdirp in the caller's memory map).
  Full suite on 3.14 with samples, flight and SDK: 1170 passed, 10 skipped, 1 failed
  (`test_rjpeg.py::test_process_writes_r_jpegs_with_the_parameters_used`, a JPEG-compression threshold: it fails
  the same on that repo's `main`, 1.8.0, so it is not this change's). On 3.9 lowest-direct: `test_native`,
  `test_api`, `test_cli` pass. The wheel and sdist pass `check_dist.py` and twine.
- **The plugin**: `sdk.py`, `page.py`, `templates/sdk.html` (the DJI Thermal page), `converter.py` (the SDK in
  use for measuring and describing, recorded in the TIFF's `Software`), `api.save_upload` (an upload over 4.5 MB is
  read from its temporary file: WebODM's upload handler closes it). `requirements.txt` pins dji-thermal-cli 1.9.0.
  `tests/test_sdk.py`: 20 (which SDK, installing, the page; with `DT_SDK_ZIP`, DJI's zip installed from the page and
  a photo converted as the port does). Django 65 with `app.tests.test_plugins`, none skipped; Ruff.
- **Live check** on :8002 (admin, and a non-admin user made for it): the menu entry; the page as the built-in port;
  DJI's zip uploaded (1.9 s, API revisions 19 and 20), then updated, Check (9 samples); the non-admin sees the SDK
  in use, no form, and a POST is refused (403); a thermal task of 40 M4T frames (and 5 RGB ignored) measured with
  DJI's SDK (`Software` "dji-thermal-cli 1.9.0 with DJI's Thermal SDK 1.8", rangefinder, LWIR), processed to a
  float32 orthophoto (UTM 16N, -18.3 to 33.0 °C, mean 17.8); Remove back to the built-in port. Removed afterwards:
  the project, the user, the SDK. A first try with the flight's first 20 frames failed in OpenSfM (take-off frames,
  no reconstructable pair), not in the conversion.
- Found: WebODM's tests install `requirements.txt` afresh in their own media folder, so they only test a library
  version that pip can find; until 1.9.0 is on PyPI the dev containers have its wheel in `/tmp/wheels` and an
  `/etc/pip.conf` `find-links` to it (not in the repo; removed once it is published). `pip install -U --target`
  leaves an earlier version's `.dist-info` beside the new one (the version reported was still right).

**The request** (the user, 2026-10-29): before the release, a plugin admin page where an administrator can upload
the current DJI Thermal SDK, to be used in place of the built-in one if desired.

**The request** (the user, 2026-10-29): before the release, a plugin admin page where an administrator can upload
the current DJI Thermal SDK, to be used in place of the built-in one if desired.

**Builds on**: dji-thermal-cli, a pure-Python port of SDK v1.8, bit-identical to it. It calls DJI's libraries only
in its tests (`tests/native_sdk.py`, ctypes bindings of `dirp_api.h`, the port's oracle), always in a subprocess
since libdirp can crash, with the SDK found by `DJI_THERMAL_SDK_DIR` (an unpacked SDK) or
`DJI_THERMAL_SDK_LIB_DIR`, in DJI's `<os>/release_x64` layout.

**Decided (the user, 2026-10-29):**
- **The native calls go in dji-thermal-cli**, released there first (a minor version), the plugin pinning it. The
  SDK's location by an environment variable, as its tests have, which an admin can also set at deploy time.
- **Server-wide**: once DJI's SDK is in place, it converts every photo on the server; without it, the built-in
  port.
- **The upload is DJI's SDK zip as downloaded**: the plugin keeps the libraries for the server's platform (Linux
  x64 in WebODM's Docker image) in its persistent folder (`get_persistent_path`, kept across plugin updates) and
  checks they load. The plugin never ships DJI's files.
- **A photo DJI's SDK fails on** (refused, or the library crashed) **fails**, left out with DJI's reason, as other
  failures are; no fallback to the built-in port.

- **Only the SDK versions the bindings were checked against** (the user, 2026-10-29): today v1.8 (API revisions
  19 and 20). Another version is refused at upload, naming the one found and those supported; a new DJI release
  is followed by a dji-thermal-cli release.

**Design:**
- dji-thermal-cli 1.9.0: a `native` module with the bindings moved from its tests, run in a **child process**
  that loads the library once and serves requests over a pipe; a crash (signal) or a timeout fails that request
  with a `TsdkError` subclass saying so, and the next request starts a new child. A proxy answers the same calls
  as the port's `RJpeg`, so `measure`, `describe` and `process` work unchanged (a call DJI's API lacks fails with
  the reason). Chosen explicitly: `Settings(sdk=dir)`, `describe(..., sdk=dir)`, `--sdk DIR`; the library reads
  no environment variable itself (its tests' `DJI_THERMAL_SDK_DIR` keeps meaning the oracle). The plugin reads
  `DJI_THERMAL_SDK_DIR` from WebODM's environment and passes it.
- The plugin: a **DJI Thermal** page (`main_menu` and `app_mount_points`; since moved under Administration, for
  superusers only: see "Done: The DJI Thermal page under Administration"). WebODM shows a plugin's menu entry
  to every user and has no per-plugin link in Administration > Plugins, so the page shows everyone which SDK
  computes the temperatures (built-in, or DJI's v1.8, uploaded or set at deployment), and only superusers get
  Upload / Update, Check (the SDK measuring its own samples) and Remove (an uploaded SDK only).
  `sdk.py`: the SDK in use (`DJI_THERMAL_SDK_DIR` first, then the upload in the plugin's persistent folder);
  an upload keeps only the libraries for the server's system, DJI's `License.txt` and one sample per camera
  (for Check) from the zip, checked with `check_sdk` in a staging folder before it replaces the old one; zip
  paths outside the folder are refused. `converter.py` passes the SDK to the library; the Measurement
  section's ranges come from it too.
- dji-thermal-cli restarts its child when the library file changes (an Update), so WebODM's processes pick
  up the new SDK without a restart.

- **The deploy-time variable wins** (the user, 2026-10-29): when `DJI_THERMAL_SDK_DIR` is set on the webapp,
  that SDK is used; the admin page's **Update** replaces the SDK there with a newly uploaded zip (the page says
  so when the folder cannot be written). Without the variable, the upload goes to the plugin's persistent folder,
  and Update replaces it there.
- **DJI's libraries can never crash dji-thermal-cli's process** (the user, 2026-10-29): they are loaded only in a
  child process, never in the caller's; a crash or hang there (a signal, a timeout) is that photo's error, with
  the reason, and the caller carries on.
- **The CLI work** (the user, 2026-10-29): branch `native-sdk` in dji-thermal-cli from its `main` (1.8.0,
  published), then `release/1.9.0`, merged there, not pushed; the plugin then pins 1.9.0.

## Done: Release 1.0.0

README (what it does, cameras, installing, using it, that it calls no outside service), `CHANGELOG.md`, the zip
(`dev/package.sh`), the `release-check` skill.

Plan: a clean-up pass (unused code, the manifest), README (no longer "in development"; Installing: WebODM 3.3.2 or
later, Administration > Plugins, the zip and its sha256 or the directory), `CHANGELOG.md` (the Thermal Task, the
Thermal Analyzer part 1, DJI's own SDK), manifest 1.0.0 with a description naming both ways in, the zip, the
`release-check` skill (the zip installed as a user would, a live check of the Thermal Task and the Analyzer), merge.
Redone on `main` (2026-10-30) after part 1; the first `release/1.0.0` (2026-10-29, before the Analyzer) was
replaced, its changes carried over.

**Decided (the user, 2026-10-29):**
- **Published in WebODM-Plugins' directory and as this repo's GitHub release**: the zip attached to the release,
  `{url, sha256}` added to `directory.json` by a PR (the user's).
- **Not experimental**: the manifest's `experimental` is false from 1.0.0 (the directory's guidance marks plugins
  experimental unless the author asks otherwise).
- **macOS checks after 1.0.0**, at the very end.

**Built** (2026-10-30, `release/1.0.0`): manifest 1.0.0, not experimental, its description naming the Thermal Task
and the Analyzer; `CHANGELOG.md`; README's Installing (no longer "in development"); `DISTANCE_MODES` in
`thermal/measurement.js` removed (unused). Checks: Ruff, ESLint, Jest 116, Django 109 with `app.tests.test_plugins`.
`dev/package.sh`: `dist/dji-thermal-1.0.0.zip` (one root `dji-thermal/` with `LICENSE`, no tests), sha256 in the
merge's report. Release check on :8002: WebODM without the mounted plugin, the zip uploaded with Load Plugin (.zip)
("DJI Thermal installed successfully", no restart asked; pip installed dji-thermal-cli 1.9.0 from PyPI with numpy
1.26.2 and Pillow 11.3.0, webpack built the bundles; 1.0.0 listed, enabled). On the installed copy, in a project of
its own: a Thermal Task of the M4T flight's first 40 thermal frames (3 RGB ignored) processed in 15 min to an
orthophoto of 11.5 to 31.1 °C, WebODM's Thermal layer; a dataset of the same frames analyzed, converted
(normalized) with mosaics (40 placed, the viewer's tiles on the base map), a task created from it, given the node and
processed in 14 min (6.9 to 45.0 °C); no console error but WebODM's dev livereload. The first 20 frames failed in
OpenSfM in both (no reconstructable pair, as in the SDK phase). Found: WebODM refuses the upload over the mounted
copy's `media/plugins/dji-thermal` (its pip installs), set aside during the check (the skill says so). Afterwards
the installed plugin removed in Administration, the project deleted, the mounted copy back.

Publishing held (the user, 2026-10-30) until their testing and polishing are done; the zip's sha256 changes with
any later commit to `dji-thermal/`. To publish (the user): tag `v1.0.0` on the merge, a GitHub release with the zip attached (notes: the changelog's
1.0.0 entry), then a PR to WebODM-Plugins adding `{url, sha256}` to `directory.json`.

## Done: The DJI Thermal page under Administration

**The request** (the user, 2026-10-29): only administrators can see and use the DJI Thermal page and the SDK
setting, under Administration.

- WebODM has no plugin hook for the Administration menu, and a `main_menu` entry shows to every user (it gets no
  request), so the plugin has no `main_menu`. `public/main.js` adds a **DJI Thermal** link after **Plugins** in
  the Administration menu once the page is loaded. It depends on that menu's markup
  (`#side-menu a[href="/admin/app/plugin/"]`); if WebODM changes it, the link is missing and the page is still at
  `/plugins/dji-thermal/`. WebODM shows that menu to staff; the page answers superusers only (403 otherwise,
  viewing as well as changing), so a staff user who is not a superuser sees the link and is refused.
- Tests: `public/__tests__/main.test.js` (the link after Plugins; none without the Administration menu; the
  Thermal Task button), `tests/test_sdk.py` (a user gets 403 on GET and POST, a superuser the page; no
  `main_menu`). Jest 31, Django 65 with `app.tests.test_plugins`, ESLint, Ruff.
- Live check on :8002: admin sees DJI Thermal under Administration after Plugins and opens the page; a temporary
  user made for it has no link and gets 403 at `/plugins/dji-thermal/`; the user was removed afterwards.

## Later: Server-folder datasets

The earlier plugin converts a folder on the server (overrides for the measurement parameters, the camera's own
conversion kept in `raw/`, a CSV report, progress and Cancel in the worker), and the earlier Analyzer has datasets
read in place from a server folder (administrators only). Decided (the user, 2026-10-29): this comes after
Analyzer part 1, as an Analyzer dataset whose photos are read in place (so they don't count toward a quota; its
conversions and mosaics do, in its holder task).

## Later: Thermal Analyzer and Pixel Inspector

**The request** (the user, 2026-10-29): add the earlier plugin's Thermal Analyzer to this plugin; recorded as phases
after 1.0.0.

What the earlier work has:
- **Thermal Analyzer**: about 7,000 lines (2,000 Python, 5,000 JavaScript) and a 3,400-line JS test file. Datasets,
  conversions, mosaics on a map with live palette and contrast, side-by-side and difference comparisons, spot, line
  and area measurements, frame views, a conversion handed to a task. Its folder carries a `disabled` file there:
  find out why before porting it.
- **Pixel Inspector**: about 2,500 lines and tests; a map control (`PluginsAPI.Map` hooks only) showing the value
  under the cursor, pinned points and region statistics.

What ports as it is:
- The Python parses as Python 3.9; every outside dependency it uses is in WebODM 3.3.2 (`zipstream-ng`, `Basemap`,
  the worker's `process_task`, `run_function_async`, django-guardian permissions).
- Measuring and mosaics come from dji-thermal-cli's API, which the plugin pins, so they use DJI's own SDK when one
  is installed.
- Its pages are the plugin's own (page routes and about 35 API routes), no fork-only hooks.

What has to change, all within the plugin rules (no change to WebODM):
1. **Its three Django models** (`ThermalDataset`, `ThermalConversion`, `ThermalMeasurement`: 266 lines, 45 fields,
   about 37 query sites) were first to move to the data stores (key/value JSON rows; superseded by JSON files in
   the holder task, see part 1): a key per record,
   progress from the worker under keys of its own so writes don't overwrite each other, listing and permissions
   by hand through the project's permissions. WebODM gives plugins no "project deleted" signal (task signals
   only): records of a deleted project are ignored and cleaned up when next seen. Quota: see Decided, below.
2. **The Pixel Inspector** reads `point` and `region-stats` endpoints WebODM 3.3.2 lacks: the plugin serves them
   itself, reading the task's rasters.
3. **Merged with this plugin**: its upload-and-convert duplicates the Thermal Task, so it reuses this plugin's
   converter, SDK choice and task creation.
4. **Tests**: the Jest tests mostly carry over; the Python tests are rewritten against the data stores; live
   checks on the M4T flight. Its JavaScript is mostly plain (not JSX), which fits the plugin's build.

Phases, in order: **part 1** (datasets in holder tasks, conversions, mosaics on the map; see "1. Thermal Analyzer, part 1"), **part 2**
(measurements, comparisons, frame views), **Pixel Inspector** (the map control and its endpoints).

Decided (the user, 2026-10-29):
- **The Analyzer's page is at the root of WebODM's menu** (`main_menu`, every user), as the plugin's primary UI;
  each user sees the datasets of the projects they can view.
- **The earlier copy's `disabled` file** was a default, not a known problem: it came with the Analyzer's first
  commit ("experimental, disabled on new installs like the Mission Planner"). WebODM reads that file only when it
  first registers a plugin (off until an administrator enables it). This plugin has no such file.
- **What the Analyzer stores counts toward each user's quota.** The earlier copy did it by changing WebODM
  (`profile.py`, `storage.py`), which a plugin can't. WebODM's quota is the sum of the owner's tasks' `size`, and
  `Task.update_size()` counts every file in the task's folder, so the plugin keeps a dataset's files in that
  task's folder and calls `update_size(commit=True)` after each change; uploads are refused once
  `profile.has_exceeded_quota()`.
- ~~A dataset lives in the thermal task it leads to~~: replaced the same day, see Part 1 below (WebODM deletes
  a partial task after 72 hours, `CLEANUP_PARTIAL_TASKS`, and a dataset has several conversions).

## 1. Thermal Analyzer, part 1

**The request** (the user, 2026-10-29): plan the Analyzer's first part; it ships before 1.0.0.

**Decided** (the user, 2026-10-29):
- **Before 1.0.0**: 1.0.0 is released once part 1 is in; part 2 and the Pixel Inspector follow as 1.x.
- **A dataset is kept in a holder task** of its project: a task WebODM never processes and never cleans up
  (`partial=False`, no processing node, `auto_processing_node=False`, so `processing_tasks()` skips it and
  `cleanup_tasks()`, which deletes partial tasks after 72 hours, leaves it), marked with the hidden tag
  `.dji-thermal-dataset` (WebODM hides tags starting with "."). Everything the dataset has lives in that task's
  folder, so it counts toward the owner's quota (`update_size`), follows the project's sharing, and goes when the
  task or project is deleted. It shows in the project's task list as "Thermal dataset: <name>" with "Set a
  processing node" (a plugin can't hide a task); its folder's root holds no image, so a node set on it by hand
  only fails the task with no photos.
- **Uploads only** in part 1; server-folder datasets later (above).
- **The Thermal Task button stays** as the quick path; it and the Analyzer share the converter, the SDK choice and
  the task creation.

**What part 1 ports from the earlier Analyzer** (its phases 1, 2, 3 and 5, with their later UI fixes: no silent
failures, the colour scale and exports, the Convert tab, the datasets list and tabs, moving around the viewers,
the palette first, image optimization, the dark theme):
- **The Analyzer's page**, `/plugins/dji-thermal/` at the root of the menu (`main_menu`, every user; the DJI
  Thermal SDK page moves to `/plugins/dji-thermal/sdk/`, still linked under Administration): the datasets of the
  projects the user can view, and New dataset (name, project; for those who can change the project).
- **A dataset's page**: upload photos (subfolders kept, JPEGs only, refused once the owner is over quota), the
  analysis (dji-thermal-cli's check with the WebODM plan, in the worker, with progress and Cancel), an overview and
  the Files, Problems and WebODM plan tabs.
- **Conversions**: the Convert tab with every dji-thermal-cli `Settings` field (each measurement parameter beside
  the flight's recorded median, the palette, the outputs, normalization, a nadir-only pitch limit), "Use the WebODM
  plan's settings", several conversions side by side, progress and Cancel, a streamed zip or file by file, the
  user's defaults ("Save as my defaults", in the plugin's user data store). DJI's own SDK is used when installed.
- **Mosaics on the map**: "Build the mosaics" (dji-thermal-cli's `make_mosaic`), the viewer with its tabs (as
  converted, harmonized, source frame, view angle) over WebODM's base layers, palette and range changed live, the
  colour scale, a hover readout (temperature, frame, view angle), the report.
- **Create task** from a conversion: what stops a task, the plan's warnings and options, name and node; a normal
  task in the project with the conversion's TIFFs, saved through WebODM's own task API (its permission and option
  checks), listed on the conversion with its status.

**Left for part 2**: spot, line and area measurements, saved measurements and their exports, isotherms, the
emissivity / reflected-temperature correction, the frame page, comparisons and differences.

**Design** (Claude's, to check while building):
- **Records as JSON files in the holder task's folder** (`thermal/dataset.json`, `thermal/analysis.json`,
  `thermal/conversions/<id>/conversion.json`), not in the data stores: they count toward the quota, take the
  project's permissions and are deleted with the task, with no "project deleted" signal needed. A worker job
  writes its progress to a file of its own, replaced atomically, so it never overwrites a user's change; a run id
  file lets Cancel, delete or a new run stop a job. The datasets list is
  `Task.objects.filter(project__in=<visible>, tags__contains='.dji-thermal-dataset')`. `task_removing` cancels a
  running job. The data stores keep only each user's defaults. This replaces the earlier draft's "a key per record
  in the data stores".
- **Files**: `thermal/images/` (the uploads), `thermal/conversions/<id>/` (outputs, `mosaics/`); the folder's root
  stays empty. A task made from a conversion gets copies (or hard links, which WebODM's size count still counts
  twice: the quota then shows what each task holds).
- **Jobs** with `run_function_async` (WebODM's worker), one process each (a Celery worker can't start a
  multiprocessing pool; DJI's SDK runs in its own `subprocess` child, which is allowed).
- **Tiles**: the plugin's own tile and point endpoints with rio-tiler 2.1.2 (in WebODM's image). The earlier copy
  used five tiler helpers its fork added (`raster_etag`, `not_modified`, `tile_format`, `render_tile`,
  `tile_response`, about 85 lines): they become the plugin's own. WebODM 3.3.2 has `get_zoom_safe`,
  `download_file_response`, `download_file_stream` and `check_processing_node_perms`.
- **Leaflet** from WebODM's own (1.3.1, bundled by WebODM's webpack into the plugin's build), not a
  `package.json` of the plugin: WebODM runs `npm install` for one only when npm is on the server, and skips the
  plugin without it.
- **Its code** is about 2,000 lines of Python and 5,000 of JavaScript in all; part 1 is roughly the datasets,
  conversions, mosaics and task parts of it (`thermal_analysis.py`, `thermal_conversion.py`,
  `thermal_mosaics.py`, `thermal_task.py`, most of `api.py`; `datasets.js`, `dataset.js`, `conversions.js`,
  `viewer.js`, `analyzer_core.js`, `analyzer.css`), checked against dji-thermal-cli 1.9.0's API (it was written
  for 1.2 to 1.4). Tests: the earlier Jest tests that apply, Django tests rewritten for the holder task, live
  checks on the M4T flight.

**Decided for (d)** (the user, 2026-10-29):
- **Create task makes the task but does not process it**: it is a normal task in the dataset's project (not
  partial) with the conversion's °C TIFFs, its name and the plan's options as ticked in the plugin's dialog, and no
  processing node (`auto_processing_node=False`). WebODM lists it with "Set a processing node", which opens
  WebODM's own Edit panel (node, options); saving it with a node starts the processing. So the dialog has no node
  choice; it shows what stops a task (not finished, location stripped, fewer than 2 °C TIFFs) and the plan's
  warnings (not normalized, pitch limit, emissivity, humidity).
- **The README gets a full pass as the public page for 1.0.0**: Create task added, then the whole page reread
  (the two paths, order, wording, every claim checked against the code); no screenshots.

**Possible steps** (each merged when tested): (a) holder tasks, datasets, uploads and the analysis; (b)
conversions; (c) mosaics and the viewer; (d) Create task and the README.

**Built so far**:
- **(a) Datasets, uploads and the analysis** — 2026-10-29, `analyzer-datasets`. `datasets.py` (the holder task:
  tag, name prefix, records `thermal/dataset.json`, `job.json`, `analysis.json`, images in `thermal/images/`, all
  changed under an `fcntl` lock on `thermal/.lock` that the web app and the worker share; listing, permissions,
  quota, run ids, Cancel with Celery's revoke, a job whose Celery state is FAILURE or REVOKED marked failed;
  `task_removing` cancels), `analysis.py` (the earlier `thermal_analysis.py` on dji-thermal-cli 1.9.0's `check`),
  `analyzer_api.py` (list and create, detail, rename, delete, upload, analyze, cancel, thumbnail), `analyzer_pages.py`
  and the two templates; the menu item (`main_menu`), the SDK page moved to `/plugins/dji-thermal/sdk/`.
  Front end: the earlier `analyzer_core.js`, `datasets.js`, `dataset.js` and `analyzer.css` as plain ES5 scripts in
  `public/` (no build), without the server-folder source and the Convert tab; temperatures in Fahrenheit with
  WebODM's imperial units (its `unit_system` in the browser's storage) in place of the earlier profile setting.
  Tests: `tests/test_analyzer.py` (19, one on 6 frames of the M4T flight), `public/__tests__/analyzer.test.js` (43,
  the earlier ones that apply). Live check on :8002: a dataset of 12 thermal and 2 RGB frames of the M4T flight,
  analyzed, its tabs and thumbnails, the holder task in the project's list with "Set a processing node", the SDK
  link, deleted from its page (task and folder gone).
  Found while building it: the holder task is listed by WebODM's task API and counts in the project's task count
  ("2 Tasks"); removing it in WebODM deletes the dataset (`Task.delete` removes the task's folder).
- **(b) Conversions** — 2026-10-29, `analyzer-conversions`. `conversions.py` (the earlier `thermal_conversion.py`
  on dji-thermal-cli 1.9.0: every `Settings` field, the outputs from `outputs.PRODUCTS` (now with `rjpeg`), the
  user's defaults in the plugin's user data store; records `thermal/conversions/<id>/conversion.json`, `job.json`,
  `results.json`, files in `output/`; the job with DJI's SDK when installed; a conversion or dataset deleted while
  running stops at its next image and leaves no files), `datasets.py`'s job functions made per job file
  (`start_job`, `update_job(rel=...)`, `finish_job`, `check_stale`); the API's conversions under
  `datasets/<id>/conversions` (list and create, detail, rename, delete, cancel, download as a streamed zip or one
  file) and `preferences`; the datasets list's Conversions column. Front end: the earlier `conversions.js` without
  its mosaic, task and frame-page parts (steps c, d and part 2), conversion ids as text. Fixed on the way: the form
  drawn while an analysis ran never showed the recorded values once it finished (it is drawn again, keeping what was
  typed); the delete dialog spoke of tasks made from conversions, which come in (d) (now only with `task_count`).
  Tests: `test_analyzer.py` 33 (one converting 3 M4T frames and downloading them), Jest 94. Live check: 12 M4T
  frames converted with emissivity 0.95 (24 files, 8.5 MB), the zip and one file downloaded, defaults saved then put
  back, the plan's settings, the list's 1/1, the dataset deleted.
- **(c) Mosaics and the viewer** — 2026-10-29, `analyzer-mosaics`. `mosaics.py` (the earlier `thermal_mosaics.py` on
  dji-thermal-cli 1.9.0: one `make_mosaic` for the harmonized mosaic with the as-converted one from the same layout;
  a located copy for the map when the location is stripped; `thermal/conversions/<id>/mosaic-job.json`,
  `mosaics.json`, files in `mosaics/<kind>/`; nothing of a failed or canceled build kept; the tiles and point
  values with rio-tiler 2.1.2 and WebODM's colour maps plus the images' DJI palettes), the conversion's `mosaics`
  setting (on by default: built after converting), the API's `mosaics` (the viewer's data, POST to build),
  `mosaics/<tab>/tiles/<z>/<x>/<y>.png` (cached by the build time in the URL) and `mosaics/<tab>/point`, downloads
  `?mosaic=` and `mosaics/` in the zip. Front end: a new, slimmer `viewer.js` (tabs, palette and range, colour
  scale, readout, report, build and cancel; no export or measuring, which are part 2) and the Convert tab's mosaic
  parts. Leaflet is WebODM's 1.3.1, bundled from `leaflet/dist/leaflet-src.js` by `public/thermal/Leaflet.js` into
  `build/Leaflet.js` and `.css` (WebODM's plugin webpack makes `leaflet` an external, a global only its map pages
  have) and loaded through `PluginsAPI.SystemJS` with its format given as AMD (SystemJS guessed another from
  Leaflet's own wrapper). Fixed on the way: the point readout raised a 500 far from the mosaic (outside its
  projection's domain): points are checked against the bounds first. Tests: `test_analyzer.py` 38 (one building the
  mosaics of 6 M4T frames, its tiles, values and downloads), Jest 109. Live check: 12 M4T frames converted with
  mosaics (12 placed, seams median 0.24 °C, misalignment 0.4 cm), the card's progress and View mosaics, the four
  tabs over the satellite base layer, the palette and range, the readout, the dataset deleted.
- **(d) Create task and the README** — 2026-10-29, `analyzer-task`. `conversion_tasks.py` (the earlier
  `thermal_task.py`: what stops a task, the plan's warnings and options, the °C TIFFs hard-linked, else copied, into
  a task made in one transaction with WebODM's `TaskSerializer` checking the name and options, and no processing
  node; `thermal/conversions/<id>/tasks.json` lists the tasks made, those deleted dropped when read), the API's
  `conversions/<id>/task` (GET: what the task would be; POST: make it, refused over quota), the conversion's `tasks`
  and the dataset's `task_count`. Front end: the Create task panel in the conversion's card (no node choice, no
  preset: WebODM's Edit panel sets both), the tasks listed with their status and dashboard links, the conversion's
  delete dialog saying its tasks are kept. The README reread as the public page: the two paths first, the
  Analyzer in sections. Tests: `test_analyzer.py` 44 (one making a task from 3 converted M4T frames), Jest 116,
  Django 109 in all with `app.tests.test_plugins`. Live check: 12 M4T frames converted, the panel (the plan's
  warning and 7 options), a task of 12 images with 3 options and no node, WebODM's "Set a processing node"
  opening its Edit panel with the options as "(Custom)"; the task and dataset deleted.
