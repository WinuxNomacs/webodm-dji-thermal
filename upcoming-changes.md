# Upcoming changes

## Phases (current and upcoming)

**Up next**
1. **Thermal task flow** — the plugin's own upload: R-JPEGs in, a WebODM task of temperature images out (below).

**Then**
2. **Release 1.0.0** — README, changelog, zip, release check; where to publish it (below).

**Later**
- **Folder conversion** for administrators (images already on the server), if wanted (below).
- **Thermal tools on the map** (temperature under the cursor, spot and area measurements): evaluate (below).

**Done**
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
| The admin page | an Administration menu for plugins | **missing**: `main_menu` with a superuser check instead |
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

## 1. Thermal task flow

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

## 2. Release 1.0.0

README (what it does, cameras, installing, using it, that it calls no outside service), `CHANGELOG.md`, the zip
(`dev/package.sh`), the `release-check` skill.

Open decision: **where to publish**. WebODM's docs point DJI users to Thermal Tools, a paid tool from WebODM's
maintainers, which this plugin would replace for those cameras. Submit it to WebODM-Plugins' directory as well,
or distribute it from this repo's releases only.

## Later: Folder conversion

The earlier plugin's page converts a folder on the server (overrides for the measurement parameters, the
camera's own conversion kept in `raw/`, a CSV report, progress and Cancel in the worker). It ports with
`main_menu` and a superuser check in place of the Administration menu. Open: wanted at all, since it needs server
paths (admins of a Docker install only).

## Later: Thermal tools on the map

The earlier work also has a map control (value under the cursor, pinned points, region statistics) and a larger
thermal workspace. The control uses only `PluginsAPI.Map` hooks, but reads raster values from point and
region-stats endpoints that WebODM 3.3.2 does not have: the plugin would serve them itself. The workspace keeps
its data in Django models, which a plugin may not have: it would need rewriting on data stores. To be evaluated
after 1.0.0.
