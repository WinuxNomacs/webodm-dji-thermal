# Developing the plugin

This page is for anyone changing the plugin's code, in a fork or a pull request: where things are, how to run them,
and the steps for the changes people make most often. The plugin has no extension API of its own. You change its
code, and these recipes show where.

The plugin follows WebODM's [plugin development guide](https://docs.webodm.org/plugin-development-guide). It has no
Django models or migrations (its data is kept in files and WebODM's data stores), it uses only the `PluginsAPI` hooks
and server signals WebODM has, and it never changes WebODM itself. It runs on WebODM 3.3.2 and 4.0.0, in Docker
(Linux, Windows, macOS) and from WebODM's native Windows installer.

## The code's map

Everything the plugin ships is in `dji-thermal/` (the plugin's id, and the release zip's single folder). Dev tools
(`dev/`, `package.json`, `eslint.config.mjs`, `ruff.toml`, `requirements-dev.txt`) stay outside it.

### The server (Python)

| Module | What it does |
| --- | --- |
| `plugin.py` | The plugin class: the menu entry, the pages (`app_mount_points`), the API routes (`api_mount_points`), the scripts loaded on every page, the JSX built by WebODM, and the task-removal signal. **Every page and API route is listed here.** |
| `api.py` | DJI Thermal Task's API: describe a photo, convert one photo into a partial task, a task's dataset and workset. |
| `converter.py` | R-JPEG to temperature TIFF, and access to [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/) (`library()`), which computes every temperature. |
| `analyzer_api.py` | The DJI Thermal Analyzer's API: datasets, uploads, the analysis, worksets (`conversions` in the code), downloads, the mosaic viewer's tiles and values, preferences. Holds `DatasetView` and `get_dataset` / `get_conversion`, which check WebODM's project permissions. |
| `analyzer_pages.py` | The Analyzer's pages: each renders a template from `templates/` with `common()` (the script version, the API's URL, the user's display preferences). |
| `datasets.py` | A dataset: a holder task of its project, with everything in the task's `thermal/` folder. JSON records written atomically (`write_json`) under a lock the web app and the worker share (`locked`). Background jobs: `start_job` and `run_job`. |
| `analysis.py` | The analysis job: dji-thermal-cli's check and WebODM plan over a dataset's photos. |
| `conversions.py` | Worksets: their settings (checked in `parse_settings`), the conversion job (`convert`), the outputs' names, the palettes (`palettes()`, `COLORMAPS`), and each user's saved defaults and display preferences. |
| `mosaics.py` | A workset's mosaics: the build job (`make`), and what the mosaic viewer reads (tiles, values, palettes). |
| `intensify.py` | Each pixel's difference from its surroundings (the median over about 2 m): the mosaic viewer's Intensify tab. |
| `colouring.py` | How tiles and frames are drawn: range, gamma's curve, Banded's bands (`stepped=`), sharpening, isotherm. |
| `frames.py`, `frames_api.py` | The frame page: one frame as the workset measured it, or measured again with other values. |
| `conversion_tasks.py` | A WebODM task made from a workset's temperature TIFFs. |
| `inspector.py`, `inspector_api.py` | The Thermal Inspector's reads of a task's thermal orthophoto (a point, a region, a line, tiles), and the workset mosaics it can lay on the map. |
| `measurements.py` | Saved measurements (pins, regions, lines), kept with the task or the workset. |
| `model3d.py`, `model3d_api.py`, `frames3d.py` | The 3D Thermal Inspector's reads of a task's textured model: which temperature TIFF is each of the GLB's materials, their values, the task's saved pins in the model's coordinates, and the photos that saw a point of it (see [The 3D view](#the-3d-view)). |
| `correction.py` | The approximate correction for another emissivity and reflected temperature. |
| `sdk.py`, `page.py` | DJI's own Thermal SDK, uploaded on the DJI Thermal page under Administration (`templates/sdk.html`). |
| `shapes.py` | Shapes, with WebODM's own GDAL (OGR). Never Django's GEOS or a compiled package of the plugin's. |
| `webodm_versions.py` | What differs between WebODM 3.3.2 and 4.0.0 (rio-tiler, a task's crop, the colour maps). Put any new difference here. |
| `portable.py` | Files the web app and the worker share, handled alike on Linux, macOS and Windows. Put any OS difference here. |

### The pages (JavaScript)

The Analyzer's pages and the Thermal Inspector are plain ES5 scripts in `public/`, each wrapped in the same pattern:
a function that receives `root` (the window) and exports its API both as `root.ThermalSomething` (for the browser)
and as `module.exports` (for Jest). A script that uses another reads it from `root`, or from `require` under Jest:

```js
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    // ...
    var api = {init: init, someHelper: someHelper};
    root.ThermalAnalyzerSomething = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
```

Keep the work in plain functions that take data and return HTML strings or values, and the DOM in `init` or
`create`, so Jest can test them.

| Script | What it does |
| --- | --- |
| `main.js`, `units.js` | Loaded on every WebODM page (`include_js_files`): DJI Thermal Task's button, the task panel's buttons, the Administration link, loading the Inspector on map pages; the temperature unit. Keep them small. They run on every page of WebODM. |
| `analyzer_core.js` | What the Analyzer's pages share: formatting, statuses, uploads in batches, reading the server's answers (`readJson`, `errorText`, `unreachable`), the dialog, and Pointer Info's Temperature On Pointer (`bindPointerTemperature`, `pointerLabel`) for the viewer and the frame page. |
| `datasets.js`, `dataset.js`, `conversions.js` | The datasets list, a dataset's page, and its Worksets tab. |
| `viewer.js` | The mosaic viewer. |
| `frame.js` | The frame page (it reuses the Inspector's statistics and forms). |
| `inspector.js` | The Thermal Inspector on WebODM's map. |
| `regions.js` | Drawing shapes on a Leaflet map, and the measuring tools' list (`TOOLS`). |
| `split.js`, `split.css` | A divider on a Leaflet map showing layers on one side of it, upright or across (the overlays' Swipe in the Inspector). Shared: it needs only Leaflet and knows nothing of this plugin, so another WebODM plugin can take both files as they are; its API is in its header (`create(L, map, opts)`, `add(layer, side)`, `turn()`, `on("change")`, the exported `clip`). TweakUI copies both files as they are: a change here is copied there. A plugin using it tells WebODM's split event (`sideBySideChanged(layer, true)` then `false`) each time its divider starts, and ends its own when it hears another's, so the dividers take turns. |
| `scale.js`, `recolour.js`, `frames.js` | Shared by the mosaic viewer and the Inspector: colour scales, the range's D-pad and the Image controls, tiles coloured in the browser (each value tile fetched once for the layers drawn from it), and the window of the frames that saw a point. |
| `picture_viewer.js` | The full-page picture viewer. |
| `mesh_index.js`, `model3d.js`, `pointcloud3d.js`, `pointcloud3d_worker.js`, `frames3d.js`, `inspector3d.js` | The 3D Thermal Inspector on WebODM's 3D page (see [The 3D view](#the-3d-view)). |
| `thermal/` | DJI Thermal Task's panel and the project page's workset progress: JSX and ES modules, built by WebODM's webpack into `public/build/` (untracked). |

The pages' HTML is in `templates/`, and their styles in `analyzer.css`, `frames.css`, `inspector.css` and
`inspector3d.css`.

### The 3D view

WebODM's 3D page (`ModelView.jsx`: Potree and three.js) shows a task's textured model or its point cloud, one at a
time. For a thermal task, ODM textured the model from the temperature TIFFs, and its GLB holds them as grey: the
temperatures themselves are in the float textures beside the OBJ (`odm_texturing/`).

| File | What it does |
| --- | --- |
| `model3d.py` | Which texture is each of the GLB's materials (the OBJ's first `usemtl` order, checked against the GLB's image sizes), their values (ODM's 0.0 fill between patches is no data; each material's PNG kept in `thermal/model3d/` by the textures' version), the model's range (cached in `thermal/model3d.json` by the textures' version), and the saved 2D pins in the model's coordinates. |
| `frames3d.py` | The photos that saw a point: ODM's refined cameras (`odm_report/shots.geojson`, `cameras.json`), a point projected into each photo as OpenSfM does (`project`: the `brown` and `perspective` lenses), each photo's temperature at its pixel, ranked by the angle from the surface's normal; and, for a task made from a workset, each photo's frame in the dataset. |
| `model3d_api.py` | `inspector/model`, `.../model/<index>/values` (the 2D map's value tiles, one per material), `.../model/saved`, `.../model/frames` and `.../model/frames/<index>/values`. |
| `main.js` | `PluginsAPI.ModelView.addActionButton`: loads `NAMES` and `NAMES_3D` (`DjiThermal3DScripts`) and the stylesheets (`inspector.css`, `frames.css`, `inspector3d.css`), then `ThermalInspector3D.create(viewer)`; the thermometer button once it resolves. The hook answers at once, with no dependencies: WebODM keeps only the first plugin's answer. |
| `inspector3d.js` | The panel, the tools (`TOOLS`, `TOOL_ORDER`), the measurements (in `localStorage`) and their markers (DOM elements and SVG lines, placed over the view each frame). It reuses `inspector.js`'s exported helpers for the colour scale, Image, Manual Corrections, the isotherm and the legend. |
| `model3d.js` | The model as a **source**: fetches each material's values, finds WebODM's model in the scene (`findModel`, `matchMaterials`) and gives it a canvas texture in the palette; reads a hit's temperature (`reading`). On the point cloud view, it loads its own copy of WebODM's smallest GLB, for its shapes only (`meshes()`). |
| `mesh_index.js` | A bounding-volume tree over the model's triangles (`build`): `raycast` (where the pointer meets the model) and `closest` (the nearest surface to a point). Runs in a page or a worker. |
| `pointcloud3d.js`, `pointcloud3d_worker.js` | The point cloud as a source: each node Potree loads goes to the worker, which finds every point's nearest model surface within `LIMIT` (25 cm) and answers its material and texture coordinates; the points are then coloured from the model's values, and restyled without asking again. A node's points are placed as Potree places them (`nodeMatrix`: the cloud's matrix times the node's own), never with three.js's `updateMatrixWorld`, which would add its parents' positions again. |
| `frames3d.js` | The photos that saw a spot, beside the panel (the 2D source frames window's markup and `frames.css`): leaves out those the model hides the spot from (`hidden`: a ray from just off the surface to the camera, with `MeshIndex.raycast`), shows each in the palette from its values with a crosshair, and what all of them read there (`spread`). Its camera is marked in the view by `inspector3d.js`. |

How a hover becomes a temperature: `inspector3d.spotAt` casts a ray from the pointer with `MeshIndex.raycast` (on the
point cloud: the point Potree picks, then `MeshIndex.closest`), which gives the hit's material and texture
coordinates (`uv`); the model source reads the texel there from that material's values (`valueAt`). Every colour and
every temperature comes from those values, never from the GLB's grey.

A **source** answers `ready`, `loaded()`, `shown()`, `restyle(style)`, `reading(hit)` and `detach()` (listed in
`model3d.js`'s header). `inspector3d.js` restyles every source in `sources` when the palette, range, Image or isotherm
changes, and reads the one shown.

### How a request flows

Take a dataset's analysis:

1. `analyzer_pages.dataset_page` renders `templates/dataset.html`, which loads `analyzer_core.js`, `dataset.js` and
   the rest with the plugin's version in their URLs (`?v=`, so a browser never mixes cached and new files).
2. `dataset.js` asks `GET /api/plugins/dji-thermal/datasets/<id>`, which `plugin.py` routes to
   `analyzer_api.DatasetDetail`. The view checks the user may view the project (`get_dataset`) and answers what
   `datasets` and `conversions` read from the dataset's JSON records.
3. Analyze sends `POST .../analyze`. The view calls `datasets.start_analysis`, which writes a new run id to the job
   file and hands `analysis.analyze` to WebODM's worker (`start_job`, with WebODM's `run_function_async`).
4. In the worker, `run_job` imports the plugin's module and runs the function, with a heartbeat thread (`beat`,
   every 2 seconds). The job writes its progress to the job file only while the file still has its run id, so
   cancelling or starting again stops it at its next write.
5. The page polls `GET .../datasets/<id>` and shows the job's progress and, once done, the analysis. Each poll checks
   the job (`check_stale`): a heartbeat 5 seconds late has it ask WebODM's worker whether it still has the job
   (`worker_has`, Celery's `query_task`, cached a few seconds), failing it when not; a job not started is marked
   `waiting` while no worker answers.

Conversions (`conversions.convert`), mosaics (`mosaics.make`) and the frame page's figures (`frames.measure_all`)
run the same way.

### Where data is kept

- **A dataset**: in its holder task's folder, under `thermal/` (`dataset.json`, `job.json`, `analysis.json`,
  `images/`), and its worksets under `thermal/conversions/<id>/` (settings, job, results, `output/`, mosaics). It
  counts toward the project owner's quota and is deleted with the task. The docstrings of `datasets.py`,
  `conversions.py`, `mosaics.py` and `measurements.py` list every file.
- **A user's preferences** (the unit, the palette, Temperature On Pointer, the Workset Creation Settings' saved defaults): WebODM's `UserDataStore`
  (`conversions.preferences_store`).
- **The administrator's default unit**: WebODM's `GlobalDataStore` (`conversions.default_unit`).
- **DJI's own SDK**: the plugin's persistent folder (`sdk.py`).

Write a record with `datasets.write_json` (written aside, then renamed) and change one under `datasets.locked(task)`.
Never write into the plugin's own folder, which an update replaces.

## Running it

What you need: Docker, Node (for Jest and ESLint) and [uv](https://docs.astral.sh/uv/) (for Ruff).

1. A WebODM checkout at the tag the dev images were built from, beside the plugin (`ignored/` is ignored by git):

   ```bash
   git clone https://github.com/WebODM/WebODM ignored/WebODM && git -C ignored/WebODM checkout v4.0.0
   git -C ignored/WebODM worktree add ../WebODM-3.3.2 v3.3.2      # only to run 3.3.2 too
   ```

2. `dev/webodm.sh up` runs WebODM 4.0.0 in dev mode on http://localhost:8002, with `dji-thermal/` mounted as one of
   its plugins: a change to the plugin's Python reloads the server, and a change to a script is live on the next
   page load. The first start takes several minutes (WebODM's migrations and build). `DT_WEBODM=3.3.2
   dev/webodm.sh up` runs 3.3.2 on port 8003. `dev/webodm.sh down`, `logs [service]` and `ps` do what they say.
3. WebODM's worker keeps the plugin's Python as it was when it started. After changing code a job runs, restart it
   (`docker restart dt-worker`).
4. After changing `public/thermal/`, rebuild it:
   `docker exec -w /webodm/coreplugins/dji-thermal/public dt-webapp webpack-cli`.
5. Host tools: `uv venv --python 3.9 .venv && uv pip install -r requirements-dev.txt`, then `npm ci`.

## Testing

- **Ruff** (Python 3.9 syntax, the oldest WebODM's): `.venv/bin/ruff check .`
- **ESLint**: `npm run lint -- dji-thermal`. `main.js` and the Analyzer's scripts are ES5, and `thermal/` is JSX.
- **Jest** (the scripts, under jsdom): `npm test`. The tests are in `dji-thermal/public/__tests__/`.
- **Django** (in the dev container, against WebODM itself):

  ```bash
  docker exec -w /webodm dt-webapp python manage.py test --noinput coreplugins.dji-thermal.tests.test_converter \
    coreplugins.dji-thermal.tests.test_api coreplugins.dji-thermal.tests.test_sdk coreplugins.dji-thermal.tests.test_analyzer \
    coreplugins.dji-thermal.tests.test_inspector coreplugins.dji-thermal.tests.test_frames coreplugins.dji-thermal.tests.test_model3d coreplugins.dji-thermal.tests.test_portable
  ```

  Run it in `dt3-webapp` too before you propose a change, since the plugin supports both versions. Never run two
  test runs in one stack at once: they share its test database.

The tests that need real R-JPEGs or DJI's SDK read them from your machine, set in an untracked `.env` at the repo
root, and are skipped without them. No image or DJI file is ever committed.

```
DT_SAMPLES_DIR=/path/to/dji_thermal_sdk/dataset   # DJI's Thermal SDK sample images, one folder per camera
DT_FLIGHT_DIR=/path/to/a/flight                   # a real flight's photos, thermal and RGB, in any subfolders
DT_SDK_ZIP=/path/to/dji_thermal_sdk_v1.8.zip      # DJI's Thermal SDK zip as DJI's site gives it
```

Name a test as a sentence that says what it checks ("a full disk keeps the images written before it and no part of
the next"). Then check the change in a browser against the dev server.

## Recipes

Each recipe lists every place a change touches. If you find another one, add it here.

### A palette

Palettes are DJI's (from dji-thermal-cli) and WebODM's colour maps (from WebODM's tiler). Every palette list (the
Preferences dialog, the mosaic viewer, the frame page and the Thermal Inspector) is built from these two. The mosaic
viewer also has its own palette for differences, `bwr` (`DIFFERENCE_PALETTE` in `mosaics.py`, its colours in
`colormaps.json`), listed with `saved: false` because it can't be a user's palette.

- **One of WebODM's colour maps**: add its name to `COLORMAPS` in `conversions.py`. `mosaics.palette_list` and
  `palette_keys` give it to the viewers, and the `display` API gives it to the Preferences dialog and the Inspector.
  If either WebODM version's tiler lacks it (4.0.0's has fewer), add its 256 colours (`RRGGBBAA`, index 0 to 255) to
  `colormaps.json`, as for `hot`, `rainbow` and `gray_r`: `webodm_versions.colormap_encoded` reads that file first.
  Check it on a thermal orthophoto in the Inspector in both stacks. The Inspector colours the orthophoto in the
  browser from its values tiles; the name only rides in the layer's tile URL, which WebODM's layer panel reads but
  nothing fetches.
- **A DJI palette**: palettes come from dji-thermal-cli's `PALETTES` and the colour tables in the photos. Add it
  there first, release it, then pin the new version in `requirements.txt`.

### A workset output

A workset's outputs are dji-thermal-cli's products (`temp_c:tiff`, `pseudo:png`, …): the Workset Creation Settings list
whatever `converter.library().outputs.PRODUCTS` has (`conversions.products()`), and `parse_settings` accepts any of
them.

1. Add the product to dji-thermal-cli, release it, and pin the new version in `requirements.txt`.
2. Its name in words: `PRODUCT_NAMES` in `conversions.py`, which the pages receive with the dataset.
3. If it is drawn in the palette: `COLOURED` in `conversions.py` **and** in `public/conversions.js`.
4. To write it by default: `DEFAULTS['outputs']` in `conversions.py`.
5. Update `docs/converted-images.md`, which describes each output.

An output the plugin makes itself, after dji-thermal-cli has written the frames, goes in `conversions.convert`. Write
it under the workset's `output/` folder and list it in the frame's `outputs` in `results.json`, so the Files list,
the downloads and the frame removal all see it.

A new tab in the mosaic viewer (another band of the mosaic dji-thermal-cli writes) goes in `TABS` in `mosaics.py`.
Its label and hint go in `TAB_LABELS` and `TAB_HINTS` in `viewer.js`. If it can be laid on WebODM's map, it also
goes in `MAP_TABS` in `inspector_api.py` and `MOSAIC_TABS` in `inspector.js`. A tab made from a mosaic rather than
read from it (as Intensify is, from the harmonized one) is written in `mosaics.build` beside the others' files in
`viewer/` (see `mosaics.intensified`) with its own entry in the built `kinds`, which isn't in `KINDS` (not a
download). A tab whose values are differences of temperatures goes in `DIFFERENCE_TABS` too, and is shown with
`isDifference` in `viewer.js`: scaled into the user's unit, never shifted.

### A measuring tool

The measuring tools (ΔT, pin, line, rectangle, circle, polygon) are on the Thermal Inspector's panel (`inspector.js`) and
the frame page's Measure section (`frame.js`). Both draw with `regions.js`. A new shape that reaches the server as a
GeoJSON `Polygon` or `LineString` needs no change to how it is measured: `inspector.raster_region` and
`frames.region` measure any of those. ΔT is the exception: its two spots are read as pins (`inspector.delta` from
`inspector_api.delta_values` on the map, `frames.delta` on a frame), asked for with `shape: "delta"`. A ΔT whose
spots were clicked on two layers (either side of a divider; `DrawTool`'s `onPoint` reports each click) keeps
their source keys (`sources`) and is read in the browser instead, each spot from its own layer's `point`
(`measureAcross`); `acrossLayers` tells it apart (not saveable, not kept in `localStorage`).

1. `regions.js`: add it to `TOOLS` (its icon and name), and teach `DrawTool` to draw it (`opts.shape`), turning
   what was drawn into GeoJSON as `circleRing` does for a circle.
2. `inspector.js`: add it to the mode buttons in `panelHtml` (`SHAPES` and `SHAPE_NAMES` follow `TOOLS`), with a hint
   if it is drawn with clicks. Choosing the mode starts a `DrawTool` for it.
3. `frame.js`: add it to `TOOLS`, in the order the buttons show.
4. `measurements.py`: add it to `SHAPES`, so it can be saved. A shape that needs more than its geometry to be drawn
   again (a circle keeps its centre and radius) is kept in `inspector_api.saved_record`.
5. Tests: `regions.test.js` for the geometry, `inspector.test.js` and `frame.test.js` for the button, and
   `test_inspector.py` for saving it.
6. Update `docs/quickstart-inspector.md` (the Inspector) and `docs/quickstart-worksets.md` (the frame page).

### A section in the Thermal Inspector's panel

The panel is drawn whole by `panelHtml(state)` in `inspector.js` on every change, from the `state` object `create`
keeps.

1. Write `somethingHtml(state, unit)` beside the other sections (`measurementsHtml`, `isothermHtml`): a plain function
   returning HTML, with every value escaped (`escapeHtml`) and its controls marked `data-act="something-..."`.
2. Add it to `panelHtml` as `'<div class="dt-inspector-section"><strong>Title</strong>' + somethingHtml(...) + '</div>'`
   where it belongs.
3. In `create`, keep what it shows in `state`, handle its `data-act` values in the panel's click, input or change
   listeners, and call `render()` after a change.
4. What it keeps per user and map goes in `localStorage`, under a key starting `dji-thermal-inspector:` (as the pins,
   always inside try/catch: storage can be missing). What is shared with the project goes to the server.
5. Styles go in `inspector.css`, under `.dt-inspector-...`, so they never reach WebODM's own elements.

A kind of layer laid on the map (Mosaic Overlays, Ortho Overlays) is an `overlaysHtml` dropdown at the bottom of the panel instead:
`{kind, title, open, items, controls}`, its tickboxes `data-act="<kind>-on"` in rows marked `data-<kind>`; the button
(`overlays-toggle`) opens `state.overlaysOpen[kind]`.
6. Test the HTML function and the behaviour in `inspector.test.js`.

### A tool in the 3D Thermal Inspector

The 3D panel's tools (Hover, ΔT, Pin) are the `TOOLS` table in `inspector3d.js`.

1. Add an entry to `TOOLS`: its `icon`, `name`, `title` (the button's tooltip), `hint` (shown while it's chosen) and
   `click(inspector, spot)`, called when the model is clicked with it. `spot` is `{point, reading}`: the point in the
   scene's coordinates and its reading (`{valid, temperature, reason}`, °C).
2. Put its name in `TOOL_ORDER`, where its button goes.
3. What it does goes in the `api` object `create` builds (beside `addPin` and `deltaSpot`). Keep what it makes in
   `state.measurements` with a `kind` of its own, so it's kept in `localStorage`, listed (`measurementsHtml`), drawn
   (`drawMarkers`) and exported (`measurementsCsv`): teach each of these the new kind.
4. A new reason for no temperature goes in `REASONS`.
5. Tests in `inspector3d.test.js` (its fake viewer clicks the model), and update `docs/quickstart-3d.md`.

### A source of temperatures in 3D

Something else on the 3D page to colour and read (splats, another task's model) is a new source.

1. A script in `public/`, in the pattern above, whose `source(viewer, ..., deps)` answers what `model3d.js`'s header
   lists. `restyle(style)` takes `recolour.js`'s style: `Recolour.tonedPalette` turns it into colours, and
   `style.isothermPaint` is painted over them. `detach()` puts the original look back.
2. Add the script to `NAMES_3D` in `main.js`, before `inspector3d.js` (`pages.test.js` checks the order).
3. In `inspector3d.js`'s `create`, make it, add it to `sources`, and teach `spotAt` to read it when it's shown.
   Heavy work (a lookup per point) goes in a worker, as `pointcloud3d_worker.js` does, loaded by its URL
   (`scriptUrl`), with every call the worker makes given in its message.
4. Tests in `public/__tests__/`, with a fake viewer as `pointcloud3d.test.js` has.

### An API route

1. Write the view in the module of its feature: `analyzer_api.py` (datasets and worksets), `inspector_api.py` (a
   task's thermal orthophoto), `frames_api.py` (the frame page) or `api.py` (DJI Thermal Task).
   - Subclass `DatasetView` (logged-in users), `InspectorView` (a task the user can view, or a public one) or
     `InspectorProjectView` (a project).
   - Get the dataset or workset with `get_dataset(request, pk, perm)` or `get_conversion(request, pk, cid, perm)`:
     `view_project` to read, `change_project` to write. They answer 404 for what the user can't see.
   - Refuse bad input with DRF's `ValidationError({'error': "What is wrong"})`. The pages show the `error` or
     `detail` they receive.
   - Writing files: wrap it in `with disk_full_refused():`, so a full disk is answered as such.
   - Anything long goes to the worker with `datasets.start_job`, never in the request.
2. Add a `MountPoint` to `api_mount_points` in `plugin.py`, using the patterns there (`DATASET`, `CONVERSION`, `TASK`).
   It is served under `/api/plugins/dji-thermal/`.
3. Call it from a page with `fetch(api + "...", {credentials: "same-origin"})`, and read the answer with
   `.then(core.readJson, core.unreachable)`. A write sends the page's CSRF token as `X-CSRFToken`: the Analyzer's
   pages read it from their `{% csrf_token %}` field (`input[name=csrfmiddlewaretoken]`).
4. Test it with DRF's `APIClient` in `tests/` (`AnalyzerTestCase` logs a user in, with their project, and its
   `create()` makes a dataset), including a user who may not see it.
5. Add it to `docs/api.md`.

### A page

1. A view in `analyzer_pages.py`: `@login_required`, `render` its template with `common(plugin, request)` and what
   the page needs (look up the dataset with `datasets.get`, raising `Http404` when it is not there, as
   `dataset_page` does).
2. A `MountPoint` in `app_mount_points` in `plugin.py`. Pages are served under `/plugins/dji-thermal/`.
3. A template in `templates/` extending `app/plugins/templates/base.html`, which keeps WebODM's menu and header:
   the page's elements with `data-api` and `data-public` attributes, `{% csrf_token %}`, then its scripts with
   `?v={{ v }}`.
4. Its script in `public/`, in the pattern above, ending with `init(document, window.fetch.bind(window))` when it
   runs in a browser, as `datasets.js` does. Use `analyzer.css`'s `.ta-` classes and add its own under `ta-`.
5. Link it from the page it belongs to.
6. Jest tests of its functions in `public/__tests__/`, a Django test that it answers (and 404s for a user without
   access), and a page in `docs/` if users will see it.

## Before proposing a change

- Every test passes on WebODM 4.0.0 and 3.3.2, and Ruff and ESLint are clean.
- The change works in a browser against the dev server, with the console free of new errors.
- `README.md` and the page in `docs/` that describes what changed are updated, with new screenshots if the
  screens changed (`dev/screenshots.js`). Screenshots never show where a flight was (coordinates, addresses, a
  basemap) or a camera's serial number.
- The pull request says what users will see change, for `CHANGELOG.md` at the next release.
