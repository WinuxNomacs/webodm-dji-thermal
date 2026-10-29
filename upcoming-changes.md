# Upcoming changes

## Phases (current and upcoming)

**Up next**
1. **Thermal Analyzer, part 1** — datasets kept in a holder task, their analysis, conversions, mosaics on the map,
   a conversion made into a task; the Analyzer at the root of the menu (below).
2. **Release 1.0.0** — README, changelog, zip, release check; in the directory and as a GitHub release (below).
   Prepared once on `release/1.0.0` (unmerged), to be redone on `main` after part 1 (dji-thermal-cli 1.9.0 is on
   PyPI since 2026-10-29).

**Later**
- **Thermal Analyzer, part 2** — measurements (spot, line, area), comparisons and frame views (below).
- **Pixel Inspector** — the map control (value under the cursor, region statistics), with its point and region
  endpoints served by the plugin (below).
- **Server-folder datasets** for administrators (photos read in place on the server), in the Analyzer; replaces
  the earlier "Folder conversion" item (below).

**Done**
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

## 2. Release 1.0.0

README (what it does, cameras, installing, using it, that it calls no outside service), `CHANGELOG.md`, the zip
(`dev/package.sh`), the `release-check` skill.

Open decision: **where to publish**. WebODM's docs point DJI users to Thermal Tools, a paid tool from WebODM's
maintainers, which this plugin would replace for those cameras. Submit it to WebODM-Plugins' directory as well,
or distribute it from this repo's releases only.

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

**Possible steps** (each merged when tested): (a) holder tasks, datasets, uploads and the analysis; (b)
conversions; (c) mosaics and the viewer; (d) Create task and the README.
