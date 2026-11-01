# The plugin's API

The plugin's pages use these HTTP endpoints, under `/api/plugins/dji-thermal/`. They're listed here for scripts and
integrations; they may change between versions. They take WebODM's usual authentication (a logged-in session, or
a token as for WebODM's own API) and its project permissions: viewing a project allows reading, changing it allows
writing, and deleting a dataset needs the project's delete permission. Requests that change something need
WebODM's CSRF token when sent from a browser session.

`<project>` and `<task>` are WebODM's project and task ids, `<dataset>` a dataset's id (a UUID), and `<workset>` a
workset's id (12 hexadecimal characters).

## Thermal Task

| Method | Path | What it does |
| --- | --- | --- |
| POST | `describe` | One thermal photo's camera, recorded measurement values and their ranges. Nothing is kept. |
| POST | `projects/<project>/tasks/<task>/convert` | Converts one photo into a partial task's images, with the measurement values sent with it. Answers `converted`, `ignored` (not a DJI thermal photo) or `failed` with the reason. |

## Thermal Analyzer

| Method | Path | What it does |
| --- | --- | --- |
| GET, POST | `datasets` | The datasets you can view; a new dataset. |
| GET, PATCH, DELETE | `datasets/<dataset>` | A dataset and its analysis; rename it; delete it. |
| POST | `datasets/<dataset>/upload` | Adds photos. |
| POST | `datasets/<dataset>/analyze`, `.../cancel` | Starts the analysis; cancels the running job. |
| GET, POST | `datasets/<dataset>/files` | One file as uploaded (`?file=`, `&download=1` to download); several files as a zip. |
| GET | `datasets/<dataset>/thumbnail` | A file's thumbnail (`?file=`, `?palette=`, `?size=large` for the detail pane). |
| GET, POST | `datasets/<dataset>/conversions` | The worksets; a new workset from settings. |
| GET, PATCH, DELETE | `datasets/<dataset>/conversions/<workset>` | A workset; rename it; delete it. |
| POST | `.../conversions/<workset>/cancel` | Cancels its conversion or mosaics. |
| GET | `.../conversions/<workset>/download` | The workset's files as a zip, or one of them. |
| GET, POST | `.../conversions/<workset>/task` | What a task from the workset would be (the plan's options, what stops it); makes the task. |
| POST | `.../conversions/<workset>/parent` | Sends the workset's TIFFs to the dataset's own task. |
| GET, POST | `.../conversions/<workset>/mosaics` | The mosaics as the viewer shows them; builds them. |
| GET | `.../mosaics/<tab>/tiles/<z>/<x>/<y>.png` | A map tile of a mosaic tab, over `rescale=min,max` in `color_map`, drawn with `gamma` (0.2 to 5), `sharpen` (0 to 5), and on temperatures `equalize=1` and `isotherm` (`above,T`, `below,T` or `between,A,B`, in the mosaic's unit: those pixels in the palette, the rest grey); the same for a frame's picture. |
| POST | `.../mosaics/<tab>/region` | A temperature tab's statistics inside a GeoJSON polygon or along a line, in °C, as the Thermal Inspector's `region`; a line's profile also names each sample's source frame. |
| GET | `.../mosaics/<tab>/isotherm/<z>/<x>/<y>.png?low=&high=&color=` | A temperature tab's isotherm tile, as the Thermal Inspector's `isotherm` (limits in °C). |
| GET | `.../mosaics/<tab>/curve?rescale=&gamma=&equalize=` | How the tab's images are drawn, for the colour scale: the palette's share at 65 values evenly across the range. |
| GET | `.../mosaics/<tab>/point?lon=&lat=` | The temperature, frame, frame pixel (the frame's column and row) and view angle at a point. |
| GET | `.../mosaics/<tab>/frames?lon=&lat=`, `.../frames/<index>.png` | The frames that saw a point; one frame's picture. |
| GET, PUT, DELETE | `preferences` | Your saved workset settings (your defaults); save them; back to dji-thermal-cli's. |
| GET, PUT | `display` | Your palette and unit, with DJI's palettes and WebODM's colour maps; save them. |

## Thermal Inspector

On a task with a thermal orthophoto, under `projects/<project>/tasks/<task>/inspector/`. Temperatures are in °C.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `point?lon=&lat=` | The temperature at a point, or why there's none. |
| POST | `region` | The statistics and histogram of a GeoJSON polygon, or of a line (a strip 0.25 m either side, with its length and profile), with the surroundings' mean and ΔT; `isotherm: {low, high}` (°C, either null) adds the share of its pixels within them. Nothing is kept. |
| GET | `tiles/<z>/<x>/<y>` | The orthophoto drawn in one of DJI's palettes. |
| GET | `isotherm/<z>/<x>/<y>` | An isotherm's tiles. |
| GET | `palette?name=` | A palette's colours, for the legend. |

On a project, under `projects/<project>/inspector/`, for those who can view it:

| Method | Path | What it does |
| --- | --- | --- |
| GET | `mosaics` | The workset mosaics of the project's datasets the Inspector can lay on the map: their temperature tabs, bounds, statistics and palettes, and the WebODM tasks processed from each workset's TIFFs (whose orthophotos show its source frames). |
| GET | `palette?name=` | A palette's colours, for a mosaic's legend. |
