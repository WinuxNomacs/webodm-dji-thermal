# Upcoming changes

## Phases (current and upcoming)

**Up next**
1. **dji-thermal-cli for Python 3.9** — a release of the library that installs in WebODM's Python (below).

**Then**
2. **Conversion core** — R-JPEG to temperature TIFF in the plugin, server side, with tests (below).
3. **Thermal task flow** — the plugin's own upload: R-JPEGs in, a WebODM task of temperature images out (below).
4. **Release 1.0.0** — README, changelog, zip, release check; where to publish it (below).

**Later**
- **Folder conversion** for administrators (images already on the server), if wanted (below).
- **Thermal tools on the map** (temperature under the cursor, spot and area measurements): evaluate (below).

**Done**
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
- The conversion runs in **the plugin's own upload flow**, with no change to WebODM (phase 3).
- **dji-thermal-cli gets a release for Python 3.9**, rather than being copied into the plugin (phase 1).

## 1. dji-thermal-cli for Python 3.9

In the library's own repository (the user's package: Claude prepares the `release/X.Y.Z` branch there, the user
publishes).
- `requires-python = ">=3.9"`; CI and the lowest-direct resolution also on 3.9 with numpy 1.26.2 and
  Pillow 11.3.0; `test_packaging.py` without `tomllib` on 3.9 (`tomli`, or skip there); Ruff's target py39.
- A minor version (1.7.0): it widens what installs it, with no API change.
- Then the plugin's `requirements.txt`: `dji-thermal-cli==1.7.0`, `numpy==1.26.2`, `pillow==11.3.0` (WebODM runs
  `pip install -U --target` with dependencies, and an unpinned numpy would land in the plugin's site-packages,
  ahead of WebODM's own).

Open: none, unless the library's own plan says otherwise.

## 2. Conversion core

- `dji-thermal/converter.py`: detection, decoding with the camera's recorded parameters, the TIFF with the
  source's metadata and `Camera:BandName` = `LWIR` (`exiftool_camera.config`), never raising (a failed file is
  left as it is and logged).
- `Plugin.enable()` logs whether dji-thermal-cli loads; imports through `python_imports()` (the plugin's
  site-packages).
- Django tests on R-JPEGs (detection, the TIFF's values and tags, a corrupt file, an RGB photo from the same drone).

Open decisions:
- **Which cameras**: every camera dji-thermal-cli decodes, or the M4T only, as before.
- **Test images**: DJI's SDK sample images may not be redistributable in a public repo; use the user's own, or
  keep them out of git (a download step for the tests).

## 3. Thermal task flow

- **A "Thermal task" button** beside "Select Images and GCP" (`Dashboard.addNewTaskButton`): the user picks the
  flight's R-JPEGs (and a GCP file), the name and options as for any task.
- **Upload to the plugin**: the plugin creates a partial WebODM task in the project, receives the files on its own
  API mount point (one request per file, like WebODM's upload), converts each R-JPEG as it arrives and saves the
  TIFF in the task's folder, then commits the task, which then processes like any other.
- **Options**: on the Task Options hook, the plugin can set or suggest the options a temperature dataset needs (no
  `radiometric-calibration` for converted DJI images, per WebODM's docs).
- Progress, errors per file (a file that fails stays out, with the reason), permissions as WebODM's own upload.

Open decisions:
- **Mixed folders**: the M4T and others save RGB (`_V`, `_W`, `_Z`) and thermal (`_T`) photos side by side: skip
  the RGB ones, refuse them, or offer a second (RGB) task.
- **Measurement overrides at upload** (distance, humidity, emissivity, reflected temperature), or the camera's
  values only.
- **Resize**: thermal frames are small (640x512, 1280x1024); offer it or not.

## 4. Release 1.0.0

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
