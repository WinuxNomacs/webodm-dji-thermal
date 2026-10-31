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
| GET | `.../mosaics/<tab>/tiles/<z>/<x>/<y>.png` | A map tile of a mosaic tab. |
| GET | `.../mosaics/<tab>/point?lon=&lat=` | The temperature, frame and view angle at a point. |
| GET | `.../mosaics/<tab>/frames?lon=&lat=`, `.../frames/<index>.png` | The frames that saw a point; one frame's picture. |
| GET, PUT, DELETE | `preferences` | Your saved workset settings (your defaults); save them; back to dji-thermal-cli's. |
| GET, PUT | `display` | Your palette and unit, with DJI's palettes and WebODM's colour maps; save them. |

## Thermal Inspector

On a task with a thermal orthophoto, under `projects/<project>/tasks/<task>/inspector/`. Temperatures are in °C.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `point?lon=&lat=` | The temperature at a point, or why there's none. |
| POST | `region` | A region's statistics and histogram, from a GeoJSON polygon. Nothing is kept. |
| GET | `tiles/<z>/<x>/<y>` | The orthophoto drawn in one of DJI's palettes. |
| GET | `isotherm/<z>/<x>/<y>` | An isotherm's tiles. |
| GET | `palette?name=` | A palette's colours, for the legend. |
