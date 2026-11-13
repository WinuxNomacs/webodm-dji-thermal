# The plugin's API

The plugin's pages use these HTTP endpoints, under `/api/plugins/dji-thermal/`. They're listed here for scripts and
integrations; they may change between versions. They take WebODM's usual authentication (a logged-in session, or
a token as for WebODM's own API) and its project permissions: viewing a project allows reading, changing it allows
writing, and deleting a dataset needs the project's delete permission. Requests that change something need
WebODM's CSRF token when sent from a browser session.

`<project>` and `<task>` are WebODM's project and task ids, `<dataset>` a dataset's id (a UUID), and `<workset>` a
workset's id (12 hexadecimal characters).

## DJI Thermal Task

| Method | Path | What it does |
| --- | --- | --- |
| POST | `describe` | One thermal photo's camera, recorded measurement values and their ranges, the palette it was shot in (`palette`) and DJI's palettes (`palettes`). Nothing is kept. |
| POST | `projects/<project>/tasks/<task>/convert` | Converts one photo into a partial task's images, with the measurement values sent with it, and the task's `palette` (one of DJI's, which its thermal map opens in). Answers `converted`, `ignored` (not a DJI thermal photo) or `failed` with the reason. |
| GET, POST | `projects/<project>/tasks/<task>/workset` | How far the workset converting a partial task's photos is (`status`, `progress`, `stage`, `error`, `photos`, whether the task has its images and started, `committed`, and its `task_error`; a converted workset's TIFFs not yet in the task go in then), 404 for a task without one; converts the photos uploaded to the task's dataset in a new workset (`settings`: the measurement values, `normalize` or `harmonize`, `max_pitch`, `palette`, and `mosaics`, off unless sent), whose TIFFs then go into the task, which starts processing on the node chosen. The dataset is analyzed meanwhile; with `plan_options`, the task gets the plan's recommended options once that is done. `frames`: the thermal photos to convert, answered as `photos`. |
| POST | `projects/<project>/tasks/<task>/workset/start` | Tries again to put the converted workset's TIFFs in a task that is still waiting for them after that failed, and starts it; answers as the GET above. Needs the right to change the project. |
| POST | `projects/<project>/tasks/<task>/dataset` | The task's DJI Thermal Analyzer dataset, `{id}`: the task itself if it's one, the one it's linked to, or else the task made a dataset, kept in it (201). Needs the right to change the project. |

## DJI Thermal Analyzer

| Method | Path | What it does |
| --- | --- | --- |
| GET, POST | `datasets` | The datasets you can view; a new dataset. |
| GET, PATCH, DELETE | `datasets/<dataset>` | A dataset and its analysis (while it runs, `progress` and `stage`: `summary` once every file is checked and the coverage and plan are worked out); rename it; delete it. |
| POST | `datasets/<dataset>/upload` | Adds photos. |
| POST | `datasets/<dataset>/analyze`, `.../cancel` | Starts the analysis; cancels the running job. |
| POST | `datasets/<dataset>/remove` | Deletes images from the dataset (`files`: their paths), and from each converted workset that has them (as its `remove`), and drops them from the analysis' `files`, which is kept but no longer matches the images (`status` back to `new`). Answers the dataset, with `files_removed`. Refused while it is analyzed or a workset converts or builds its mosaics, and when a workset would be left without a converted frame. |
| GET, POST | `datasets/<dataset>/files` | One file as uploaded (`?file=`, `&download=1` to download); several files as a zip. |
| GET | `datasets/<dataset>/thumbnail` | A file's thumbnail (`?file=`, `?palette=`, `?size=large` for the detail pane, `?size=list` for the frame page's list; `?workset=` also for a frame that workset converted, in a dataset not analyzed). |
| GET, POST | `datasets/<dataset>/conversions` | The worksets, each with how many images it `converted`, left out as `oblique`, found `not_thermal` and `skipped` (failed), and while it converts its `progress`, harmonizing `stage` (`stage`, `step`, `steps`, `fraction`) and `frames` (`done`, `total`: the frames to convert, thermal and within the pitch limit); a new workset from settings. |
| GET, PATCH, DELETE | `datasets/<dataset>/conversions/<workset>` | A workset, with each frame's `figures` (`min`, `max`, `mean`, `reflected`, `ambient` in °C, `emissivity`, `humidity`, `distance`, `distance_source`, as it measured them) and how far measuring them is (`figures_status`, `figures_progress`, `figures_error`; a workset converted before they were measured starts measuring them); rename it; delete it. |
| POST | `.../conversions/<workset>/figures` | Measures its frames' figures again. |
| POST | `.../conversions/<workset>/remove` | Removes frames from a converted workset (`frames`: their paths): their files and the measurements saved on them are deleted, and they move from `results.files` to `results.removed` (`path`, `removed_by`, `removed_at`), so new tasks and mosaics leave them out. Answers the workset, with `frames_removed`; its `removed` counts them, and `mosaic_outdated` says its mosaics were built with frames since removed. Refused while its mosaics are being built, and for the last converted frame. |
| POST | `.../conversions/<workset>/cancel` | Cancels its conversion or mosaics. |
| GET, POST | `.../conversions/<workset>/download` | The workset's files as a zip, or one of them (`?file=`, `?mosaic=<kind>/<file>`); some of them as a zip (`file` and `mosaic`, repeated: a form posted; the mosaics' in `mosaics/`). |
| GET, POST | `.../conversions/<workset>/task` | What a task from the workset would be (the plan's options, what stops it); makes the task. |
| POST | `.../conversions/<workset>/parent` | Sends the workset's TIFFs to the dataset's own task. |
| GET, POST | `.../conversions/<workset>/mosaics` | The mosaics as the viewer shows them; builds them. A workset lists the mosaics built in its `mosaics` (`kind`, `frames`, `oblique`, `unusable`, `width`, `height`, `gsd_m`, `min` and `max` in `unit`, `normalization`, dji-thermal-cli's `report`, `preview`, and `files` with each one's `name` and `size`). |
| GET | `.../mosaics/<kind>/preview` | A mosaic's preview as a small PNG (`as_converted` or `harmonized`; `?size=large` for the detail pane). |
| GET | `.../mosaics/<tab>/tiles/<z>/<x>/<y>.png` | A map tile of a mosaic tab, over `rescale=min,max` in `color_map`, drawn with `gamma` (0.2 to 5), `sharpen` (0 to 5), and on temperatures (and `intensify`'s differences) `stepped=width,origin` (flat bands of that width in the mosaic's unit, their edges at `origin` plus whole widths, each drawn in the colour at its middle) and `isotherm` (`above,T`, `below,T` or `between,A,B`, in the mosaic's unit: those pixels in the palette, the rest grey); the same for a frame's picture. |
| POST | `.../mosaics/<tab>/region` | A temperature tab's statistics inside a GeoJSON polygon or along a line, in °C, as the Thermal Inspector's `region`; a line's profile also names each sample's source frame. With `shape: "delta"`, a ΔT's figures, as the Inspector's. |
| GET | `.../mosaics/<tab>/isotherm/<z>/<x>/<y>.png?low=&high=&color=` | A temperature tab's isotherm tile, as the Thermal Inspector's `isotherm` (limits in °C). |
| GET | `.../mosaics/<tab>/values/<z>/<x>/<y>.png` | The values (in the tab's unit) a tile is drawn from, for the browser to colour: a PNG whose red and green hold a 16-bit code (the value is `X-Values-Offset` + code × `X-Values-Step`), blue the source frames' seams (1 and 2), alpha where there are values, with `X-Values-Margin` more pixels on each side and the sharpening's sigma in `X-Sharpen-Sigma`. |
| GET | `.../mosaics/<tab>/curve?rescale=&gamma=` | How the tab's images are drawn, for the colour scale: the palette's share at 65 values evenly across the range. |
| GET | `.../mosaics/<tab>/point?lon=&lat=` | The temperature, frame, frame pixel (the frame's column and row) and view angle at a point; `difference` on the temperature tabs (the temperature less the median within about 2 m; on `harmonized` Intensify's value); on `intensify`, `difference` is the tab's value, with `temperature` the harmonized mosaic's. |
| GET | `.../mosaics/<tab>/frames?lon=&lat=`, `.../frames/<index>.png` | The frames that saw a point; one frame's picture. |
| GET | `.../conversions/<workset>/frames` | The frame page's list: the dataset's thermal frames (`path`, `time`, `pitch`, `converted`, `mosaic`: its place among the mosaics' frames or null), the workset's unit, whether it normalized or harmonized, the mosaics' pitch limit, the palettes and your default. |
| GET | `.../conversions/<workset>/frame?frame=` | A frame measured as the workset converted it, or with `distance`, `humidity`, `emissivity`, `reflected_temp`, `ambient_temp` changed (temperatures in the workset's unit): its size, what the SDK measured with (`params`, °C), what the camera recorded, the distance's source, notes, the normalization's offset and its range, mean and percentiles. |
| GET | `.../conversions/<workset>/frame/values?frame=` | The frame's values (with the same changes) for the browser to colour, as a mosaic tab's `values` with no margin. |
| POST | `.../conversions/<workset>/frame/region` | What a pin, line or polygon drawn in a frame's pixels (`geometry`, x right and y down, with `frame`, `changes` and `isotherm` in °C) measures, in °C, as the Thermal Inspector's `region`; sizes in pixels. With `shape: "delta"`, a ΔT's figures, its length in pixels. |
| GET | `.../conversions/<workset>/frame/download?frame=&kind=` | The frame's temperatures (with the changes) as `csv` or a float `tiff`. |
| GET, POST | `.../conversions/<workset>/frame/measurements` | The measurements saved on the workset's frames (`?frame=` those of one) and whether you can change them; saves one (`name`, `comment`, `shape`, `frame`, `changes`, `geometry`, `isotherm`), measured on the server. |
| PATCH, DELETE | `.../conversions/<workset>/frame/measurements/<id>` | Renames a measurement saved on a frame or changes its comment; deletes it. |
| GET, POST | `.../conversions/<workset>/measurements` | The measurements saved on the workset's mosaics, with what they were measured with (`baseline`) and whether you can change them; saves one, as the Thermal Inspector's `measurements`, with the `tab` it was measured on. |
| PATCH, DELETE | `.../conversions/<workset>/measurements/<id>` | Renames a saved measurement or changes its comment; deletes it. |
| GET, PUT, DELETE | `preferences` | Your saved workset settings (your defaults); save them; back to dji-thermal-cli's. |
| GET, PUT | `display` | Your palette, unit (`C`, `F` or null: not chosen; with the administrator's `default_unit`) and whether the Thermal Inspector shows its legend, with DJI's palettes and WebODM's colour maps; save them (those sent). |
| GET | `unit` | The temperature unit, for anyone (no login needed): `logged_in`, your `unit` (or null) and the administrator's `default_unit`. |

## Thermal Inspector

On a task with a thermal orthophoto, under `projects/<project>/tasks/<task>/inspector/`. Temperatures are in °C.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `point?lon=&lat=` | The temperature at a point (°C), or why there's none; `difference`: the temperature less the median of the pixels within about 2 m around it (inside the crop). |
| POST | `region` | The statistics and histogram of a GeoJSON polygon, or of a line (a strip 0.25 m either side, with its length and profile), with the surroundings' mean and ΔT; `isotherm: {low, high}` (°C, either null) adds the share of its pixels within them; `correction: {emissivity, reflected}` (°C) corrects the temperatures first, from what the orthophoto's TIFFs record (refused when they don't). Nothing is kept. The mosaics' `region` takes the same. With `shape: "delta"` and a line of two points, a ΔT instead: `{valid, reason, first, second, delta_t, reasons, length, measured, correction}`, each spot (°C) read as a pin reads it, corrected, `delta_t` the second less the first, `reasons` why each spot has no temperature, `length` in metres. |
| GET, POST | `measurements` | The measurements saved on the task's orthophoto, with what it was measured with (`baseline`: `{emissivity, reflected}` or null), whether you can change them (`can_change`) and the palette it opens in for a user without one of their own (`palette`, chosen in DJI Thermal Task, or `""`); saves one (`{name, comment, shape, geometry, circle, isotherm, correction}`: a pin's `geometry` a point, a `delta`'s a line of two points), measured on the server. |
| PATCH, DELETE | `measurements/<id>` | Renames a saved measurement or changes its comment (`{name, comment}`); deletes it. |
| GET | `tiles/<z>/<x>/<y>` | The orthophoto drawn in a palette (`palette=`: one of DJI's or WebODM's colour maps) over `rescale=` (°C), with WebODM's `size` and `crop` and the mosaics' adjustments (`gamma`, `stepped=width,origin` in °C, and `sharpen`). |
| GET | `values/<z>/<x>/<y>` | The values (°C) a tile is drawn from, with WebODM's `size` and `crop`, as the mosaics' `values` (its ETag is the orthophoto's version). |
| GET | `curve?rescale=` | How the tiles share the palette out over the range with `gamma`, for the legend. |
| GET | `isotherm/<z>/<x>/<y>` | An isotherm's tiles. |
| GET | `palette?name=` | A palette's colours, for the legend. |
| GET | `model` | The task's textured 3D model as temperatures, for the 3D Thermal Inspector: its `version` (of ODM's textures), `unit` (`C`), `materials` (in the GLB's order: each `name`, `width` and `height`), `range` (`min`, `max`, `low` and `high`: the 2nd and 98th percentiles, without the empty space between the texture's patches), `baseline` and `palette` as `measurements` gives them. 404 when the model's textures aren't temperatures or don't match the GLB. |
| GET | `model/<index>/values` | One material's temperatures (°C), its texture's size, as the `values` tiles (no margin; its ETag is the model's version). |
| GET | `model/saved` | The pins saved on the task's orthophoto (as `measurements` lists them), each with its `x` and `y` in the model's coordinates (the orthophoto's projection): `{pins}`. |
| GET | `model/frames?x=&y=&z=` | The task's photos that saw a point of the model (its coordinates), placed with the cameras ODM refined (`odm_report/shots.geojson`, `cameras.json`), most squarely first from the surface's normal (`&nx=&ny=&nz=`, else from straight down): each one's `index`, `file`, `x` and `y` (its pixel there: pixel centres at whole numbers), `width`, `height`, `camera` (where it was taken from), `view_angle`, `distance`, `temperature` (°C at its nearest pixel) and `available`, and its `frame` in the dataset when the task came from a workset (`workset`: `{dataset, workset}`, else null). 404 without ODM's cameras. |
| GET | `model/frames/<index>/values` | One photo's temperatures (°C), as the `values` tiles (no margin; its ETag is the photo's file and the cameras'). |

On a project, under `projects/<project>/inspector/`, for those who can view it:

| Method | Path | What it does |
| --- | --- | --- |
| GET | `mosaics` | The workset mosaics of the project's datasets the Inspector can lay on the map: their temperature tabs, bounds, statistics and palettes, and the WebODM tasks processed from each workset's TIFFs (whose orthophotos show its source frames). |
| GET | `palette?name=` | A palette's colours, for a mosaic's legend. |
