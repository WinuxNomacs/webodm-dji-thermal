# Upcoming changes

## Phases (current and upcoming)

**Up next**
- **R7. The documentation reviewed before the release** (the user, 2026-11-08, in `new.md`): "Review and update
  the documentation as necessary so that it's information is accurate prior to release." Builds on everything
  since 1.1.0 (R1 to R6). Proposed: every page of `docs/` and the README read against the code
  as it is (what each page, panel, button and setting says it does, the API reference, the developers' guide's
  map), corrected where it's wrong or out of date, and the screenshots checked against the UI (retaken where they
  differ, none showing a place, coordinates or a serial number). No release prepared: that waits for the user.
  Open: none (the inspector.png retake waits on a neutral task name, as noted in R6).

**Later**
- **Kelvin on screen** (the user, 2026-11-07: dropped from the header unit, "we may decide to add it back later if
  webodm adds more traditional Kelvin support"): only once WebODM's units offer it.
- **Server-folder datasets** for administrators (photos read in place on the server), in the Analyzer; replaces
  the earlier "Folder conversion" item (below).

**Done**
- **R5. Bug: on WebODM 4.0.0 the Thermal Inspector can't draw a thermal orthophoto in hot, rainbow or gray_r**
  (found 2026-11-08 while building R4, in 1.1.0): with no Image adjustments, `inspector.js` `withPalette` sends a
  WebODM colour map to WebODM's own tiles (`.../orthophoto/tiles/...?color_map=hot`), and 4.0.0's tiler no longer has
  those three (the plugin carries them in `colormaps.json` for its own tiles only): WebODM answers 400 "Not a valid
  color_map value" and the map shows nothing. 3.3.2 has them. Proposed fix: those three drawn by the plugin's
  Inspector tiles, as DJI's palettes are (the `display` API names the colour maps WebODM's tiler lacks); a test, and
  a check on both stacks.
  Checked 2026-11-08: not a bug the user can see. The Inspector colours a thermal orthophoto in the browser from its
  value tiles (`recolour.js`, `drawFromValues` in `inspector.js` `watch`), whatever its palette, so the layer's URL
  with `color_map=hot` is never fetched: on 4.0.0, hot, rainbow and gray_r draw, chosen in the Inspector or saved as
  the preference, and WebODM's layer panel makes no request that fails (headless, on `main` and on the fix). The
  400 came only from asking WebODM for the tile directly. The fix (the display API's `own_colormaps`, the layer's
  URL pointed at the plugin's tiles in them, a Jest and a Django test) is on branch `r5-inspector-colormaps`, not
  merged.
- **R6. The difference from the surroundings under the cursor, on every page with Under the cursor** (built 2026-11-08; the user,
  2026-11-08, in the session): "Add the temperature Difference feature for Under the Cursor to the rest of the pages
  with the same control". Builds on R4: the mosaic viewer's Intensify tab shows, under the cursor, "Difference
  +2.13 °C from its surroundings" beside the temperature. The pages with an Under the cursor section are the mosaic
  viewer (`viewer.html`: its other tabs show the temperature, frame, frame pixel and view angle) and the frame page
  (`frame.html`: the temperature, and with Measure again "As converted", "Parameters changed" and their
  "Difference").
  Proposed:
  1. **The mosaic viewer**: on Mosaic, Harmonized and Source frame, the same row as on Intensify: the pixel's
     difference from the median of the pixels around it over 2 m. Harmonized reads it from Intensify's raster (the
     same number as on Intensify); Mosaic and Source frame from the as converted mosaic, around the point (the
     server's `point`, a window about 2 m wide read around it). Not on View angle (not temperatures).
  2. **The frame page**: the same row for the frame (and for the frame with the parameters changed, when shown),
     worked out in the browser from the frame's values it already has, over 2 m at the frame's ground resolution
     (sent with the frame).
  3. The row's name: the frame page already has a "Difference" row (parameters changed less as converted).
  Open: the row's name on every page (proposed: "Surroundings", e.g. "-2.60 °C", Intensify's row renamed alike);
  whether the Thermal Inspector's Hover readout on WebODM's map gets it too (it has no Under the cursor section;
  proposed: not now).
  Decided (the user, 2026-11-08): the row is "Delta T from Surroundings" (written "ΔT from surroundings", as the
  Inspector's regions write ΔT), Intensify's row renamed alike; the Thermal Inspector's Hover reading gets it too
  (thermal orthophotos and the workset mosaics laid on the map).
  Built, `r6-surroundings-readout`: `intensify.raster_difference` and `window_difference` (a point less the median of
  a window about 2 m wide around it); `mosaics.point` gives `difference` on Mosaic and Source frame (the as converted
  mosaic, around the point) and Harmonized (Intensify's value when built, else alike: mosaics built before R4 have it
  too); `inspector.point` on a thermal orthophoto (its pixels with data inside the crop); `frames.info` sends `pixel_m`
  (the measurement distance over dji-thermal-cli's `read_pose` focal length in pixels) and `size_m`, and `frame.js`
  `surroundingsAt` works it out from the frame's values, for both measurements with Measure again ("ΔT from
  surroundings, changed"). The Inspector shows it under the temperature in the panel (a mosaic's scaled to °C; with
  Manual Corrections, `corrected(t) - corrected(t - ΔT)`), not in the label beside the cursor. Tests: Jest 303, Django
  214 on 4.0.0 and 3.3.2 (1 skipped). Live on :8002, read only, on the user's HomerunObliqueII task and dataset:
  "+0.60 °C" on Mosaic, "+0.89 °C" on Harmonized (as Intensify would: its mosaics were built before), none on View
  angle; a point request in about 70 ms; the frame page "+0.49 °C"; the Inspector "52.52 °C ΔT from surroundings
  +1.97 °C". Docs: the README, `quickstart-worksets.md`, `quickstart-inspector.md`, `measurement.md`, `api.md`,
  `developing.md`; `frame-page.png` retaken. `inspector.png` kept as it was: retaken, its title showed the task's name
  (HomerunObliqueII), which the docs' shots never show; to retake once the task has a neutral name.


- **R4. Intensify: a mosaic tab of each pixel's difference from its surroundings** (built 2026-11-08; the user, 2026-11-08, in the
  session): "would it make sense to offer an \"Intensify\" option that actually makes temperature variances more
  distinct across the images? Example: I have a mosaic of a roof made from 10 images. Around pipe seams there's a
  temperature delta variance that's roughly 2-3 degrees cooler than the surrounding roof due to air seepage", then
  "Let's start by just adding it as a tab to view next Harmonized view tab." Builds on the mosaic viewer's tabs
  (`mosaics.TABS`, `viewer.js` `TAB_LABELS`, `analyzer_api` mosaic info), its tiles and value tiles, readings and
  frame page, and the display adjustments (`colouring.py`: range, gamma, equalize, sharpen, isotherm), which stay as
  they are. Neither normalizing nor harmonizing evens out a local difference (one number per frame), and the display
  adjustments can't follow a roof's gradients and slopes with one range; this can.
  Proposed:
  1. **What it shows**: the harmonized mosaic less its local background, each pixel's median over a neighbourhood
     wider than a seam and narrower than a slope (in metres, from the mosaic's ground resolution): gradients, slopes
     and the sun's side go to about 0, a seam 2-3 °C cooler than the roof beside it shows -2 to -3. A difference,
     in the mosaic's unit (°F: ×1.8, no offset).
  2. **Built with the mosaics**, in the worker, as a third raster beside the two (`viewer/intensified.tif`), so its
     range, histogram (equalize), readings and tiles work as the others' do; numpy only (the median over coarse
     blocks, interpolated: a median filter that wide is slow, and WebODM's scipy isn't the plugin's to rely on).
  3. **The tab**: "Intensify", after "Harmonized" in the mosaic viewer; its own palette and range (not shared with
     the temperature tabs, which share theirs), the range symmetric about 0 by default; a hint saying what it shows
     and that its numbers are differences, not temperatures. A reading shows both: "28.4 °C, -2.6 °C from its
     surroundings". Its isotherm works on the differences ("below -1.5"). The frame page opened from it shows the
     frame's differences the same way (the frame's own harmonized temperatures less their background).
  4. Not in this phase: the Thermal Inspector's map, the downloads, a size changed live on the tab.
  Open: the neighbourhood (proposed: fixed at 2 m for now, in the hint); a palette for differences (proposed: a
  blue-white-red one added, the tab's default: WebODM's colour maps and DJI's palettes have none centred on a
  value); mosaics built before (proposed: the tab appears after "Build mosaics again", nothing built on its own).
  Decided (the user, 2026-11-08): the neighbourhood fixed at 2 m; a blue-white-red palette added, the tab's default
  (offered on the other tabs too); mosaics built before get the tab after "Build mosaics again".
  Built, `r4-intensify`: `intensify.py` (`differences`: the medians of windows 2 m wide every metre, interpolated
  between, numpy only; a 5000x5000 mosaic in about 2 s); `mosaics.intensified` writes `viewer/intensify.tif` from the
  harmonized mosaic in the build, kept as `kinds.intensify` (`of: harmonized`, `size_m`; not in `KINDS`: not a
  download, nor in the workset's Mosaics table); `TABS` and `DIFFERENCE_TABS`, `in_unit` (equalize, isotherm,
  histogram), `point` gives `difference` and the harmonized `temperature`, `frame_values` the frame's own differences
  (at its ground resolution, `height_m / focal_px`): that is the frames window over the map; the frame page itself
  shows temperatures and doesn't offer the palette. The palette `bwr` in `colormaps.json`, listed with `saved: false`
  (not a preference: `display_palettes` refuses it, so the viewer doesn't send it), not in the Thermal Inspector's
  list (`palette_keys`). `viewer.js`: `isDifference`, `inUnit`, values shown and typed with `convertDelta`, the range
  symmetric about 0, the report the harmonized mosaic's. Tests: Jest 301 (the tab, its unit, palette, isotherm,
  readout), Django 213 on 4.0.0 and 3.3.2 (1 skipped; the synthetic roof, and the tab on a flight's mosaics). Live on
  :8002 with 40 frames of the M4T flight (its own project, removed after): the tab after Harmonized, its range
  -2.7 to 2.7 °C, the readout "+2.13 °C from its surroundings" with the temperature, the frames window, an isotherm
  below -1. Docs: the README, `quickstart-worksets.md`, `measurement.md` (what normalize and harmonize change, and
  "Finding small differences: Intensify", with `mosaic-intensify.png`), `palettes.md`, `api.md`, `developing.md`; the
  mosaic viewer's screenshots retaken (from the live check's dataset: the user's worksets have mosaics built
  before).


- **R3. A link to WebODM's community Discord in the README** (built 2026-11-08; the user, 2026-11-08, from `new.md`): "Add a link
  near the bottom of the README to Join the WebODM Community Discord: https://discord.gg/hYDk9f28J". Builds on the
  README's end (Developing, Thanks, License). Proposed: a short section of its own, "Community", between Developing
  and Thanks, with one line: "Questions, ideas or help with WebODM: [join the WebODM Community
  Discord](https://discord.gg/hYDk9f28J)." No other page changes (the docs' index links the README).
  Open: the invite (WebODM's docs, `commercial-providers.md`, use https://discord.gg/RxHPXCSMBS; two invites can
  both lead to the same server, but one may expire); where it goes (proposed: its own section before Thanks).
  Decided (the user, 2026-11-08): WebODM's invite, https://discord.gg/RxHPXCSMBS, as its docs use; a section of its
  own before Thanks.
  Built, `r3-community-link`: the README's "Community" section, between Developing and Thanks.

- **R2. The code made easy to extend** (built 2026-11-07; the user, 2026-11-07, from `new.md`): "This plugin's codebase is meant to be
  extensible to make it as simple as possible for other developers to add their own WebODM DJI Thermal Analyzer
  modifications. Review the code structure and refactor as needed to make the code as accessible as possible for
  future updates and additions." Builds on the plugin's modules (about 18,700 lines: the server's `plugin.py`,
  the APIs `api.py`, `analyzer_api.py`, `inspector_api.py`, `frames_api.py`, the work in `conversions.py`,
  `mosaics.py`, `datasets.py`, `frames.py`, `inspector.py`; the pages' `public/*.js`, largest `inspector.js` 2,212
  lines, `conversions.js` 1,632, `dataset.js` 1,219, `frame.js` 927; DJI Thermal Task's JSX in `public/thermal/`).
  Proposed, after R1 (whose fixes and tests then guard the refactor):
  1. **A developer's guide** (`docs/developing.md`, linked from the README and `CLAUDE.md`): the code's map (what
     each module does, how a request flows from a page to the worker and back, where data is kept), how to run
     the dev stacks and the tests, and recipes for the likely additions: a palette, a workset output, a
     measurement tool, a section in the Thermal Inspector's panel, an API route, a page.
  2. **Refactors where an addition today means edits in many places**, found while writing those recipes: lists
     kept in several files made one (e.g. outputs, palettes, units), the largest scripts split by feature, shared
     helpers kept once. Behaviour unchanged: the tests pass unchanged before and after each step, each step
     live-checked.
  Open: how far it goes (proposed: the guide and the refactors its recipes call for, not a rewrite); that
  "extensible" means changing the plugin's code (a fork or a pull request), not a plugin system of its own that
  others' code plugs into at runtime (proposed: the former).
  Decided (the user, 2026-11-07): changing the plugin's code (a fork or a pull request), no runtime extension API;
  the guide and the refactors its recipes call for, no file split for its own sake.
  Built, `r2-developer-guide`: `docs/developing.md` (the code's map, a request's way to the worker and back, where
  data is kept, running the dev stacks, the tests, and the six recipes), linked from the README's Developing section
  (which it replaces), `docs/index.md` and `CLAUDE.md`. Refactors its recipes called for: `mosaics.palette_list`
  and `palette_keys` (the viewers' palettes built once, from DJI's tables and `conversions.COLORMAPS`, in place of
  three copies in `mosaics`, `frames_api` and `inspector_api`); `regions.js` `TOOLS` (each measuring tool's icon and
  name, read by `inspector.js` and `frame.js`). Left as two lists, cross-referenced, as the recipe says:
  `COLOURED` in `conversions.py` and `conversions.js` (serving it would change the tests' datasets for two names).
  Not refactored, named in the recipes instead: the mosaic tabs' labels (`viewer.js`, `inspector.js`). Tests
  unchanged; Jest 300 (with the frame page's fix, below R1), Django 212 on 4.0.0 and 3.3.2 (1 skipped). Live on
  :8002 (read only): the same palettes on the mosaic viewer, the frame page and the Inspector's mosaics, the same
  tool buttons on the frame page and the Inspector.

- **R1. A review before the public release** (built 2026-11-07: R1-1 to R1-13; the user, 2026-11-07, from `new.md`): "Review the plugin code for
  possible breaking points, performance improvements, and reduction of possible negative webodm ux impacts. This
  plugin will soon be released to the world so it's important to refine any points where the experience could
  breakdown before they do." Builds on the walk-through for bugs and hangs and the UX review (2026-11-02, Done),
  which followed the workflows in the browser; this reads the code. Proposed: a review in three passes, its findings
  listed here, each with where it is, what a user would meet and a proposed fix:
  1. **Breaking points**: what fails on a server unlike the dev stack (native Windows, no DJI SDK, a large dataset,
     a stopped worker or node, a full disk), a missing or old saved file (older worksets, data store values from
     earlier versions), permissions (shared and public projects, anonymous viewers), errors swallowed or shown raw.
  2. **Performance**: heavy work in WebODM's web process instead of its worker, folders scanned or files read again
     on every request, caches that grow without bound, the browser's work on large datasets.
  3. **WebODM's own pages**: what the plugin adds to every page (`main.js`, `units.js`, CSS that could reach
     WebODM's own elements, requests, console errors), and to the dashboard, the map and the task panel; what
     happens there when the plugin's server side fails.
  Fixes then on branches grouped by area, each with its test and a live check. Open: which findings are fixed
  before the release (proposed: every breaking point and everything on WebODM's own pages; performance where the
  fix is small).
  **Findings** (the code read 2026-11-07; each still to confirm on the dev stack before it is fixed):
  - **R1-1. A public map's 403** (WebODM's own pages): the Thermal Inspector is set up on every 2D map, public ones
    too, and asks `GET display` (`inspector.js` `create`), which answers only logged-in users (`Display` is a
    `DatasetView`, `IsAuthenticated`): an anonymous viewer of any public map, thermal or not, gets a 403 in the
    console, the same error `units.js` had. Fix: on a public map (`projectOf` already knows), not asked; the
    legend shown and the task's palette kept, as when the request fails.
  - **R1-2. Two requests on every map, thermal or not** (WebODM's own pages): `GET display` and
    `GET projects/<id>/inspector/mosaics`, which reads every dataset of every project the user can view and keeps
    the map's project's in Python (`InspectorMosaics`, `datasets.visible`): slow on a server with many projects.
    Fix: the datasets filtered by the project in the query; the Inspector's requests made only when the map has a
    thermal layer or its project has datasets (one cheap query), else none.
  - **R1-3. Five map scripts on every WebODM page** (performance, WebODM's own pages): `include_js_files` loads
    `scale.js`, `recolour.js`, `regions.js`, `frames.js` and `inspector.js` (about 3,700 lines) on the dashboard,
    Administration and every other page, though only the 2D map uses them. Fix, if WebODM's loader allows it: they
    become dependencies of the map's `willAddControls` (as `inspector.css` is), loaded on map pages only; to check
    that SystemJS runs them as plain scripts.
  - **R1-4. DJI Thermal Task can hold all of a small server's web workers** (WebODM's own pages): each photo is
    converted inside the request (`api.TaskConvert`), three at a time (`upload.js` `CONCURRENCY`); WebODM starts
    2 × CPUs + 1 web workers, so on a one-CPU server one upload keeps all three busy and every other page waits for
    the upload to finish. Fix: two at a time (still overlapping upload and conversion); to measure how long a photo
    takes to convert.
  - **R1-5. A thumbnail asked for twice at once can fail** (breaking point): `palette_thumbnail` writes the cached
    picture to `<name>.part`, the same name for every request, then renames it; two requests for the same
    thumbnail (two tabs, two users) write one file together, and the second's rename or `os.remove` raises a 500
    (on Windows, the file held open too). Fix: a `.part` name of its own per request, as `write_json` has.
  - **R1-6. Deleting a task depends on the plugin** (breaking point): `task_removing`, WebODM's signal before any
    task is deleted, cancels a dataset's jobs and unlinks its tasks; an error there (a file it can't write) would
    stop WebODM deleting the task. Celery's `revoke` with the broker down may also wait for it (to check). Fix: the
    handler's errors logged, never raised.
  - **R1-7. The analysis read again for each thumbnail** (performance): every thumbnail and file request reads the
    dataset's `analysis.json` (about 400 bytes a frame: 2 MB for 5,000 frames) to check the file is the dataset's,
    and the detail pane's large ones read it twice; the Files tab asks for one thumbnail per row. Fix: the parsed
    file kept in memory by its path, size and time (a few entries).
  - **R1-8. The dataset pages ask for everything every 2 or 3 seconds while a job runs** (performance): the
    dataset page's poll (`dataset.js` `load`, `POLL_MS` 2 s) gets the whole dataset (`detail`): the full analysis
    (2 MB at 5,000 frames, sent each time), every image's size (a walk of the images folder), each workset's
    results and the size of its files (another walk), and who it's shared with; the Analyzer's list (3 s) walks
    every dataset's images. Polls go on in a tab in the background. Fix: while polling, the analysis sent only
    when it changed (the page sends the `analyzed_at` it has), the counts and sizes kept when the images change
    instead of walked each time, and polling slowed while the tab is hidden.
  Read: the pages poll with a slower retry after a failed request; a 500's HTML answer shows each call's own message
  (`core.readJson`, `errorText`); a failed worker job records its error and keeps nothing of a failed mosaic.
  Native Windows (read): nothing of R1-1 to R1-8 differs by system (`st_ino` is NTFS's file index; renames go through
  `portable.replace`), and ENOSPC is Windows' disk full too (Python maps `ERROR_DISK_FULL` to it).
  The rest of the reading's findings (2026-11-07):
  - **R1-9. The Analyzer's list takes an error for the list** (breaking point): `datasets.js` `load` reads the
    answer without checking its status: a session that ended (DRF's 403 `{"detail": ...}`) or a 500 with a JSON body
    sets `datasets` to undefined, the page says "Could not show the datasets (...). Reload the page, bypassing the
    browser's cache", and every later poll or click throws. Fix: `core.readJson`, the server's message shown, the
    poll retried less often, as the dataset page does.
  - **R1-10. The Analyzer's upload drops the server's reason** (UX): `core.uploadFiles` turns any refused batch into
    "upload failed: 400" and sends it twice more, so "over their storage quota", "Wait for the analysis to finish"
    or a full disk show only as "N images could not be sent: ...". Fix: a refusal with a reason (4xx) is not sent
    again, and the page shows its reason beside the images not sent.
  - **R1-11. A full disk leaves broken images in a dataset** (breaking point): `datasets.save_image` writes each
    image in place (the Analyzer's upload, and DJI Thermal Task's photos kept in the dataset), so a full disk keeps
    a truncated JPEG the analysis then reports as damaged; the request answers a bare 500; `write_json` leaves its
    `.part` file. Fix: images written to a `.part` name then renamed, removed if the write fails; a full disk
    answered "The server's disk is full" (DJI Thermal Task, the Analyzer's upload); `write_json` removes its part.
  - **R1-12. A large mosaic is read whole, in float64** (memory): the viewer's histogram (`mosaics.temperatures`,
    the first time a tab is equalized, in a web worker) and the build's ranges (`raster_info`, in the worker after
    dji-thermal-cli's build) read the whole mosaic and copy it 3 or 4 times: about 25 bytes a pixel, 750 MB for a
    30-million-pixel mosaic (about 1,000 M4T frames). The dev data's mosaics are 2 to 3.5 million pixels. Fix: read
    in blocks: min and max exact, the histogram counted block by block over the span, its percentiles from a
    reduced read (a few million pixels, from the overviews). dji-thermal-cli's own memory while building is its
    concern, not the plugin's.
  - **R1-13. The mosaic viewer says nothing when the connection drops** (UX, small): its readout and frames under
    the pointer (`viewer.js` `readout`, `select`) have no handler for a request that never reached the server, and
    a histogram that never arrived stops equalization for that tab until the page reloads. Fix: `core.unreachable`,
    as the other calls have; the histogram asked again. (The frame viewer's `measure`, first listed, has one.)
  Decided (the user, 2026-11-07): all eight fixed; DJI Thermal Task converts two photos at a time; R1-9 to R1-13
  all fixed.
  Built, `r1-fixes`: R1-1 and R1-2 `inspector.js` `create` (`loadDisplay`: never on a public map; on a map without a
  thermal layer only once the project's mosaics turn out not empty), `datasets.visible(user, project)` used by
  `InspectorMosaics`; R1-3 `main.js` `DjiThermalMapScripts` (the five scripts added in order on the map's
  `willAddControls`, at main.js's `?v=`), `plugin.py` `include_js_files` down to `units.js` and `main.js`; R1-4
  `upload.js` `CONCURRENCY` 2; R1-5 `analyzer_api.palette_thumbnail` (a `.part` name per request, a thumbnail not
  kept still sent); R1-6 `datasets.task_removing` (errors logged); R1-7 `datasets.analysis` (kept by the file's
  inode, size and time, 8 at most; `conversions.remove_images` changes a copy); R1-8 `analyzer_api.detail`
  (`analysis_stamp`, `?analysis=` gives `analysis_unchanged`), `dataset.js` `load` and `render`, `core.pollDelay`
  (5 × slower in a hidden tab, `dataset.js`, `datasets.js`). Not done of R1-8: the images' count and size are still
  walked on each poll (a few thousand `stat`s, small beside the analysis no longer sent). Tests: Jest
  (`inspector.test.js` the preferences only where there are temperatures; `main.test.js` the scripts in order;
  `analyzer.test.js` the poll spared the analysis, `pollDelay`), Django (`test_analyzer`: a thumbnail not kept,
  a dataset deleted though its jobs can't be canceled, the analysis read once and the poll's stamp). 208 Django
  tests on 4.0.0 and 3.3.2 (1 skipped), Jest 291. Live on :8002 (read only, but a task made public for the public
  map's check and made private again): the dashboard loads `units.js` and `main.js` only; a thermal map loads the
  five scripts in order and the Inspector opens; an anonymous public map asks no `display`, no 4xx; the dataset
  poll 110 KB → 11 KB ("Thermal - 9/18/2026", 211 frames); the thermal folders' files as before.
  Built, `r1-fixes-2`: R1-9 `datasets.js` `load` (`core.readJson`, `failed`: the server's reason, retried); R1-10
  `core.uploadFiles` (a refusal with a reason not sent again, the batches left not sent, `reason` in its result,
  `failedText(files, reason)`); R1-11 `datasets.write_file` (a `.part` name, removed on failure; `write_json` and
  `save_image` use it, `image_files` skips parts), `datasets.copy_upload`, `analyzer_api.disk_full_refused` and
  `DiskFull` (507) in `DatasetUpload` and `api.TaskConvert`; R1-12 `mosaics.band_rows`, `band_sample`
  (`ROWS_PIXELS`, `SAMPLE_SIZE` 2048), `band_stats(src, band, unit)`, `temperatures` sampled; R1-13 `viewer.js`
  `readout`, `select` (`core.unreachable`), the histogram asked again. Tests: Jest (`analyzer.test.js`: the list
  refused, an upload refused with a reason, the readout unreachable), Django (`test_analyzer`: a full disk in an
  upload, a record not written, a large mosaic read in parts; `test_api`: a full disk in DJI Thermal Task). 212
  Django tests on 4.0.0 and 3.3.2 (1 skipped), Jest 294. Live on :8002 (read only): the list as before, and a 403
  answer shows its reason; the block reads give exactly the ranges and histograms the dev mosaics' builds stored,
  and read at 400 pixels a side the same min and max, percentiles within 0.05 °C.
  Fixed after (found 2026-11-07 while building R2, `fix-frame-page-scripts`): R1-2 loads the Inspector's scripts on
  map pages only, and the frame page had relied on `frames.js` coming from every page (`viewer.js` and
  `inspector.js` read it when they load), so it no longer opened. `templates/frame.html` loads it; Jest's
  `pages.test.js` checks that each template, and `main.js`'s map scripts, load what their scripts read from
  `window`, before them. Never in a release (v1.1.0 is older).
- **Thanks in the README** (the user, 2026-11-07, `new.md`: "Create a thank you section in the README and list all
  known projects and developers that made this plugin possible."). A "Thanks" section near the end of `README.md`
  (and `docs/index.md` linking to it). What the plugin is built on, found in its code: **WebODM** and
  **OpenDroneMap** (ODM, NodeODM; the plugin system, the map, Leaflet and React as WebODM ships them, rio-tiler as
  WebODM vendors or installs it), **DJI** (the Thermal SDK and its documented R-JPEG format; the palettes; the
  sample images the tests use, not shipped), **dji-thermal-cli** (the temperatures, the mosaics), **NumPy**,
  **Pillow**, **GDAL** (OGR, through WebODM), **rasterio**, **Django** and **Django REST framework**,
  **django-guardian**, **Celery**, **zipstream-ng**; for development, Jest, Babel, ESLint, Playwright and Ruff.
  Each with a link to its own site and its license name, credited as the project's authors name themselves
  ("the NumPy developers"), naming a person only where the project does (WebODM: Piero Toffanin and contributors).
  **Decided** (the user, 2026-11-07): what runs and the development tools; people named only where the project
  names them (WebODM's package: Piero Toffanin; Pillow's: Jeffrey A. Clark); one line that the plugin was developed
  with the help of Claude (Anthropic). WebODM 4.0's engines are ODX and NodeODX (formerly ODM and NodeODM).
  Built (`readme-thanks`): README's Thanks, before License, each license read from the project's own files or
  package metadata (WebODM's checkout and image, the dev venv, `node_modules`); `docs/index.md` links to it. Done.
- **The temperature unit (°C or °F) in WebODM's header, an administrator's default** (the user, 2026-11-07: "a
  global option for the user to control it via dropdown in the header row next to the user icon. The visible
  temperature conversions should support C, F and K. This setting is global for the user of the DJI Thermal Analyzer
  plugin. If possible, add a dropdown setting to the plugin Admin configuration page that allows Administrators to
  configure the default for a system. Otherwise default to C"; then: "Drop Kelvin, we may decide to add it back
  later if webodm adds more traditional Kelvin support"). Builds on "The unit and palette shared" (2026-10-30,
  below): the unit stays WebODM's metric/imperial in each browser, and is now also saved per user.
  **Design**:
  - **Saved per WebODM user** in the display preferences (`conversions.display`'s `unit`: C or F, the user data
    store), so it follows them to any browser; `migrateUnit` (which handed a saved unit to WebODM once and dropped
    it) goes. A user who never chose gets the **administrator's default**, else °C.
  - **The administrator's default**: a "Default temperature unit" dropdown (°C, °F) on the DJI Thermal page under
    Administration (`sdk.html`, superusers), kept in the plugin's global data store; °C until one is set.
  - **The header dropdown**: `main.js` (on every WebODM page) adds a °C / °F menu to WebODM's top bar, just left of
    the user icon, wherever the header has that icon (logged in). Picking one saves it (`PUT display`) and redraws
    every open view (the Thermal Inspector, the Analyzer's pages) through WebODM's `onUnitSystemChanged`.
  - **Kept in sync with the Preferences dialog's unit** (both change the same saved setting).
  - **Linked to WebODM's units** (metric/imperial, per browser): °F is imperial, °C metric, both ways (picking one
    sets WebODM's units, so its distances and areas follow; WebODM's switch saves the unit). On load the saved unit
    sets this browser's WebODM units to match. A user who never chose follows this browser's WebODM units when they
    were set, else the administrator's default (WebODM's units set to match).
  - **Anonymous viewers** (a public or shared map): the administrator's default, no dropdown, WebODM's units not
    touched.
  - The server keeps measuring in °C; a workset's own unit (its files, K among them) is unchanged; new worksets and
    the Thermal Task panel start in the user's unit.
  - The unit reaches the pages: the Analyzer's in `#ta-display` (the unit resolved, with the default); WebODM's
    pages (maps, the Thermal Task panel) from `GET display` once, by `main.js`.
  Tests: Django (`test_api`: the default, the saved unit, a superuser's default, others refused), Jest (the
  resolution order and the linking, the header menu). README, the Inspector and Analyzer quickstarts,
  `measurement.md`, the admin page's docs; screenshots retaken where the header shows.
  **Decided** (the user, 2026-11-07): linked to WebODM's units; the menu on every WebODM page; the Preferences
  dialog's unit kept, in sync; anonymous viewers get the administrator's default; **no Kelvin** on screen (maybe
  later, if WebODM supports Kelvin: see Later).
  Built (`header-unit`): `conversions.DISPLAY_UNITS`, `default_unit`/`set_default_unit` (the global data store),
  `display`'s `unit` saved again and `default_unit`; the public `GET unit` (`analyzer_api.Unit`: `logged_in`, the
  user's unit, the default; one request, so anonymous pages log no 403); the admin page's Temperature unit panel
  (`page.py` `_unit`, `sdk.html`); `public/units.js` (every page, before `main.js`: `resolve`, the menu, the link to
  WebODM's units, anonymous viewers; imperial US counts as °F); `inspector.js` and `analyzer_core.js` `userUnit`
  read it; the Preferences dialog saves the unit with the account, then sets WebODM's; `migrateUnit` removed; the
  Analyzer's pages reload when the unit changes. Tests: `test_analyzer` (the saved unit, the default and `unit`),
  `test_sdk` (the admin page), Jest (`units.test.js`, the dialog, the Inspector). README, `palettes.md`,
  `quickstart-inspector.md`, `dji-sdk.md`, `api.md`; the whole-page screenshots retaken (the menu in the header).
  Live check on :8002 (a fresh browser): the menu left of the user icon, °F saved before WebODM's units turned
  imperial, the Inspector's readout in °F then °C, the Preferences dialog in step, the Analyzer reloading on a
  change, the admin default saved, an anonymous page in the default with no menu and WebODM's units untouched, no
  console errors; the admin user's preferences and the default put back as they were. Done.
- **A workset's frames drawn in its palette** (the user, 2026-11-07: "why is it when a thermal task is created to
  convert the color palette to ironred (for example) that the source frames still show up in their original palette
  after conversion?"). Why: the workset's palette goes only into the files it writes (its pseudo and rjpeg outputs:
  the task's images, the downloads); every picture of a frame in the Analyzer is the dataset's source R-JPEG, drawn
  in the user's preferred DJI palette, else as shot (its embedded picture) - the workset's Files table and detail
  pane (`conversions.js` `thumbsUrl`, `resultDetailHtml`), the frame page's list (`frame.js` `thumbsUrl`). Only the
  frame page's view falls back to the workset's (`frames_api.default_palette`: preferred, workset's, inferno).
  **Design** (agreed with the user, 2026-11-07): inside a workset, its frames are drawn in the workset's palette when
  it set one (a DJI palette, and a coloured output: pseudo or rjpeg), else the user's preferred DJI palette, else as
  shot: one helper in `analyzer_core.js` used by the workset's Files table, its detail pane and the frame page's list
  (the frames API returning the workset's palette). The dataset's Files tab keeps the preferred palette (no one
  workset); the frames window in the mosaic viewer and the Inspector keeps drawing the frame as its layer is.
  Tests: Jest (the helper, the Files table's and the frame list's URLs), `test_frames` (the palette returned).
  README, `quickstart-worksets.md`; screenshots retaken if a frame shown changes colour.
  **Decided** (the user, 2026-11-07): the frame page's own view (the big frame) starts in the same order, the
  workset's palette first (`frames_api.default_palette`: the workset's DJI palette with a coloured output, then the
  preferred, then inferno); a palette picked in its panel still applies and is saved as the preference, and the next
  visit to that workset's frames opens in the workset's again.
  Changed while building (2026-11-07): no "coloured output" condition. DJI Thermal Task's workset writes only °C
  TIFFs yet keeps the palette chosen for the task's map (the user's own example: "DJI Thermal Task", `temp_c:tiff`,
  ironred), so a workset's palette counts whenever it chose one. Built (`workset-palette-thumbnails`):
  `conversions.frames_palette`, `frames_api.default_palette` (the workset's, the preferred, inferno) and the frames
  API's `frames_palette`; `analyzer_core.js` `framesPalette`, used by `conversions.js` (the Files table, detail pane
  and picture viewer) and `frame.js` (the list). Tests: `test_frames`, Jest (`analyzer.test.js`, `frame.test.js`).
  README, `palettes.md`, `quickstart-worksets.md`. Live check on :8002 ("ThermalTest", its workset in arctic, the
  preference ironred): the Files table, detail pane, frame list and frame all arctic; what it made (the dataset's
  thumbnails, the workset's figures) removed. Done.
- **Thumbnails in the frame page's list** (the user, 2026-11-06: "The frames browser list should show thumbnails
  instead of just filenames. Large thumbnails."). **Decided** (the user, 2026-11-06): in the preferred DJI palette
  (else the frame's own picture), as the Files tab's; about 260 px wide, the list 280 px, with a Thumbnails box to list
  names only, remembered per browser, on by default. Built (`frame-list-thumbnails`): `analyzer_api.LIST_SIZE`
  (`?size=list`, up to 320 px, cached beside the others), `frame.js` `thumbsUrl` and `listHtml`'s thumbnails (lazy),
  the list redrawn when the palette changes, `analyzer.css`; Jest (`frame.test.js`), `test_analyzer` (the list size);
  README, `quickstart-worksets.md`, `api.md`, `frame-page.png` and `frame-measure-again.png`. Live check on :8002
  ("Thermal - 9/18/2026", 211 frames): the first thumbnails in under a second, 14 made as the list showed them,
  the box off and kept after a reload, the phone layout; the thumbnails it cached removed. Done.
- **Bug: the Thermal Inspector's button on RGB maps** (the user, 2026-11-06: "Why is the Thermal Inspector visible
  on a rgb only orthophoto? I thought the button was only supposed to be visible on thermal/radiometric orthos?").
  Since Mosaic Overlays (2026-11-01, Claude's design, never checked with the user) the button also showed on every map
  of a project with workset mosaics. **Decided** (the user, 2026-11-06): only on thermal orthophotos. Built
  (`inspector-thermal-only`): `showButton` in `inspector.js` shows it for a thermal orthophoto, or a mosaic laid on
  the map (the Analyzer's "Open on WebODM's map" opens the project's map, which may be RGB only), and while the panel
  is open; Jest (the button's test rewritten); README and the Inspector quickstart. Live check on :8002 (read
  only): the RGB task's map of a project with mosaics has no button; a thermal task's and the project's map have
  it; "Open on WebODM's map" on the RGB map lays the mosaic with the panel open, the button kept. Done.
- **WebODM 4.0.0** (the user, 2026-11-05: "WebODM 4.0.0 was just released and we need to ensure our plugin's
  compatible"). 4.0.0 (tag `v4.0.0`, 42 commits after 3.3.2) moves to Ubuntu 24.04, **Python 3.14, Django 5.2,
  numpy 2.5.4, Pillow 13.0.0**, Celery 5, Postgres 18 without PostGIS (`django.contrib.gis` out of
  `INSTALLED_APPS`; a task's `crop` and extents are GeoJSON dicts in `JSONField`s, no longer GEOS geometries),
  Valkey in place of Redis, `webpack_loader` removed, plugin URLs through `re_path`, and `pip freeze --path` for
  plugin requirements (the user's #2046).
  What breaks or may break here:
  - `requirements.txt` pins numpy 1.26.2 and Pillow 11.3.0 (3.3.2's): no Python 3.14 wheels, so the install fails.
    Environment markers pick each WebODM's versions (pip honours them; WebODM's `parse_requirements` keeps only the
    name).
  - `inspector.py` `_crop` (`task.crop.empty`) and `inspector_api.py` (`task.crop.wkt`) expect GEOS; the frames' and
    the Inspector's shapes use `django.contrib.gis.geos` (needs GEOS's library, no longer WebODM's to provide).
  - Everything else read against 4.0.0 while testing: Celery's `worker.celery`, `run_function_async`,
    `TestSafeAsyncResult`, the templates the pages extend, the Administration sidebar link `main.js` inserts, JWT.
  - The dev stack: `docker-compose.nodeodm.yml` is now `docker-compose.nodeodx.yml`; new images (webapp 4.0.0, db
    18, valkey 9.1) pinned by digest.
  Decided (the user, 2026-11-05): this repo's `ignored/WebODM` goes to 4.0.0 (not webodm-geojson's checkout); the
  plugin supports **both 3.3.2 and 4.0.0** (markers, both kinds of crop, tests on both); the :8002 dev data
  (Postgres 9 upgraded in place to 18 on the first start, one way) is **backed up first** to volumes
  `webodm-dji-thermal-332_dbdata` and `webodm-dji-thermal-332_appmedia`.
  Found by the tests on 4.0.0 (173 run: 3 failures, 4 errors): rio-tiler is no longer installed (WebODM vendors a
  trimmed 2.x as `app.vendor.rio_tiler`, without `COGReader.point`), `morecantile` neither (the tests' tiles), the
  colour maps hot, rainbow and gray_r are gone from its tiler, `geom_transform_wkt_bbox` takes a GeoJSON polygon
  (GEOS in 3.3.2), and a colouring fixture's floats differ in the last digits (numpy 2).
  Decided (the user, 2026-11-05): **Shapely** in place of Django's GEOS (2.0.7 for Python 3.9, 2.1.2 for 3.14:
  wheels on all three systems); the plugin **carries its own copies** of hot, rainbow and gray_r (rio-tiler's, BSD),
  so the palettes and the users' saved choices are the same on both versions; the user upgrades the native Windows
  WebODM (`C:\WebODM`) to 4.0.0 for the Windows check.
  Built (2026-11-05), `webodm-4`: `requirements.txt` with markers (numpy, Pillow, Shapely per Python);
  `webodm_versions.py` (rio-tiler from `app.vendor` else installed, `task_crop` as Shapely from GeoJSON or GEOS,
  `cutline` built by the plugin, `colormap_encoded`/`colormap` with `colormaps.json`); Shapely in `inspector.py`,
  `frames.py` (imported from the plugin's packages, `converter.shapely`); the viewer's readout read with rasterio
  (`mosaics` point); `converter.remove_stale_metadata` honours markers; `converter.built_for_another_python` and
  `Plugin.check_requirements` make WebODM install the packages again after it moves to another Python (found
  while checking: its md5 check would keep the 3.9 builds). Tests: `test_converter` (markers, another Python,
  the reinstall), `test_inspector` (the crop as each version stores it, tiles without morecantile, the ETag with a
  real crop), `test_analyzer` (fixtures within float rounding). `dev/webodm.sh`: 4.0.0 on :8002, `DT_WEBODM=3.3.2`
  on :8003 (`ignored/WebODM-3.3.2`, a worktree). All 208 tests (the plugin's and WebODM's `app.tests.test_plugins`) pass on both, Jest (281) and ESLint too. Live on
  4.0.0 (read only, the user's First Project after the database upgrade): the dashboard's button, the Analyzer's
  list, dataset, Files pictures (Pillow 13), the mosaic viewer (hot, the readout, a click's frames), the frame
  page (a region), the Thermal Inspector on WebODM's map (pin, region, hover, hot), the DJI Thermal page and its
  Administration link; the upgrade path (3.3.2's installed packages put in place, reloaded: installed again for
  3.14, the old metadata removed). README, `docs/installing.md`, `docs/troubleshooting.md`, CLAUDE.md, the test
  and release-check skills. Left: **native Windows 4.0.0** (once the user has upgraded `C:\WebODM`: the zip
  installed through Administration > Plugins, its requirements for Python 3.14, the pages; `test_portable` with
  its Python), then the merge. At the next release, the release check installs the zip on both versions.
  Native Windows 4.0.0 (2026-11-05, the zip installed through Administration > Plugins on the user's `C:\WebODM`, in
  a "Live check Windows 4.0.0" project, deleted afterwards): requirements installed for Python 3.14 (cp314 wheels,
  "Installed requirements.txt": 3.3.2's failing check is fixed); an Analyzer dataset of 40 M4T frames and 3 RGB photos
  analyzed (5 s), a harmonized workset with mosaics (92 s), the viewer (rainbow, the readout, a click's 19 frames), the
  frame page (a region), a task from the workset processed on the native node (664 s), the Inspector on its map (pin,
  region, hot); a DJI Thermal Task of the same photos (the RGB ignored) processed (211 s, 10.1 to 31.7 °C);
  `test_portable` passes with its Python 3.14 (an embeddable build: the test skill's runner). **Removing the plugin
  failed**: "Access is denied" on Shapely's DLL, which WebODM had loaded (Windows can't delete a loaded DLL); WebODM
  dropped the plugin's row but left its folder half deleted, to come back at the next start.
  Decided (the user, 2026-11-05): **GDAL's OGR in place of Shapely** (WebODM's own GDAL, with GEOS, on 3.3.2 and
  4.0.0, Docker and native Windows, checked on all three): the plugin then ships no compiled package of its own.
  Built (2026-11-05): `shapes.py` (OGR geometries with what the plugin reads of them; buffers with GEOS's default
  8 segments a quadrant; OGR's exceptions left as WebODM has them), used by `inspector.py`, `frames.py` and
  `webodm_versions.task_crop`; Shapely out of `requirements.txt`, the docs and the dev venv. All 208 tests pass on
  both versions, Jest and ESLint too. Left: the Windows re-check (the new zip installed, a region measured, the
  plugin removed), once the user has restarted the Windows WebODM to free the half-deleted folder's DLL; then the
  merge.
  Re-check, part 1 (2026-11-05, after the user's restart): the restart had registered the half-deleted plugin again,
  as expected; removed through Administration > Plugins (no DLL loaded: removed whole). The new zip installed
  (dji-thermal-cli, numpy, Pillow; no Shapely), but WebODM kept running the old plugin's modules it had loaded at
  start (a region: "No module named 'shapely'" from the old `converter.shapely`): WebODM runs a reinstalled plugin's
  new code only after a restart (`docs/installing.md` now says so). Its project deleted, the new version left
  installed. Left: the user restarts the Windows WebODM once more; then a region measured with OGR and the plugin
  removed without a restart; then the merge.
  Re-check, part 2 (2026-11-05, after the user's second restart), on native Windows 4.0.0 with the OGR version:
  a dataset of 40 frames and a workset with mosaics, a mosaic region (84,570 pixels, mean 22.65 °C) and line (5.54 m,
  264 samples, each with its frame), a one-point line refused ("A line needs two points"), a frame page region (mean
  20.11 °C, as with Shapely); its project deleted, then **the plugin removed without a restart, folder and all**.
  Done, merged as `webodm-4`: the code in `webodm_versions.py`, `shapes.py`, `colormaps.json`, `converter.py`
  (markers, `built_for_another_python`), `plugin.py`, `inspector.py`, `frames.py`, `mosaics.py`; tests in
  `test_converter`, `test_inspector`, `test_analyzer`; `dev/webodm.sh` and `dev/compose.yml` (both versions),
  `dev/package.sh` (`DT_ZIP`).
- **U2-4. Harmonize's alignment reused by the mosaics** (the user, 2026-11-02: in 1.0.0, the last known item before
  it). A harmonized workset aligns its frames twice: the conversion's `dtc.process(normalize=True)` runs
  dji-thermal-cli's `normalization()`, which builds a mosaic layout and aligns it (`mosaic._align`: 4 rounds of every
  overlapping pair's block offsets, solving the boresight, each frame's shift and rotation and the surface heights),
  keeps only each frame's offset and drops the alignment; then Build mosaics' `make_mosaic` (`mosaics.py`) aligns
  the same frames again (about 2.5 and 3 minutes of a 6-minute plan workset). The blocks are matched on the
  temperature's gradient by phase correlation, so a frame's constant offset (and the medians' small change) should
  leave the alignment as it was: checked on the M4T flight before release.
  - **dji-thermal-cli 1.12.0** (made and released there first; PyPI is at 1.11.0, the plugin pins 1.10.0): an
    `Alignment` (the boresight, each frame's shift and rotation by name, the surface, the reports, and what it was
    made with: frames, max pitch, gsd, heights, height cell, dsm), saved to and read from JSON; `Normalization`
    carries it (so `ProcessReport.normalization` does); `MosaicOptions(alignment=...)` places the frames with it and
    skips the "align" stage (its progress too), when it matches the run, else aligns afresh, the mosaic's report
    saying which. The command line: a harmonized conversion saves its alignment to a file, the mosaic command takes
    one. Tests there; on the M4T flight, a mosaic from the saved alignment against one aligned afresh, and the time.
  - **The plugin**: dji-thermal-cli pinned at 1.12.0; a harmonized workset saves its alignment beside its files;
    Build mosaics (after converting, from the workset's menu, Build again) passes it; DJI Thermal Task's Harmonize
    goes through a workset, so gets it too. Older worksets, and Normalize alone (no alignment), build as now.
  Decided (the user, 2026-11-02): the saved alignment is used only for exactly the frames Harmonize aligned (frames
  removed since, from the workset or the dataset: the mosaics align afresh); the command line gets it as well as
  the API. Then the 1.0.0 release is redone (`release/1.0.0`, its changelog, manifest and README commit kept) and
  the zip rebuilt with its new sha256.
  Done (2026-11-02): dji-thermal-cli 1.12.0 (its `saved-alignment` branch: `mosaic.Alignment`, `_layout(saved=)`,
  `_align` returning the boresight; `MosaicOptions.alignment`, `Normalization.alignment`, `MosaicReport.alignment`;
  `--save-alignment`, `--alignment`; tests in `test_mosaic.py`, the flight test in `test_webodm.py`; 42 M4T frames:
  the mosaics 10 s instead of 28 s), published on PyPI (the tag's first run lost its macOS runner, re-run). The
  plugin, `u2-4-shared-alignment`: `conversions.ALIGNMENT_FILE` saved by `convert`, `api_arguments`'
  `mosaic_options` (Harmonize at the workset's pitch limit), `mosaics.build` passing it unless frames were removed,
  `analyzer_core.js` `mosaicReportRows`' Alignment row. Tests: Jest (`analyzer.test.js`), `test_analyzer`
  (`test_a_harmonized_worksets_mosaics_are_placed_with_harmonizings_alignment`, `api_arguments`). Live on
  "Thermal - 9/18/2026" (200 frames, a "Live check" workset made and deleted): converted in 110 s, the mosaics in
  39 s (about 3 minutes before), both "Harmonize's, not aligned again". README, `quickstart-worksets.md`.
- **Two requests lost from `new.md`** (the user, 2026-11-02; found in VSCode's history of `new.md`): each was saved
  there a minute or more after Claude read the file, and Claude's clearing of it wrote over them unread. From now on
  `new.md` is read again just before it is cleared, and only the lines turned into phases are removed.
  - **The scale's span from two arrow buttons** (saved 12:10): "Add a left arrow button and right arrow button
    between min/max temperature of the scale. When the user clicks the right arrow button min and max temperature
    values should get further apart; increasing the span of the range. Inversely when the user clicks the left arrow
    button, min and max should get nearer each other; reducing the span of the range. The increments by which the
    change occurs will be based upon 10% the numeric distance between the 2 values." Builds on the Thermal
    Inspector's colour scale (WebODM's map › the thermometer button › the panel, its range fields "min to max °C" and
    Auto, `inspector.js` `scaleHtml`, `typedRange`). Proposed: ◀ and ▶ in place of "to" between the two fields
    ("Narrow the range", "Widen the range"); each click moves both ends about the range's middle, the range drawn at
    once as a typed one is (Auto then puts it back). Open: how far a click moves the ends; whether the mosaic viewer's
    and the frame page's panels (the same "min to max" fields, `viewer.js` `controlsHtml`) get them too.
  - **"Legend on the map" in the Preferences** (saved 11:30): "Move \"Show legend on the map\" out of the thermal
    inspector and into the DJI Thermal Analyzer settings under Thermal Inspector settings." Builds on the Inspector
    panel's "Legend on the map" tickbox (kept per browser, `dji-thermal-inspector:legend`) and the Preferences dialog
    (DJI Thermal Analyzer › the gear: Temperature unit, Palette; saved per user, `conversions.display`). Proposed: the
    tickbox leaves the Inspector's panel; the Preferences dialog gets a "Thermal Inspector" section with "Show the
    legend on the map" (shown by default), saved with the user's other preferences on the server, so it follows them
    to any browser; the browser's old setting is removed. Open: that it's the Preferences dialog (per user) meant,
    not Administration › DJI Thermal (for every user).
  Decided (the user, 2026-11-02): the Preferences dialog; each click moves the span by a tenth (each end a twentieth);
  the arrows in all three panels (the Thermal Inspector, the mosaic viewer, the frame page).
  Done, `lost-requests`: `scale.js` `spanRange` and `spanButtonsHtml`, used by `inspector.js` (`scaleHtml`, the
  `range-narrow`/`range-wider` clicks) and `viewer.js` (`controlsHtml`, `bindControls`; the frame page shares them).
  The legend: `conversions.display` has `legend` (shown unless hidden), `parse_display` takes only the preferences
  sent and `save_display` keeps the others (a palette chosen on the map no longer drops the legend's); the dialog's
  selects can have a heading (`analyzer_core.js` `dialog`, `editPreferences`); `inspector.js` drops the tickbox, reads
  the legend from the display preferences (shown when they can't be read) and removes the browser's old key. Tests:
  Jest `inspector.test.js`, `analyzer.test.js`, `frame.test.js`; `test_analyzer`
  (`test_a_user_hides_the_inspectors_legend_and_saving_the_palette_keeps_it_hidden`). Checked live (read only) on
  "Thermal - 9/18/2026": the arrows on WebODM's map and in the viewer, the panel without the tickbox, the
  Preferences dialog (not saved). README, `quickstart-inspector.md`, `quickstart-worksets.md`,
  `quickstart-analyzer.md`, `api.md`; `inspector.png`, `inspector-image.png`, `mosaic-viewer.png` and
  `frame-page.png` retaken.
- **Manual Corrections off by default, and the frames window movable** (the user, 2026-11-02, from `new.md`):
  "Manual Corrections should be disabled by default." and "The Frame popout pane should be movable via drag and drop
  as well." Builds on the Thermal Inspector (WebODM's map › the thermometer button › the panel, `inspector.js`).
  - Manual Corrections, under the colour scale: unticked for a task nobody corrected, but the tick and its values are
    kept in the browser per task (`loadCorrection`, `dji-thermal-inspector:correction:<tasks>`), so a map opens
    corrected after an earlier visit. Proposed: every visit starts unticked, nothing kept (as the colour scale and
    Image already are); an old kept correction is removed.
  - The frames that saw a point (the frames window): on WebODM's map it moves only with the panel, beside it; in the
    Analyzer's mosaic viewer it sits fixed at the map's bottom left. The panel and the legend are dragged already
    (`movable`). Proposed: dragged by its heading (`.ta-pip-head`, "Frame 1 of 4 that saw this point") in both,
    kept inside the map; once dragged on its own it stays where it was dropped (the panel moved later leaves it),
    and closing it puts it back.
  Decided (the user, 2026-11-02): every visit starts unticked, nothing kept; both windows movable.
  Done, `inspector-requests`: the correction starts off on every page, and the corrections earlier versions kept are
  removed (`inspector.js` `forgetCorrections`); `movable` moved to `frames.js`, which both pages load, the Inspector's
  frames window dragged by its heading (`frameMove`, `framesMoved`: it then stays put as the panel moves, until
  closed) and the viewer's (`pipMove`, back in its corner once closed). Tests in `inspector.test.js` and
  `analyzer.test.js`; checked live on the "Thermal - 9/18/2026" dataset's viewer and WebODM's map. README,
  `quickstart-inspector.md`, `quickstart-worksets.md`; no screenshot changed.
- **The SDK settings note** (the user, 2026-11-02, from `new.md`): "on the plugin settings page, under \"Use DJI's own
  Thermal SDK\"; add a note in bold that it's usually only needed for development purposes reduces the performance
  of the DJI Thermal Analyzer." Builds on the DJI Thermal page under Administration (`templates/sdk.html`, the
  "Use DJI's own Thermal SDK" panel, shown before an SDK is installed; titled "Update DJI's Thermal SDK" after).
  Decided (the user, 2026-11-02): their wording as is, not measured first. Done, `sdk-settings-note`: in bold at the
  top of that panel (shown with an SDK installed too), "Usually only needed for development purposes: it reduces
  the performance of the DJI Thermal Analyzer." README, `docs/dji-sdk.md`, `dji-sdk.png` retaken.
- **Workflow walk-through for bugs and hangs** (the user, 2026-11-02, from `new.md`): "walk through the workflows for
  creating datasets, worksets and tasks. Look for bugs and places where it could hang unexpectedly for the user
  etc... Fix anything minor as you go but note anything larger to be a planned effort." Builds on the Thermal
  Analyzer (datasets, upload, analysis, worksets, mosaics, removing frames and files, tasks from a workset, Use for
  parent task) and DJI Thermal Task. Proposed: in a headless browser on the dev stack, as a user would, with a
  "Live check" dataset of the M4T flight: create, upload (also cancelled or interrupted), analyze (and cancel),
  worksets with several settings (and cancel, fail, build mosaics, remove frames), create a task, use for parent
  task, delete; each step's waits, polls, progress and error paths read in the code too (what happens when the
  worker is down or restarted, a job dies, a request fails). Minor fixes each on its own branch with a test; larger
  ones written here as phases. What it created is deleted afterwards.
  Decided (the user, 2026-11-02): **the whole M4T flight** (thermal and RGB); **everything it creates deleted**
  afterwards; **all three flows**: the Thermal Analyzer, DJI Thermal Task (the dashboard's button, its dialog and
  converted task), and the mosaic viewer and frame page.
  Done (2026-11-02), walked through on a "Live check walk-through" project: New Dataset of the whole flight (434
  photos, 791 MB, uploaded in about 16 s, analyzed in about 30 s), a workset with the WebODM plan's settings
  (harmonized, nadir, mosaics: about 4 min to convert, then the mosaics) beside one with the defaults canceled part
  way, the Mosaics table, the viewer (readout, a click's frames, Open this frame) and the frame page, Create task and
  Use for parent task, then DJI Thermal Task harmonized with mosaics (all 434 photos picked: uploaded in 15 s,
  converted and committed in about 2.5 min, processed by node-odx); everything deleted afterwards. Fixed, each with
  tests:
  - `poll-retry`: the dataset page, the datasets list, the mosaic viewer and a workset's Files table stopped
    reloading after one failed request (a dropped connection, WebODM restarting), leaving a job's progress frozen;
    they try again every few seconds while a job runs. A job whose start fails (Redis not answering) is marked failed
    with the reason (`datasets.start_job`), instead of running forever with no Celery job to find stale.
  - `unreachable-message`: a button whose request never reached the server did nothing visible (Create task's
    stayed disabled); the pages' requests answer it as a refusal, "Could not reach the server: check the connection,
    then try again." (`core.unreachable`).
  - `thermal-task-timeouts`: DJI Thermal Task's requests had no timeout, so one dropped request left its upload
    waiting forever, and normalized, one failed batch removed the whole task; requests sending files now time out
    (`serverApi.filesTimeout`, as the Analyzer's upload) and a request with no answer is sent again twice
    (`upload.retried`); a refusal is not.
  - `thermal-task-mosaics`: DJI Thermal Task's **Also build the workset's mosaics** did nothing: the upload kept only
    normalize and harmonize from the panel (`ThermalUpload.frames`). Live: 12 photos harmonized, the mosaics built
    once the task committed.
  - `untrack-node-modules`: `.gitignore` ignored only a `node_modules/` folder, so a worktree's link of that name
    could be committed.
  Larger, planned below: **Jobs left running by a stopped worker** and **Use for parent task with an unreachable
  node**. Not a bug: an upload's files stay in WebODM's `media/tmp` for a day (its upload handler keeps them, and its
  own task upload copies them too, as the plugin does; WebODM's hourly cleanup removes them after 24 h).
  For the UX review: a harmonized workset shows "Converting 0%" and an empty bar for minutes (the stage only in the
  line below); a workset's progress counts the RGB photos, skipped at once, so it jumps to 50% then crawls, and its
  card says "42 converted, 392 skipped" (RGB and oblique together); **Reset to defaults** also forgets the user's
  saved defaults; New Dataset names the dataset after the folder picked ("images"); the frame page's list doesn't
  scroll to the open frame; DJI Thermal Task's panel says the RGB photos "are ignored" but, normalized, uploads them
  to the dataset, flashes "Converting the thermal photos: 0 of 217" before "Uploading", says "Converting the 434
  photos" when 217 are thermal, has no pitch limit (the plan's nadir-only), and its normalized datasets are never
  analyzed ("Not analyzed" in the Analyzer).
- **UX review of the same workflows** (the user, 2026-11-02, from `new.md`): "As a UX design expert, walk through
  the workflows for creating datasets, worksets and tasks. Look for cumbersome and unintuitive design experiences
  that should be improved upon. Create a Claude Artifact with your findings for us to review after." Builds on the
  earlier UX review (2026-10-31, "Done: UX review" below) and everything since. Proposed: the same walk-through as a
  first-time user; findings ranked, each with where (page and panel), what is cumbersome, the proposal and a
  screenshot (no location or serial shown), sorted into quick fixes and larger changes; published as a private
  Artifact for the user to review; nothing changed until they choose. Decided (the user, 2026-11-02): as the walk-through's (the whole
  flight, deleted afterwards, the same three flows).
  Done (2026-11-02): walked through on a "Live check UX review" project (New Dataset of the whole flight, a plan
  workset with mosaics, the Files, Problems and WebODM plan tabs, Create task, the viewer and frame page, DJI Thermal
  Task's panel with the flight picked, not started), deleted afterwards. 20 findings, published as a private
  Artifact (https://claude.ai/artifact/DWqaNce3fs86aW82BHv8zt), planned as phases U1 to U5 below. Open decisions:
  D1 to D5 (in each phase), decided by the user on 2026-11-02, each recommended option.
- **U5. DJI Thermal Task's panel** (UX review, 2026-11-02), proposed first since it changes what the maps contain.
  Dashboard › a project › DJI Thermal Task, after picking photos:
  - U5-1 (larger): no pitch limit, so a normalized or harmonized task sends oblique frames to ODM (217 of 217 where
    the plan keeps 42); add "Only frames with a gimbal pitch at or below", the plan's -80° by default, with the count
    kept ("42 of 217 frames"); `api.py` TaskWorkset passes it to the workset.
  - U5-2: WebODM's Options stay at Default (5 cm/px from 2.1 cm/px frames, no RTK accuracy). Open (D4): pre-select the
    plan's recommended options (radiometric-calibration none, orthophoto-resolution at the GSD, gps-accuracy), shown
    as "Custom" (recommended), or a "Thermal plan" preset to pick, or leave Default. Decided (D4, the user,
    2026-11-02): pre-select the plan's options, shown as "Custom".
  - U5-3: progress wording: "Converting the thermal photos: 0 of 217" flashes before "Uploading", then "Converting the
    434 photos" with 217 thermal; "Uploading 434 photos", then "Converting 217 thermal photos" (or those the pitch
    limit keeps).
  - U5-4 (larger): datasets kept by the task are never analyzed ("Not analyzed"); start the analysis once the upload
    is done.
  - U5-5 (larger): one order, labels and help text for the panel and the Workset Creation Settings (after U2-2):
    labels left here and above there, Normalize/Harmonize before Measurement here and after it there, "Temperature
    unit" here and "Unit of the files" there. Moved into U2, built with U2-2.
  Decided (D4 follow-up, the user, 2026-11-02): the plan's orthophoto-resolution and gps-accuracy need the dataset's
  analysis, which can't run before the upload, so **the server sets them**: the panel pre-selects "(Custom)" with
  radiometric-calibration none, and a normalized or harmonized task left so gets the plan's recommended options once
  its dataset is analyzed; an as-is task keeps radiometric-calibration none.
  Done (2026-11-02), `thermal-task-panel`: U5-1 **Only frames looking down: a gimbal pitch at or below** -80°, ticked,
  with "42 of 217 frames" (each photo's XMP `GimbalPitchDegree`, read by exifr; `public/thermal/plan.js`); as is, the
  oblique photos aren't converted (kept in the dataset, if any), normalized, the workset gets `max_pitch`
  (`upload.js`, `api.py` TaskWorkset). U5-2 WebODM's options start as "(Custom)" `PANEL_OPTIONS`
  (`ThermalTaskPanel.presetOptions`, through WebODM's EditTaskForm once its presets load); left so, `plan_options`
  goes with the workset, and `conversion_tasks.use_for_parent(with_plan)` puts the plan's recommended options over
  the task's at commit; the worker waits up to 10 minutes for the analysis (`wait_for_plan`), the progress doesn't
  commit while it runs (`awaits_plan`). U5-3 "Uploading N of 434 photos" from the start
  (`ThermalUpload.initialProgress`), "Converting 42 thermal photos" (TaskWorkset's `frames`, answered as `photos`),
  the result message counting the thermal photos and the oblique ones left out. U5-4 TaskWorkset starts the
  dataset's analysis. Tests: `test_api.py` TestTaskWorkset (the pitch limit, frames and analysis; the plan's options
  once analyzed), Jest `plan.test.js`, `upload.test.js`. Live (dt-worker restarted): the flight's 217 thermal photos
  normalized, 42 frames in the task, analyzed during the conversion, committed with orthophoto-resolution 2.1 and
  gps-accuracy 0.02 in 19 s; deleted afterwards. README, `docs/quickstart-thermal-task.md`, `docs/api.md`,
  `thermal-task-panel.png` retaken.
- **U1. Progress and results on the workset card** (UX review, 2026-11-02). Dataset page › Worksets › a workset's
  card; quick fixes, no decision:
  - U1-1: a harmonized workset shows "Converting 0%" and an empty bar for about four minutes (the stage only in the
    grey line); the label shows the stage ("Harmonizing 3/4") and the bar fills from the stage's own progress (rounds,
    pairs, solve steps); the same while the mosaics build.
  - U1-2: progress counts the RGB photos (skipped at once: 50%, then a crawl); count only the frames to convert ("12
    of 42 frames").
  - U1-3: "42 converted, 392 skipped" becomes "42 converted · 175 oblique left out · 217 not thermal"; "skipped" kept
    for frames that failed.
  - U1-4: the analysis bar holds at 91% for about 30 s while the summary is computed (Dataset page › header); report
    it as a stage with its own share.
  - U1-5: on a converted card **Create task** (the next step) is grey beside a dark **View mosaics**; make it primary.
    While mosaics build the label says "Converted" beside a bare **Cancel**: "Building mosaics" and "Cancel mosaics".
  Done (2026-11-02), `workset-card-progress`: U1-1 while harmonizing the label reads "Harmonizing 3/4" and the bar
  fills from `mosaics.stage_fraction` (the stage's `fraction`, `conversions.convert`; `convertingHtml` in
  `public/conversions.js`). U1-2 the conversion counts its frames before it starts (`thermal_jpegs`,
  `frames_to_convert`: thermal, within the pitch limit), writes `frames` {done, total} ("12 of 42 frames converted"),
  the last one at once. U1-3 `conversions.counts`: converted · oblique left out · not thermal · skipped (failed); the
  results mark the non-thermal JPEGs (`not_thermal`), since dji-thermal-cli reports an RGB photo above the pitch
  limit as oblique; older results are counted by their reasons. U1-4 the analysis' files fill 80% of the bar
  (`analysis.FILES_SHARE`), then stage `summary` ("Analyzing: working out the flight's coverage and the WebODM
  plan…", Dataset page header). U1-5 on a converted card in no task yet **Create task** is the primary button beside
  **View mosaics**; while mosaics build, a blue "Building mosaics N%" and **Cancel mosaics**. Tests: `test_analyzer.py`
  (counts by reason, the frames' progress, the summary stage), Jest `analyzer.test.js`. Live (dt-worker restarted):
  the whole M4T flight harmonized with mosaics, the card through Harmonizing 1/4 to 4/4, "1 of 42 frames converted",
  Building mosaics, then Create task primary; the counts, wrong for the oblique RGB photos (350 oblique, 42 not
  thermal), fixed and checked on that workset's results (42 · 175 · 217); deleted afterwards. README,
  `docs/quickstart-worksets.md`, `docs/quickstart-analyzer.md`, `create-task.png` retaken.
- **The SDK note's wording** (the user, 2026-11-02, from `new.md`): "Change this statement in the admin page \"it
  reduces the performance of the DJI Thermal Analyzer.\" to say \"will reduce performance of the DJI Thermal Analyzer
  when used in this WebODM environment.\"" Builds on the SDK settings note (`templates/sdk.html`,
  `#dji-thermal-sdk-note`, Administration › DJI Thermal › "Use DJI's own Thermal SDK"). Their wording as is. Done
  (2026-11-02), `sdk-note-wording`: "Usually only needed for development purposes: will reduce performance of the
  DJI Thermal Analyzer when used in this WebODM environment." README, `docs/dji-sdk.md`, `dji-sdk.png` retaken.
- **Emissivity and Reflected under the Inspector's scale** (the user, 2026-11-02, from `new.md`): "In Thermal
  Inspector, move Emissivity and Reflected beneath the scale temperatures. Move the Manual Corrections checkbox
  beneath them and remove it's description text. Emissivity and Reflected should remain visible at all times though
  when Manual Corrections is disabled they should be disabled/greyed out and contain their default values. When
  Manual Corrections is enabled, the user may change the 2 values to any supported value." Builds on the Inspector's
  Manual Corrections (`inspector.js` `correctionHtml`, `correctionInput`). The default values: what the topmost
  layer was measured with (else 0.95 and 20 °C), as a tick starts from now. Done (2026-11-02),
  `inspector-corrections-layout`: the fields right under the scale's range and "This layer" line, the tick box
  "Manual Corrections" under them, then "Legend on the map"; unticked, the fields are disabled and hold the topmost
  layer's values (`correctionDefault`, also what a tick starts from). Removed: the "Approximate (a broadband
  model)…" line and each layer's "measured with …" line (the greyed fields show it); kept: the warning that a layer
  doesn't record how it was measured. Not in the panel's top that stays in view: there it filled a short map's whole
  panel and left the rest a sliver; they scroll with the sections under it. Jest `inspector.test.js`. README,
  `quickstart-inspector.md` section 7; `inspector`, `inspector-line`, `inspector-image`, `inspector-saved`,
  `inspector-mosaics` retaken.
- **Documentation up to date** (the user, 2026-11-02, from `new.md`): "ensure the documentation and any accompanying
  screenshots are up to date. Including the installation, quickstart and walthroughs." Builds on `docs/` and README.
  Proposed: every page read against the plugin as it is now (each step done on the dev stack where it can be), what
  is out of date corrected, every screenshot retaken and looked at, the links checked; U2 to U4 then update their own
  pages as they go. Done (2026-11-02), `docs-up-to-date`: every page read against the code and the dev stack.
  Corrected: DJI Thermal Task's pitch limit is a field (README, `quickstart-thermal-task.md`); the workset settings'
  sections as the form has them (Colours, Outputs, Measurement, Frames, Adjustments; README); the workset's ⋯ menu
  (Open on WebODM's map, Build mosaics again; README, `quickstart-worksets.md`); Normalize and Harmonize also in DJI
  Thermal Task (`measurement.md`, its anchor); the Task panel's palette (`palettes.md`); photos kept and a
  normalized task's images (`converted-images.md`); the Task's workset messages and the Inspector button on a
  project's map (`troubleshooting.md`); the analysis' `stage` and a workset's counts and `frames` (`api.md`); the
  Inspector's correction fields under the scale (`quickstart-inspector.md` section 3); README's list of the
  plugin's parts (the Inspector, frame page, measurements, correction, colouring, portable were missing).
  `dev/screenshots.js` clears the browser's storage before each shot (a run of all of them left Files and Mosaics
  open on `create-task` and earlier pins on the Inspector's). Every screenshot retaken and looked at: the changed
  ones show the user's newer datasets and projects (no place in their names), and `picture-viewer` at the Files
  tab's 1600 × 900.
- **Top use cases in the README and docs** (the user, 2026-11-02, from `new.md`): "Ensure we mention our top use
  cases in the readme and documentation. Our quickstart and tutorials should cover most of them as well. Start by
  building a list of our top use cases including but not limited to: Ability to preview mosaics and normalize,
  harmonize, change the color palette and much more! Resulting edits of which can then be used to create WebODM
  models. / Compare Mosaics & Orthophotos and adjust their attributes in realtime / Create a thermal task to avoid
  preprocessing your DJI thermal images for a WebODM task. / Analyze your results with thermal optimization and
  analysis tools." Builds on the README's opening, `docs/index.md` and the four quickstarts (all brought up to date
  by "Documentation up to date"). Proposed: the list of use cases first, for the user to approve (drafted below);
  then a "What you can do" section near the top of README and `docs/index.md`, each use case a short headline and a
  line, linked to the quickstart section that walks through it; gaps in the quickstarts filled there, screenshots
  retaken only where a page changes. Draft list:
  1. A temperature map straight from the drone's photos: DJI Thermal Task converts the R-JPEGs as they upload, no
     preprocessing (quickstart-thermal-task).
  2. Check a flight before processing it: what each photo is, the problems found, coverage, the WebODM options to
     use, saved as a preset (quickstart-analyzer).
  3. Preview mosaics without a WebODM task, and try settings on them: normalize, harmonize, palette, measurement
     values, oblique frames left out; several worksets side by side, then a WebODM task from the one you pick, or
     several tried in one task (quickstart-worksets 1 to 4).
  4. Compare mosaics and orthophotos on WebODM's map, swiped or overlaid, adjusting palette, range, brightness,
     contrast, gamma and isotherms live (quickstart-inspector 3 and 4; the mosaic viewer, quickstart-worksets 3).
  5. Measure and analyze on the map: temperature under the cursor, pins, lines with profiles, regions with
     statistics, histograms, surroundings and ΔT, isotherms, saved measurements, emissivity corrections
     (quickstart-inspector 2, 3, 6, 7).
  6. Trace a temperature back to its photos: the frames that saw a point, each frame measured in its own pixels or
     measured again with other values (quickstart-inspector 5; quickstart-worksets "One frame at a time").
  7. Clean a dataset: hottest frames first, frames without GPS, noisy frames or files removed, oblique frames left
     out (quickstart-analyzer 3; quickstart-worksets 2).
  8. Export the temperatures: TIFFs in °C, °F or K, CSV, colour PNGs, R-JPEGs, zips, with the location stripped
     when sharing (converted-images; quickstart-worksets 2).
  9. Everything on your own server: no outside service; DJI's own SDK for an administrator who wants it
     (README, dji-sdk).
  Decided (the user, 2026-11-02): the list as drafted; the headlines in the user's style, a plain line under each;
  links to the existing quickstart sections, no new tutorial pages. Done, `use-cases`: "What you can do" in
  `README.md` (before the link to the documentation) and `docs/index.md` (before the quickstarts), each use case
  linked to its quickstart section; the README's opening says "three things" (it said "two ways in" over three).
  The quickstarts already walk through every use case, so they were left as they are and no screenshot changed.
- **U2. The Workset Creation Settings form** (UX review, 2026-11-02). Dataset page › Worksets › Workset Creation
  Settings:
  - U2-1: a new dataset starts from dji-thermal-cli's defaults, four chips "≠ plan", though step 2 says to start from
    the plan. Open (D1): start from the user's saved defaults, else the plan (recommended), or keep the defaults.
    Decided (D1, the user, 2026-11-02): the saved defaults, else the plan.
  - U2-2: order Frames, Outputs, Measurement, Colours (shown only with a colour output), Adjustments (now Palette and
    Colour range first, the map's settings last); each "≠ plan" note on its own control's line ("≠ plan: harmonized"
    floats above the pitch field).
  - U2-3: Create Workset, Use the WebODM plan's settings, Save as my defaults and Reset to defaults side by side, and
    Reset also forgets the saved defaults; a "Start from" choice above the form (WebODM plan · My defaults ·
    dji-thermal-cli defaults), Save as my defaults beside it, "Forget my defaults" in its menu.
  - U5-5, from U5: DJI Thermal Task's panel in the form's new order, labels and help text.
  Design (Claude's, 2026-11-02, from the code: `public/conversions.js` `formHtml`, `markForm`, `renderForm`, the
  buttons in `templates/dataset.html`; `public/thermal/ThermalTaskPanel.jsx`, `MeasurementSettings.jsx`):
  - U2-1: the form starts from the saved defaults when there are some (`preferences`' `saved`), else from the plan
    (`planSettings` on the analysis' `process_args`); a dataset not yet analyzed starts from dji-thermal-cli's, and
    takes the plan when its analysis arrives, if the form wasn't touched meanwhile. The line above the form says
    which ("Starting from the WebODM plan's settings").
  - U2-2: sections Frames (pitch limit, Normalize, Harmonize), Outputs (with Mosaics), Measurement, Colours (hidden
    while no colour output is ticked), Adjustments. A "≠ plan" or "default" note goes at the end of its own control's
    label (a checkbox's too), never at the end of its group.
  - U2-3: the buttons are replaced by a **Start from** choice above the form (WebODM plan, My defaults, dji-thermal-cli's
    defaults; each fills the form, My defaults only when saved), with **Save as my defaults** and **Forget my
    defaults** (when saved, asks first) beside it; under the form only the name and **Create Workset**.
  - U5-5: DJI Thermal Task's panel in the same order (Frames: pitch limit, Normalize, Harmonize, mosaics; then
    Measurement; then Palette) and the same words for the same settings. "Temperature unit" (the panel: the unit
    of the values typed, the images always °C) and "Unit of the files" (the form) stay apart: they are different
    settings.
  Decided (the user, 2026-11-02): the **Start from** choice as designed; the pitch limit a checkbox in both, "Only
  frames looking down: a gimbal pitch at or below", the limit beside it (-80° when ticked), unticked keeping every
  frame; labels each as its page (left in the Task panel, as WebODM's panel under it; above in the form), the order
  and words shared.
  Done (U2-1, U2-2, U2-3, U5-5), `u2-settings-form`: `public/conversions.js` (`formHtml`'s order, the pitch checkbox
  and `colours`, `markForm`'s notes on their own label, `fill`/`startFrom` and the Forget button in `init`),
  `templates/dataset.html` (Start from), `analyzer.css`, `thermal/ThermalTaskPanel.jsx` (Palette after Measurement,
  the shared help texts); tests in `__tests__/analyzer.test.js` (the order and Colours, the pitch checkbox, starting
  from the plan once analyzed, Start from, saving and forgetting). Checked live on the "Thermal - 9/18/2026" dataset
  (read only). README, `quickstart-worksets.md`, `quickstart-thermal-task.md`; `workset-settings.png`, `dataset.png`
  and `thermal-task-panel.png` retaken. U2-4 waits for the dji-thermal-cli release (D2).
  - U2-4 (larger, its own phase): harmonize and the mosaics each align the frames (about 2.5 and 3 minutes of a
    6-minute plan workset). Open (D2): reuse harmonize's alignment for the mosaics, later, after a dji-thermal-cli
    release that saves and accepts an alignment (recommended), or keep both. Decided (D2, the user, 2026-11-02):
    reuse it, later, after that dji-thermal-cli release. Planned at the top of "Up next" (U2-4), for 1.0.0.
- **U3. New Dataset, the Files and Problems tabs** (UX review, 2026-11-02):
  - U3-1: Thermal Analyzer › New Dataset › Name is the folder picked ("images"). Open (D3): the camera and capture
    date from the file names ("M4T 2026-10-12"), the folder's name kept unless generic (images, DCIM, 100MEDIA)
    (recommended), or the folder's parent. Decided (D3, the user, 2026-11-02): the camera and capture date.
  - U3-2: New Dataset › Project proposes "First Project" with the list filtered to another; pre-select the filter's
    project, else the last used.
  - U3-3: Dataset page › Files opens on "All files", 217 rows of "Not thermal" first; open on "Thermal frames"; the
    table scrolls sideways in its own box when the detail pane is open (Distance's header is cut).
  - U3-4: Dataset page › Problems: two of the four warnings (7 hottest, 39 coldest) are oblique frames only, which
    the pitch limit removes; fold such a warning into the pitch note, so the step bar's count shows what affects a map.
  Done (2026-11-02), `u3-dataset-files`: U3-1 the name is filled from the first thermal photo's EXIF (IFD0 Model and
  DateTime, read in the browser: `analyzer_core.js` `exifCamera`, `readCamera`, `datasetName`), "M4T 2026-10-12",
  the day from a DJI file name when the EXIF has none; without a camera, the folder unless generic (images, DCIM,
  100MEDIA…), else "Thermal dataset"; a name typed meanwhile is kept. U3-2 the project the list is filtered to, else
  the last one a dataset went to (`thermalAnalyzer.newDatasetProject`, this browser), kept through the list's polls
  (which used to reset it to the first). U3-3 the Files tab opens on Thermal frames (All files when there are none),
  without the Kind column there; names may wrap after their timestamp (`<wbr>`), so every column fits beside the
  detail pane. U3-4 a non-error finding naming only the oblique finding's frames is shown under it, "Only in oblique
  frames" (`dataset.js` `foldFindings`), and not counted on the tab, in the steps or in the datasets list
  (`analysis.severities`). Tests: Jest `analyzer.test.js`, `test_analyzer.py`
  (`test_the_list_counts_a_warning_naming_only_oblique_frames_as_info`). Checked live (read only) on the "Thermal -
  9/18/2026" dataset and New Dataset with the M4T flight's folder (nothing created). README,
  `quickstart-analyzer.md`; `new-dataset.png` (photos chosen, the name filled) and `dataset-files.png` retaken.
- **U4. The frame page** (UX review, 2026-11-02). Mosaic viewer › Open this frame › frame page:
  - U4-1: the list doesn't show the frame opened (0022 opened, 0001 to 0017 shown); scroll it into view, centred,
    and highlight it.
  - U4-2: from a mosaic, open on "In the mosaic" (42) rather than "All" (217).
  Open (D5): the order U5, U1, U2, U3, U4. Decided (D5, the user, 2026-11-02): that order.
  Done, `u4-frame-page`: U4-1 the list was drawn while the page was still hidden, so its scroll did nothing; now
  `frame.js` `scrollList` centres the frame shown once the page shows it, and again whenever it leaves the list's
  view (stepping within view leaves the list still). U4-2 the mosaic viewer's and the map's mosaic overlay's **Open
  this frame** add `list=mosaic` (`frames.js` `framePageUrl`; not from a WebODM orthophoto); a frame not in the list
  asked for opens on All. Tests in `frame.test.js`, `analyzer.test.js`, `inspector.test.js`; checked live on the
  "Thermal - 9/18/2026" dataset (frame 0111: centred, "In the mosaic 200"). README, `quickstart-worksets.md`; no
  screenshot changed (the frame page's opens on the first frame).
- **Jobs left running by a stopped worker** (found in the walk-through, 2026-11-02): when WebODM's worker stops in
  the middle of a job (`docker restart`, a crash, the machine restarting), Celery never marks the job failed (the
  message was taken; no result is ever written), so `datasets.check_stale` never finds it gone: the analysis, workset,
  mosaics or measuring shows as running until the user cancels it, and DJI Thermal Task's task waits for its workset
  forever. Proposed: each job writes a heartbeat (`updated_at`) with its progress, at least every minute even when a
  long step reports nothing (a thread in `run_job`); a job without one for several minutes is checked with Celery
  (`inspect().active()` / `reserved()`, once per check, cached), and marked failed with "The … job stopped before it
  finished" when no worker has it. Decided (the user, 2026-11-02): **only jobs that have started count**; a job
  waiting in the queue is never marked lost. Done, `stopped-worker-jobs`: `datasets.run_job` starts a thread
  (`datasets.beat`) writing `heartbeat_at` in the job's file every minute while the job is its run; `check_stale`
  marks a running job failed when its heartbeat is over five minutes old (`datasets.silent`), as well as when Celery
  reports it failed. A queued job has no heartbeat, so it waits however long. Without the Celery inspect check: a
  live worker's thread keeps beating, so a silent heartbeat is enough. A worker running an older copy of the plugin
  skips the heartbeat. Tests in `test_analyzer` (`...heartbeat_stopped_is_marked_failed_but_a_queued_one_keeps_waiting`,
  `...writes_its_heartbeat_only_while_it_is_the_jobs_run`); `docs/troubleshooting.md`.
- **Use for parent task with an unreachable node** (found in the walk-through, 2026-11-02): sending a workset to
  the dataset's own task removes the task's old run from its processing node (`conversion_tasks.clear_parent`,
  `node.remove_task`) inside the transaction that holds the task's row: a node that doesn't answer holds the request
  (and the row) for up to a minute (WebODM's client waits 30 s, for the task and then its removal). Proposed: remove it from the node after the transaction, with a short
  timeout, logged when it fails (the node purges old tasks itself). Decided (the user, 2026-11-02): as proposed.
  Done, `parent-node-timeout`: `conversion_tasks.clear_parent` returns the old run, which `use_for_parent` removes
  once the task is saved (`remove_old_run`, `NODE_TIMEOUT` = 5 s, a failure logged). Test in `test_analyzer`
  (`test_a_conversion_sent_to_the_datasets_task_replaces_what_was_sent_there_before`: removed after the save, a node
  timing out doesn't fail the request).
- **The user's testing and polishing** (2026-10-30): bugs and polish they report go here, each fixed on its own
  branch. Publishing 1.0.0 waits for it.
  - Done: **removing files from a dataset** (the user, 2026-11-02: "For the Files view under dataset we should add the
    ability to remove files as well, just like is done for the worksets view."). Decided (the user, 2026-11-02):
    **Remove from dataset** in the dataset page's Files tab detail pane (one file, or those selected), for those who
    can change the project, with a confirmation; the files deleted from the dataset's images (and their cached
    thumbnails), their rows gone from the table at once; each workset that converted a removed frame has it removed
    as Remove from workset does (outputs and saved measurements deleted, counted as removed, mosaics marked out of
    date; tasks made before keep their images), refused if it would leave a workset without a converted frame, and
    while the dataset is analyzing or a workset converting or building mosaics; the analysis kept but marked out of
    date (Analyze again prompted), as after Add images. `remove-dataset-files`: `conversions.remove_images` (checks
    everything first, then `remove_frames` per workset, the images, the analysis' files, `images_changed`),
    `POST datasets/<id>/remove` (`analyzer_api.DatasetRemoveFiles`, the cached thumbnails found by `thumbnail_key`
    before the images go), `dataset.js` (`removeFilesHtml`, `removeBusy`, `removeFiles`). README,
    `quickstart-analyzer.md`, `api.md`, `troubleshooting.md`. Django (`TestRemovingFrames`: the effects, and who and
    when), Jest (the flow, the button disabled or absent). Live: a "Live check remove files" dataset of 3 flight
    frames, analyzed, 2 removed in the page, then deleted.
  - Done: **the dataset Files tab's detail pane hid its last columns** (the user, 2026-11-02: "the detail pane on the
    right blocks the far right column. Either remove the column or move the viewer over to the right more"),
    `dataset-files-layout`. Decided (the user, 2026-11-02): both. The Notes column is gone (the pane already shows a
    file's problems, warnings and reason), and the dataset page is up to 1600px wide (`#ta-dataset.ta-page`), so from
    a window of about 1500px the whole table fits beside the pane; narrower, it still scrolls sideways. `dataset.js`,
    `analyzer.css`. README, `quickstart-analyzer.md`, `dataset-files.png` (now shot at 1600px) and `workset-files.png`
    retaken. Jest.
  - Done: **a workset's Mosaics as a table with previews** (the user, 2026-11-02: "Instead of a set of links for
    Mosaics, can we give them a similar preview and interactive table format like we do for images under the Files
    table?"), `workset-mosaics-table`. Decided (the user, 2026-11-02): one row per mosaic (As converted, Harmonized),
    its columns the preview, frames used, size and GSD, and min and max; everything else in the detail pane. The pane,
    as the Files' (the mosaic under the mouse, or the one clicked; Ctrl/Cmd or Shift for both, downloaded as one zip;
    Esc unselects): the preview at its own size (click: the picture viewer over both), a button per file, **View
    mosaic** (the viewer on that tab) and dji-thermal-cli's report (`core.mosaicReportRows`, shared with the viewer). No
    sorting (two rows). The summary's `mosaics` (`mosaics.summary`, without the bounds), `GET .../mosaics/<kind>/preview`
    (`mosaics.preview`, `?size=large`), the download's POST taking `mosaic`. `conversions.js` (`mosaicsHtml`,
    `mosaicDetailHtml`), `analyzer.css`. README, `quickstart-worksets.md`, `api.md`, new `workset-mosaics.png`
    (`dev/screenshots.js`). Django (in the flight test: the summary, the previews, the zip), Jest (the table, the pane,
    hover, selection, zip, picture viewer). Live (read only): Roof Sample.
  - Done: **a workset's Mosaics in a section of their own** (the user, 2026-11-02, from `new.md`: "On the Files view
    in a workset, move the Mosaics download links out of the Files section into their own collapsible section below
    Files."), `workset-mosaics-section`. A **Mosaics** toggle below Files, with the file count, shown once mosaics
    are built, closed at first and remembered in the browser apart from Files (`MOSAICS_PREFIX`); the files grouped
    by mosaic (As converted, Harmonized). `conversions.js` (`mosaicFilesHtml`), `analyzer.css`. README,
    `quickstart-worksets.md`, `workset.png` retaken. Jest (the section, and its toggle remembered). Live (read only):
    Roof Sample, opened and a mosaic's file downloaded.
  - Done: **building the mosaics again kept no saved measurements** (found 2026-11-02 while planning removing frames),
    `keep-measurements-on-rebuild`. `mosaics.remove`, run before each build and after a failed or canceled one,
    deleted the whole `viewer/` folder, with the measurements saved on the mosaics (`measurements.json`) and on the
    frames (`frame-measurements.json`) in it; it now keeps those (`mosaics.KEPT_FILES`), deleted only with the
    workset. Django (`test_building_the_mosaics_again_keeps_the_measurements_saved_on_them_and_on_the_frames`).
  - Done: **removing frames from a workset** (the user, 2026-11-02, from `new.md`: "on the Files view detail pane
    for a image in a Workset, add the ability to delete a file from the workset; or multiple if more than one
    selected. This allows the user to manually remove files that are more noise than they desire. Then they can
    create new mosaics and tasks from the reduced file set if they so please."), `remove-workset-frames`. Decided (the
    user, 2026-11-02): a removed frame is gone from the table, the workset's line counting them ("325 converted · 2
    removed"); mosaics built before are kept, marked out of date ("The mosaics were built with frames since removed",
    with Build again); measurements saved on a removed frame are deleted with it. **Remove from workset** at the
    bottom of the detail pane (one image, or "Remove N from workset" for the selection), for those who can change the
    project, once converted (disabled while the mosaics are built), with a confirmation. `conversions.remove_frames`
    deletes their outputs and moves them from `results.json`'s files to its `removed` (path, by whom, when), so new
    tasks (`conversion_tasks.tiffs`) and the frame page leave them out; it refuses removing the last converted frame
    (delete the workset instead). Mosaics built again are built from hard links (copies where the storage can't link)
    to the frames the workset keeps, at their paths in the dataset (`mosaics.kept_frames`, `mosaic-frames/`, removed
    once built), so the viewer finds them as before. The summary's `removed` and `mosaic_outdated` (a removed frame
    among the mosaics' frames). `POST .../conversions/<workset>/remove` (`ConversionRemoveFrames`);
    `measurements.frames_path`, `remove_frames`; `conversions.js` (`removeButtonHtml`, `removeFrames`, `mosaicHtml`).
    README, `quickstart-worksets.md`, `api.md`, `troubleshooting.md`, `workset-files.png` retaken. Django
    (`TestRemovingFrames`: files, measurements and tasks; who and when; links; a flight's mosaics built again
    without the frame), Jest (the pane's button, the confirmation, the count, the out-of-date note). Live: a "Live
    check" copy of a Roof Sample workset (outputs hard-linked, records copied), 2 frames removed in the page (327 → 325
    rows, 662 → 658 files, mosaics marked out of date), then deleted through the page; the original untouched.
  - Done: **a workset's Files table: its header in view, aligned and sortable** (the user, 2026-11-02, with a
    screenshot: "Make the Files table header row sticky ... Shade the background of the header row ... Align the
    column contents with the header row ... Each column should be sortable ascending/descending where sensible.
    Remove the Notes column."), `workset-files-header`. The table scrolls in its own box (`.ta-results-scroll`, as
    tall as the window) so its header can stick (the page's horizontal scroll box would stop it otherwise); the header
    shaded; the figures' headings right-aligned like their values, cells centred vertically beside the thumbnails;
    every column but the thumbnail sorts either way; Notes gone (still in the detail pane). `conversions.js`
    (`RESULT_COLUMNS`), `analyzer.css`. README, `quickstart-worksets.md`, `workset-files.png` retaken. Jest (the sort
    and alignment test). Live (read only, thumbnails blocked): Thermal - 9/18/2026, scrolled 1500 px, sorted by Max.
  - Done: **a workset's Files: more figures, thumbnails and a detail pane** (the user, 2026-11-02, with a screenshot of a
    workset's Files table: "should show more file information such as emissivity, background temp, temperature
    min/max ... a thumbnail view of the image to the left of the filename. When you select an image, a detail pane on
    the right should open with the full size frame and its properties in a table below it, along with controls to
    download it. When no image is selected, the detail pane should follow the mouse's hover"), `workset-files-detail`.
    Builds on the dataset's Files tab (`dataset.js`: thumbnails, `detailHtml`, Hover for Detail, selection) and the
    frame page's measurement (`frames.info`). Design: columns thumbnail, Image, Result, Min, Max, Emissivity,
    Reflected, Distance, Notes (temperatures in the user's unit); the pane: the frame at its own size in the user's
    palette, what it was measured with, min/max/mean, the harmonizing offset, notes; downloads of its outputs, its
    temperatures (CSV, float TIFF) and Open frame. A conversion records each frame's figures in `results.json`.
    Decided (the user): **the Outputs column moves to the detail pane**; **older worksets are filled in once** (the
    worker measures their frames the first time their Files open, with a progress line, and saves it); **several
    images can be selected** (Ctrl/Shift-click, as on the dataset's Files tab), their outputs downloaded as one zip.
    Built: `frames.py` (`frame_figures`, the `measure_all` job, `figures.json` and `figures-job.json` in the workset's
    folder: about 35 ms a frame), started by `conversions.convert` once converted (a job of its own: a DJI Thermal
    Task's start isn't delayed) and by the workset GET for an older one; `analyzer_api.py` (the detail's `figures*`,
    `POST .../figures` Measure again, `POST .../download` some outputs as a zip, the thumbnail's `?workset=` for a
    dataset never analyzed, as a DJI Thermal Task's); `conversions.js` (`resultRows`, `resultsHtml`,
    `resultDetailHtml`, selection, hover, polling while measuring, the picture viewer). Thumbnails and hover always on
    in a workset's table. README, `quickstart-worksets.md` (new `workset-files.png`), `api.md`, `troubleshooting.md`.
    Tests: `test_frames.py` (figures as the TIFF, measured once for an older workset, Measure again, the zip,
    thumbnails through the workset), Jest (figures, pane, hover, selection, zip). Live: Thermal - 9/18/2026 (not
    analyzed: found the thumbnails' 404) and Roof Sample.
  - Done: **a DJI Thermal Task starts reliably** (the user, 2026-11-02: "hangs at 100% for many seconds before failing
    with 'task failed to start'", with two start buttons), `reliable-thermal-task-start`. Cause: a worker started
    before `commit_parent` existed converts and stops. Now the progress GET (api.py `TaskWorkset.progress`) commits a
    converted workset too, and `commit_parent` commits once under the task's row lock (the second caller finds it
    committed); no 60 s wait (`START_S`, `since_converted` gone): the plugin's Start processing shows only after a
    real error, with it. Decided (the user): **WebODM's own Start Processing is left**; the help line warns against it.
    Tests: `test_api.py` (progress commits, not after an error; a second commit leaves it), `worksetProgress.test.js`.
  - Done: **polish, the progress's place and finish, and no mosaics by default** (the user, 2026-11-01, with a
    screenshot of the panel: "move the buttons below progress bar and message, or vice versa", a green bar with
    "Complete!" and a checkmark, "creating a task shouldn't create mosaics by default"), `workset-progress-polish`.
    Decided (the user): **the task starts by itself**, Complete! once it has; one that didn't gets the plugin's own
    Start processing (WebODM's would start it without the TIFFs). `main.js` adds the progress first, on a line of its
    own (`WorksetProgress` sets its wrapper to block); the finished bar in the theme's success colour
    (`theme-background-success`, as WebODM's Completed; its `progress-bar-success` is the link colour);
    `worksetProgress.js` `not_started` also when still waiting a minute after the conversion (`since_converted`,
    `START_S`); `api.py` `TaskWorksetStart` (`workset/start`), `mosaics` off unless sent; `ThermalTaskPanel.jsx`
    "Also build the workset's mosaics" (with Normalize, off). README, `quickstart-thermal-task.md`,
    `troubleshooting.md`, `api.md`. `test_api.py` (1 new, 2 changed), `worksetProgress.test.js`, `main.test.js`.
    Live (read only): Thermal-Fulgurite (converted by the old worker, never committed) showed "Converted, but the
    task didn't start" with Start processing (not pressed); a faked started answer the green Complete!; the panel's
    tick box with Harmonize.
  - Done: **polish, a DJI Thermal Task's conversion shows its progress** (the user, 2026-11-01, with a screenshot of
    the "Thermal task created" message: "is there a way for this to show progress? Otherwise the page appears hung
    and I'm afraid to refresh."), `workset-progress`. Decided (the user): **in the message and in the task's panel**
    (WebODM lets a plugin add to a task's expanded panel only, not its row). `api.py` TaskWorkset GET (the task's
    workset with `then`, its job, `committed`, `task_error`); `thermal/worksetProgress.js` (the state),
    `thermal/WorksetProgress.jsx` (a bar, the normalizing's stage through `analyzer_core.stageText`, "you can refresh
    or close this page", asked every 3 s; the task list refreshed once the task starts), in `ThermalTaskButton`'s
    message and, built as its own bundle, in the panel (`main.js`). A panel button that loads a bundle first is
    dropped by WebODM (its trigger stops listening after the first answer, ApiFactory.js), so `main.js` answers at
    once with `DjiThermalLazy`, which loads it. README, `quickstart-thermal-task.md`, `api.md` (the workset row, which
    was missing). `test_api.py` (1), `worksetProgress.test.js` (3), `main.test.js` (2). Live (read only): ThermalTest2's
    panel showed its real state (converted, "putting the images in the task"), and a faked converting answer the
    stage with a moving bar.
  - Done: **bug, a harmonized DJI Thermal Task waits forever** (the user, 2026-11-01: ThermalTest2, 220 photos, still
    "Waiting to start processing" after its workset converted), `fix-workset-commit-chosen-node`. Two causes:
    - WebODM's upload gives the partial task the node chosen (node 1 here; the tests only used Auto), and
      `commit_parent` → `use_for_parent` took "a node and no status" for processing in WebODM (`parent_busy`) and
      refused. A partial task is no longer busy (WebODM processes no partial task). `test_api.py`: the commit test
      uses a chosen node. Django 180 OK, Ruff.
    - The dev server's worker had run since before the day's changes, so it ran the old `conversions.py` (no commit
      at all), and `run_function_async` sent the wrong lines of the changed `datasets.py` (the mosaics'
      `KeyError('run_job')`). Not a plugin bug: CLAUDE.md now says to restart the worker after changing Python.
    WebODM deletes a partial task after 72 hours (`CLEANUP_PARTIAL_TASKS`).
  - Done: **bug, deleting a dataset kept in a task removes the task's saved measurements and palette** (found
    building `task-palette`, the user agreed, 2026-11-01), `fix-release-keeps-measurements`. `conversion_tasks.release`
    removed the whole `thermal/` folder, though the task, its orthophoto and the Thermal Inspector on it stay; a
    workset's measurements belong to the dataset and still go with it. `release` keeps `TASK_KEEPS`
    (`task.json`, `measurements.json`) and removes the folder only when nothing is left. README, the
    `quickstart-thermal-task.md` paragraph. `test_analyzer.py` (1); Django 180 OK, Ruff.
  - Done: **bug, the Thermal Inspector's Manual Corrections: Emissivity and Reflected change nothing on the map**
    (the user, 2026-11-01: "no visible impact on the image. Something's amiss"), `fix-correction-colours`. The
    correction changed only the numbers shown: a layer's range is kept in its own values, so the scale's labels
    moved and the colours stayed (dji-thermal-cli and the frame page's Measure again were checked and apply both).
    Decided (the user): the colour scale **keeps the temperatures it shows**, so the colours change; Auto stretches
    it over the corrected layer again. `inspector.js` (`keptRange`, `correctionInput` sets each corrected layer's
    range), its note; README, `quickstart-inspector.md` section 7; screenshot `inspector-saved` retaken.
    `inspector.test.js` (2). Jest 240, ESLint, Ruff (one earlier Jest run under load had 2 failures, not seen in
    three runs since). Live on ThermalTest (read only): emissivity 0.6 kept 15–42.8 °C and changed the tiles'
    pixels, reflected 60 °C again, Auto went to −32.6–26.1 °C with a picture close to the first, unticking kept
    that scale.
  - Done: **bug, a task's dataset shows as a second task** (the user, 2026-11-01, with a screenshot of Test project on the
    Dashboard): "I clicked "Thermal dataset" on the ThermalTest task here. I then and added images, converted mosaics
    etc... however it seems to have created a new task in my Test Project instead of linking to the existing
    ThermalTest task."
    - What it builds on: a dataset is kept in a holder task of its project (`datasets.py`), which the Dashboard lists
      ("Thermal dataset: ThermalTest", 0 images, "Set a processing node"). `task-dataset` made such a holder and
      linked ThermalTest to it by the `.dji-thermal-from-` tag. A holder can already become a processed task (a
      workset sent to it, `use_for_parent`), and deleting a dataset whose task has images keeps the task
      (`conversion_tasks.release`). WebODM removes a task's whole folder only on delete or a backup restore; a
      restart removes its assets, not `thermal/`.
    - Proposed: the DJI Thermal Task's task becomes the dataset's own task (its tag, its `thermal/` folder, its name
      kept), so no second task; deleting the dataset keeps the task (`release`).
    - Decided (the user, 2026-11-01): **the dataset inside the task**, also for the tick box; **the user's existing
      dataset moved into ThermalTest**.
    - Done (2026-11-01), `dataset-in-task`: `datasets.adopt` (the tag, `thermal/` records with `in_task`, the name
      kept) and `in_task`; `rename` without the holder's prefix for such a dataset; `conversion_tasks.linked_dataset`
      gives a dataset's own task itself, `link_dataset` adopts the task (a stale link's tag dropped); deleting such a
      dataset releases its task (`analyzer_api` `DatasetDetail.delete`). README ("Where a dataset is kept"),
      `quickstart-thermal-task.md`, `quickstart-analyzer.md`, `api.md`. `test_api.py` `TestTaskDataset` (8). Live:
      the tick box's upload (commit intercepted) made the new task the dataset (3 tasks with ThermalTest and the
      holder, none added), removed after. The user's dataset moved: its `thermal/` hard-linked into ThermalTest's
      folder (`in_task` added), ThermalTest tagged as the dataset (its link tag dropped), checked read only (the
      dataset page, the workset's mosaic viewer drawing tiles, the panel's Thermal dataset link), then the holder task
      deleted with its folder; checked again after.
  - Done: **polish, the dataset page names its WebODM task** (the user, 2026-11-01, with a screenshot of ThermalTest's
    dataset page): "We should add the name and a link to the parent webodm task, for both visibility in the ui but a
    navigation path between the 2". Done (2026-11-01), `dataset-task-link`: under the dataset's name, "WebODM task
    <name>" linking to the task's expanded panel on the Dashboard (whose Thermal dataset button links back), for a
    dataset kept in a task (`in_task`, now in the dataset's details) or whose own task holds images (`dataset.js`
    `taskLink`). README, `quickstart-analyzer.md` section 2; screenshot `dataset` retaken. `analyzer.test.js` (1),
    `test_api.py`. Live on ThermalTest (read only): the link shown, followed to its panel.
  - Done: **polish, the Thermal Inspector's Regions list: no "Show its statistics" button** (the user, 2026-10-31:
    it "doesn't appear to do anything"; it only chose whose statistics are shown, which the name did too),
    `remove-region-chart`. Decided (the user): removed; a click anywhere on a region's row shows its statistics
    (measured again if they never came), its name also zooms to it, and the row has a pointer cursor.
    `inspector.js` (`regionsHtml`, `onPanelClick`), `inspector.css`; README; docs screenshot `inspector` retaken.
    Jest 161 (no tests changed), ESLint; live with two regions: a row click switches the statistics without
    moving the map, a name click switches and zooms, a × removes its row and the statistics go to the other one.
  - Done: **bug, the Thermal Inspector's Regions list: a region's × (remove) can't be clicked** (the user,
    2026-10-31; a screenshot and a video), `fix-inspector-links`. Hovering the statistics button (or the ×) made
    it a 30px block: WebODM's Leaflet stylesheet has `.leaflet-bar a, .leaflet-bar a:hover { display: block;
    width: 26px; … }` (30px under `.leaflet-touch`), which on hover tied with `inspector.css`'s override (0,2,1)
    and came later; WebODM's theme also sets those links' background `!important` (white, grey on hover). The
    block pushed the × onto a new line, away from the cursor, and back when the cursor left. `inspector.css`: the
    panel's link rule is now `.leaflet-bar.dt-inspector .dt-inspector-panel a` (and `:hover`, `:focus`), with
    `background: none !important`, and the row's buttons 4px apart. Jest 161, ESLint; live (headless, a region and
    a pin drawn in a fresh browser): the links keep their size and position on hover, an ordinary click on each ×
    removes its row, the close link and the toolbar's Inspector button unchanged; docs screenshot `inspector`
    retaken. `inspector.css` is fetched by WebODM's module loader without a version, so a browser that cached it
    needs one reload bypassing the cache.
  - Done: **bug, "Could not load the dataset." after an update** (the user, 2026-10-31), `script-versions`: the
    browser ran its cached `analyzer_core.js` (without `optionHtml`) with the new `dataset.js`, drawing the page
    threw, and `load()`'s catch said the request failed. Now `analyzer_pages.version` (a hash of `public/`'s and
    `public/build/`'s scripts and stylesheets: names, sizes, times) is added as `?v=` to the pages' script and
    stylesheet URLs, and to `include_js_files` (WebODM only turns those into URLs). The dataset and datasets pages
    say a page that failed drawing apart from a failed request ("Could not show the dataset (…). Reload the page,
    bypassing the browser's cache") and log the error. Still unversioned: what WebODM's module loader fetches by
    name (`build/ThermalTaskButton.*`, `inspector.css`, `build/Leaflet.js`). Jest 161, Django 134 (1 skipped); live: the
    pages and the Dashboard load with `?v=`, the old `analyzer_core.js` served shows the new message.
  - Done: **The WebODM plan tab, usable without a command line** (the user, 2026-10-31), `plan-presets`. Code:
    `analyzer_core.optionHtml` (the sections), `conversions.optionsFormHtml` / `readOptions` (Create task's
    tickboxes, shared), `dataset.js` (`presetOptions`, `presetHtml`, `readPresetForm`, the panel); docs: the
    Analyzer quickstart, screenshots `dataset-plan` and `dataset-preset`. Jest 161 (no tests added); live check on
    the test flight: a preset saved, saved again with a box unticked (asked, replaced, still one), then deleted
    (10 presets before and after). WebODM's task
    options dialog (a task's Options > Edit) lists options by their ODM name, in collapsible sections, so the names
    are right; what's missing is where to find them. Decided (the user):
    - **The section above each option's name**, in small grey text ("Input & Preprocessing › Multispectral";
      only the section when WebODM shows no subsections, as for Orthophoto), from WebODM 3.3.2's
      `EditPresetDialog.jsx` (`OPTION_GROUP_MAP`) for the options the plan can suggest; a line under the heading
      says how to reach the dialog. The same in the workset's Create task table.
    - **Save as a WebODM preset**: a panel like Create task's, with a name (default "DJI Thermal: *dataset*") and
      the plan's options as tickboxes (recommended ticked), plus WebODM's own Default preset's options
      (`auto-boundary`, `dsm`; read from WebODM, not copied), ticked, so picking the preset loses nothing. Saved
      with WebODM's presets API (`/api/presets/`). When the user already owns a preset of that name: asked, then
      replaced (no duplicates).
  - Done: **bug, the mosaic viewer's page drawn over WebODM's menus** (found in the UX review, 2026-10-31),
    `fix-picture-viewer-classes`: the picture viewer's `.ta-viewer` rule (fixed, z-index 100000) also matched the
    mosaic viewer page's root (`ta-page ta-viewer`). The picture viewer's classes are now `ta-picture*`
    (`picture_viewer.js`, `analyzer.css`). Jest 161; live: the mosaic viewer page laid out again, the picture viewer
    rechecked (zoom, 1:1, the wheel, a drag, Fit, ← →, Esc, a click beside it, a photo refitted on resize).
  - Done: **the Files tab's detail pane** (the user, 2026-10-31), `files-detail-pane`. Decided (the user): a click
    on a row selects it (Ctrl/Cmd-click adds or removes, Shift-click a range, a click on the only one selected
    unselects; Esc and the pane's × too); the pane sits beside the table, sticky while the list scrolls (stacked
    under 900px). One file: its source as uploaded (`datasets/<id>/files?file=`, `DatasetFiles.get`, inline or with
    `download=1`), Download, and a table of what the analysis read (`dataset.detailRows`); several: their count and
    Download as a zip (`DatasetFiles.post`, a form posted with the paths, streamed with zipstream-ng). **Hover for
    Detail** beside Thumbnails (remembered in the browser): the pane follows the row under the mouse while nothing
    is selected. Found on the way: the Files table's frame links (`view.frames`) were never set, so rows opened no
    frame page; the hook is kept (an Open frame button in the pane) for when one exists. Tests: Jest 161,
    `test_analyzer.py` `TestDatasetFiles` (3). Live check on the test flight (GETs and the zip only): hover, a
    selection kept while hovering, a single download (872 KB), a Shift range of 4 and its zip, Esc.
    Then (the user, 2026-10-31, `detail-pane-palette`): the pane shows the palette picture, not DJI's embedded one:
    `thumbnail?size=large` (the frame's own size, cached beside the thumbnails), in the user's DJI palette, or the
    frame's own when theirs is one of WebODM's; Download still gives the file as uploaded.
  - Done: **Workset wording and layout** (the user, 2026-10-31, from `new.md`), `workset-wording-layout`; the
    Harmonized wording agreed with "made to agree on temperature" (so it doesn't suggest other attributes change);
    the WebODM plan's "Convert with these" became "Use these settings" (it fills the form, it doesn't create);
    `analyzer_core.sortRows` (moved from `dataset.js`) sorts both the Files tab and a workset's Files (Image and
    Result; Outputs and Notes not). Jest 159; live check on the test flight (GETs only, a fresh browser profile):
    the new labels, Files collapsed then open and kept across a reload, sorting both ways, the new Harmonized note:
    1. The Convert form's button **Convert** becomes **Create Workset** (`public/conversions.js`; also the
       messages that say "Convert", e.g. the WebODM plan's "Convert with these" and the task hint "Convert, then
       create the task from the new workset", reworded to match).
    2. The form's **Settings:** toggle becomes **Workset Creation Settings:** (`conversions.js`, the `ta-collapse`
       toggle).
    3. A workset's **Files** leaves its menu (`conversions.js`, the `files` item, "Files" / "Hide files") and becomes
       an expandable/collapsible table in the workset's box, under its Task link area.
    4. The **Harmonized** mosaic's note at its top right (`public/viewer.js`, `TAB_HINTS.harmonized`, now "Normalized:
       one ambient and reflected temperature for every frame, and each frame's offset against its neighbours removed
       (camera drift between recalibrations).") rewritten to explain harmonization simply and say concisely how it
       differs from the mosaic converted with the workset's settings. Draft, for the user: "Harmonized: the frames
       made to agree. The camera drifts a little between its self-calibrations, so overlapping frames of the same
       ground can read a degree or two apart. Here every frame uses the same ambient and reflected temperature, and
       each is shifted to match its neighbours where they overlap. Compared with the Mosaic tab: no seams or patches
       from drift; the temperatures may sit slightly higher or lower overall."
    Decided (the user, 2026-10-31): the Files table starts collapsed (its state kept per workset in the browser),
    and its column headers sort ascending/descending where sensible.
  - Done: **bug, the Thermal Inspector's palettes didn't match the Analyzer's** (the user, 2026-10-31),
    `inspector-dji-palettes`: the inspector listed only WebODM's colour maps. It now lists the Analyzer's list (DJI's
    palettes as "DJI *name*", then WebODM's colour maps) and draws DJI's with the plugin's own tiles (step 3b below).
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
  - Closed: that live check's orthophoto (40 frames not normalized, 6.9 to 31.8 °C, the plan's options
    with orthophoto-resolution 2.1) read -601 to 603 °C in WebODM's statistics, where the release check's
    (normalized) gave 6.9 to 45.0 °C: not from sending (the same TIFFs a new task gets), to find out before 1.0.0.
    **Not reproduced** (2026-10-30): the same 40 frames, the same workset settings and options, processed three
    times on ODM 3.8.5: a task from Create task (5.6 to 32.1 °C), the same with `texturing-skip-global-seam-leveling`
    (6.7 to 32.2 °C), and sent with Use for parent task as the bad run was (6.2 to 32.0 °C); every visible pixel
    within the frames' range, the masked area 0. Not seam leveling, not the route. The bad run (511 s against
    295-330 s) had a different reconstruction, likely ODM's own once-off; its task is gone, so nothing more to read.
    The user's own orthophotos are within their frames' range (the test flight's frames -45.4 to 65.0 °C with sky in
    the oblique views; its orthophoto -42.5 to 56.7 °C). Decided (the user): no warning for an orthophoto outside the
    frames' range; closed.
  - Done: **a link from a WebODM task to its thermal dataset** (the user, 2026-10-30), `task-dataset-link`: a
    **Thermal dataset** button in a task's expanded panel on the dashboard, through `PluginsAPI.Dashboard.
    addTaskActionButton` (the official hook; it adds to the action row only, not the details table or title, which
    would need a WebODM change). The dataset's own task is known by its hidden `.dji-thermal-dataset` tag, in the
    browser, with no request. Decided (the user): **tasks made from a workset (Create task) link back too**, through
    a hidden tag naming the dataset added when the task is made (kept by WebODM's Edit panel), opening it on
    Worksets; tasks made before have no tag and no button (fixed since, see below). Built: `public/main.js` (the button, a link styled as
    WebODM's own `btn btn-sm btn-primary`); `conversion_tasks.py` (`FROM_TAG` on `create`, `unlink_made` when the
    dataset goes: deleted, from the Analyzer or WebODM, through `datasets.task_removing`, or released). Also: the
    flight test's `skip_without` moved back from `parent_url`, where the parent-task branch had put it. Tests: Django
    113 with `app.tests.test_plugins`, Jest 125. Live check on :8002: the button on the user's dataset task and the
    check dataset's, on a task made from a workset (opens the dataset), none on ordinary tasks or tasks made before.
  - Done: **bug, tasks made from a workset before the tag had no Thermal dataset button** (the user, 2026-10-30),
    `link-older-tasks`: listing a workset's tasks (`conversion_tasks.made`, called by the Analyzer's datasets list
    and dataset page) now adds the tag to a task without it. Test: Django 118. Live check: opening the Analyzer
    tagged the test flight's task, whose panel now has the button.
  - Done: **viewer and header polish** (the user, `new.md`, 2026-10-30), `viewer-header-polish`:
    1. The viewer's **"As converted" tab becomes "Mosaic"** (as converted is what's expected); README to match.
    2. **Source frame shows the mosaic with lines between frames** instead of a random colour per frame: the
       as-converted temperatures in the temperature tabs' palette and range, with the seams (where the frame index
       changes between neighbouring pixels) drawn over them; the readout gives the temperature too. Decided (the
       user): the lines are black and white, a pixel each side of the seam, to show over any palette.
    3. On a dataset's page, **Copy link becomes a link icon beside the dataset's name**.
    4. **The gear only on the Thermal Analyzer's main page**: gone from the dataset's page (where it sits right of
       the dataset's buttons) and the viewer; README to match.
    Built: `public/viewer.js` (the tab's label; the source frames styled as a temperature tab, sharing its palette
    and range), `mosaics.py` (`seams`; the source-frame tile reads the temperatures and the frame index with a
    pixel's buffer, so seams on a tile's edge are drawn; the per-frame colours gone), `analyzer_api.py` (the tab has
    the temperatures' stats; `frame_colors` gone), `templates/` (the link icon in the dataset's heading, the gear
    only on the main page; the icon style `.ta-icon` shared), `public/dataset.js` (the icon ticks for 1.5 s once
    copied). Tests: Django 119 with `app.tests.test_plugins`, Jest 128. Live check on :8002 on the user's dataset
    (thumbnails blocked, nothing written): tabs Mosaic, Harmonized, Source frame, View angle; Source frame in DJI
    ironred with the lines; the link icon copies the link and ticks; the gear only on the main page.
  - Done: **the source frame in a window over the map** (the user, 2026-10-30), `source-frame-window`: on every
    viewer tab (Mosaic, Harmonized, Source frame, View angle), a picture-in-picture window showing the source frame
    for the place selected, in the palette and range the map shows, so the colours under its crosshair match the
    map's. Built on the mosaic sidecar's frame models (dji-thermal-cli's `FrameModels`, 1.5.0 on; a stripped
    conversion's located copy in `viewer/` keeps them) and its frame table (each frame's recorded measurement and
    offset). Decided (the user):
    - **A click selects a point** (a marker on the map); hovering still only updates the readout.
    - **Every frame that saw the point**, stepped through with arrows ("Frame 1 of 4 that saw this point"), the
      mosaic's own first, then by view angle; each with the crosshair on the same ground point.
    - **On View angle, the frame's view angles** (each pixel's angle from straight down, from its camera model) in
      that tab's palette and range; on the other tabs its temperatures, measured again with the parameters the
      mosaic recorded for it (and the workset's replacements): as converted on Mosaic and Source frame, the
      harmonized less the frame's offset on Harmonized.
    Also: the frame's footprint dashed on the map; the window at the map's lower left, closable, with the frame's
    name and view angle; a mosaic built without frame models says to build it again; nothing written to the dataset
    (frames measured in memory, the last 8 kept; the browser caches the images by the build time, as the tiles).
    Code: `mosaics.py` (`frames_at`, `frame_values`, `pixel_angles`, `frame_image`, `rendered` shared with the
    tiles), `analyzer_api.py` (`MosaicFrames`, `MosaicFrame`; the style and point parsing shared), `plugin.py`,
    `public/viewer.js` (`frameUrl`, `pipHtml`, `select`), `templates/viewer.html`, `analyzer.css`. Tests: Django 120
    with `app.tests.test_plugins` (the flight's frame at a mosaic pixel's centre equals the mosaic on all three
    kinds), Jest 130. Live check on :8002 on the user's dataset (nothing written): a click found 42 frames, the
    mosaic's own (0107) first in DJI ironred with the crosshair and footprint; next and back; Harmonized, Source frame
    and View angle each drew it in their own palette and range; closed.
  - Done: **user preferences** (the user, `new.md`, 2026-10-30), `user-preferences`: a **settings gear** beside the Thermal
    Analyzer's heading (the datasets page) opening the user's preferences: a **temperature unit** (°C, °F or K) used
    throughout the UI whatever unit an image or workset holds, and a **preferred DJI palette** used throughout the UI
    where it is available. Builds on: `analyzer_core.js`'s `userUnit()` (today °F with WebODM's imperial units,
    else °C; never K), used by the dataset, worksets and viewer pages; the Thermal task panel's own unit (°C/°F,
    `measurement.js` `defaultUnit`, the converter's `UNITS`; dji-thermal-cli also takes K); the viewer's
    `default_palette` (the workset's palette, else the frames', else inferno; DJI's palettes there are the ones the
    frames hold); the Worksets form's palette ("Each image's own" by default). Files-tab thumbnails are the frames'
    embedded previews, in the palette they were shot with. Decided (the user, 2026-10-30):
    - **Kept per WebODM user** on the server (the plugin's user data store), so they follow the user to any browser
      and reach the Thermal task panel; the pages read them, a small API saves them.
    - **The unit follows WebODM's units until one is picked** (°F with imperial, else °C, as today); the Thermal
      task panel offers K too (the converter's `UNITS`).
    - **The palette applies to the viewer's default** (temperature mosaics open in it when the frames hold it),
      **new worksets' palette** (the form starts with it instead of "Each image's own"), and **Files-tab
      thumbnails** (drawn from the temperatures in it, on the server, cached, instead of the embedded preview; slower
      on large datasets). No palette picked: everything as today.
    - **The gear opens a dialog** (Save / Cancel), on the datasets page beside the heading, and on the dataset and
      viewer pages too.
    Built: `conversions.py` (`display`, `parse_display`, `save_display`, key `display` beside the saved defaults),
    `analyzer_api.py` (`Display` at `display`; `Preferences` fills the palette; the viewer's and tiles'
    `default_palette` with the preferred one first; `palette_thumbnail`, cached in `thermal/thumbnails/<palette>/` by
    the file's path, size and time), `converter.py` (`palette_picture`: the frame's own LUT over its min..max; `UNITS`
    with K), `analyzer_pages.py` (the preferences in `#ta-display`), the templates (the gear), `analyzer_core.js`
    (`userUnit` from them, the dialog's selects, `editPreferences`, `bindPreferences`; the page reloads on Save),
    `dataset.js` (`?palette=` on thumbnails), the Thermal task panel (`display` read on open, K offered). Tests:
    Django 117 with `app.tests.test_plugins`, Jest 127. Live check on :8002, a dataset of its own (8 M4T frames, a
    workset with mosaics): the dialog saved K and ironred; K on the dataset page and viewer, thumbnails in ironred,
    the viewer opened in DJI ironred, new worksets' palette ironred, the Thermal task panel in K; the admin's
    preferences restored, the dataset removed.
  - Closed: WebODM answers 404 for a processed thermal task's dashboard thumbnail (`/thumbnail?size=164`,
    seen on the test flight's task and a check task). **WebODM's own, by
    design** (2026-10-30): `TaskThumbnail` (`app/api/tasks.py`) raises NotFound for an orthophoto with fewer than 3
    bands, and a °C orthophoto has one (and alpha); the dashboard's `TaskListItem` hides the thumbnail on error, so
    only the console shows the 404. Nothing for the plugin: the Dashboard hooks (`addTaskActionButton`,
    `addNewTaskPanelItem`, `addNewTaskButton`, `addImportTaskItem`, `presetDialogOptionsReady`) don't reach the
    thumbnail. A thumbnail would need WebODM to render a single band with a colour map (a WebODM change).
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
    section's caret drawn by the plugin (WebODM hid the browser's). Jest 122; live check on the test flight (read
    only): the tabs Worksets, Files, Problems, WebODM plan, opened on Worksets; no console error.
- **A palette in DJI Thermal Task** (the user, 2026-11-01, with a screenshot of the panel): "add a dropdown above
  the "Normalize:" checkbox that allows the user to select the color palette from the supported dji color palettes.
  If detectable, it should default to that of the source photos." Done 2026-11-01, `task-palette`. The task's TIFFs
  hold temperatures, so the palette is where its thermal map opens. Decided (the user): **the task's palette when the
  user has none** (Preferences' "Each image's own"); theirs wins once chosen. Server: `conversion_tasks.task_palette`
  / `set_task_palette` (`thermal/task.json`, beside the saved measurements), set by `TaskConvert` and `TaskWorkset`
  (also the workset's palette) and by a task made from a workset or a workset sent to the dataset's task (the
  workset's palette); `converter.describe` gives the photo's palette, `Describe` DJI's palettes; the Inspector's
  `measurements` GET gives `palette`. Panel: `ThermalTaskPanel.jsx` `renderPalette` (the photos' palette marked,
  else ironred), `measurement.js` `combineCameras`, `startPalette`. Inspector: `openInTaskPalette` (the topmost
  orthophoto's task, until the user chooses a palette on the page). README, `quickstart-thermal-task.md`, `api.md`;
  screenshot `thermal-task-panel` retaken. Tests: `measurement.test.js` (1), `inspector.test.js` (1), `test_api.py`
  (1 new, 2 extended), `test_analyzer.py`, `test_inspector.py`. Jest, ESLint, Ruff, Django 179 (1 skipped). Live
  (read only): 4 M4T photos, the Palette above Normalize on "ironred (the photos')"; ThermalTest's map, its
  measurements answer given palette arctic and the display none, opened in DJI arctic. Noticed: deleting a dataset
  kept in a task (`conversion_tasks.release`) removes the task's whole `thermal/` folder, its saved measurements and
  palette with it.
- **Faster image adjustments** (the user, 2026-11-01, from `new.md`): "can anything be done to improve the
  rendering response time of changes to the images sliders? How fast the tiles are rendered? etc.... Looking for it
  to be as seamless and realtime as possible without needing a webodm pr".
  - What it builds on, measured on the dev server (Django's runserver; the test flight): a plugin tile takes
    100–180 ms (WebODM's own 70–125 ms), a sharpened one 300–400 ms; a view's 12 tiles together about 0.9 s.
    Moving a slider only previews the boxes and legends; on release the layer's URL changes and Leaflet's
    `redraw()` drops every tile first, so the map goes blank until the new ones come. No tile is cached by the
    browser (no `Cache-Control`), so moving back to a value draws it again.
  - Two ways, not exclusive:
    - **Quicker server drawing**: new tiles drawn over the old ones, swapped when loaded (no blank); drawing while
      the slider moves (throttled); tiles cached by the browser; the raster's values kept in memory per tile so a
      recolour skips the read. Better, but each change still waits on a round of requests.
    - **Recoloured in the browser** (realtime): the plugin serves each tile's temperatures once (16-bit), and the
      browser colours them with the palette, range, brightness, contrast, gamma, Equalized (the server's curve) and
      the isotherm on every slider movement, with no requests. Sharpening needs neighbouring pixels: drawn by the
      server on release. On WebODM's orthophoto it replaces how that one layer's tiles are drawn (the layer kept,
      so WebODM's opacity, swipe and layer panel stay). Changes the earlier "drawn by the server, never in the
      browser" decision.
  - Decided (the user, 2026-11-01): **recoloured in the browser**, sharpening still drawn by the server; in **the
    Thermal Inspector and the Analyzer's mosaic viewer** alike; after the names and splash, before Part 2's step 5.
    Its design and steps are planned with the user before it is built.
  - Design (2026-11-01):
    - **Value tiles**: the server sends each tile's temperatures once instead of colours: a PNG holding 16-bit
      values quantized per tile (its offset and step in response headers, so 0.01 °C or finer over any camera's
      range), transparent where there is no data, with an 8-pixel margin all round (what the unsharp mask reads),
      and for Source frame a seam flag per pixel. It is read the way today's tiles are: bilinear for an orthophoto,
      nearest for a mosaic. It is cached by the browser (`Cache-Control`, the URL keyed by the raster's version),
      and the raster's pixel size comes in a header, for the sharpening's sigma. A histogram endpoint gives the
      equalization's histogram once per layer.
    - **`recolour.js`** (ES5, shared like `scale.js`): fetches a value tile, decodes it (`createImageBitmap` without
      colour conversion or premultiplied alpha), and colours it on a canvas exactly as `colouring.colour` does:
      palette, range, gamma, equalization (`colouring.equalization` ported), unsharp mask, the viewer's isotherm
      grey and seams. A Leaflet layer keeps each tile's values and recolours every tile on each change, with no
      requests. Jest compares its pixels with fixtures made by `colouring.py`.
    - **The mosaic viewer** (the Analyzer): its mosaic layer becomes that layer, so Image's sliders and the scale
      recolour while they move.
    - **The Thermal Inspector**: WebODM's thermal orthophoto layer keeps its layer (opacity, swipe and WebODM's
      layer panel unchanged), but its tiles are drawn by `recolour.js` (its `createTile` replaced on that layer)
      in every palette, WebODM's colour maps included. A range set in WebODM's layer panel recolours with no
      requests. The same applies to laid workset mosaics, the isotherm overlay (drawn from the same values) and
      the legends' curves (local).
    - Unchanged: the hover readout and regions (server), and the frames windows (server-drawn, redrawn after a
      change).
  - Decided (the user, 2026-11-01): **sharpening in the browser too** (every slider live), replacing "sharpening
    drawn by the server"; **the frames not in this phase**.
  - Steps: (1) `recolour-core`: value tile and histogram endpoints, `recolour.js` with its fixtures and tests;
    (2) `recolour-viewer`: the mosaic viewer; (3) `recolour-inspector`: the Thermal Inspector, README, docs and
    screenshots.
  - Step 1 built (2026-11-01), on `recolour-core`: `colouring.value_png`; `inspector.values_tile` and
    `mosaics.values_tile` (reading shared with `tile` by `_tile_values`); `inspector_api` `InspectorValues` (ETag
    from the orthophoto's version and the crop, `private, no-cache`), `InspectorHistogram`, `values_response`,
    `histogram_response`; `analyzer_api` `MosaicValues` (`max-age=86400`, the URL carrying the build time),
    `MosaicHistogram`; `api.md`. `public/recolour.js` (`decode`, `fetchValues`, `equalization`, `curveShares`,
    `drawnShares`, `colour` with the blur kept per range). Fixtures `public/__tests__/fixtures/colouring.json`, written
    by `tests/colouring_fixtures.py` and checked current by `test_analyzer`. `recolour.test.js` (15: all eight
    cases pixel for pixel), `test_inspector.py` (3), `test_analyzer.py` (2, and the flight's value tiles). Timed on
    the user's task in the container: a value tile 15 ms and 16 KB, a coloured tile 18 ms (34 sharpened) and 8 KB.
  - Step 2 built (2026-11-01), on `recolour-core`: `recolour.drawFromValues` (a Leaflet layer's `createTile` drawing
    canvases from value tiles, `recolour()` once a frame, an unloaded tile's request aborted) and `isothermRange`;
    `viewer.js`: the mosaic an `L.gridLayer` drawn from `valuesUrl`, `drawStyle`, the equalization from the tab's
    histogram (asked once), the sliders recolouring while they move (`recolour`), the frames window on release
    (`restyle`); `viewer.html` loads `recolour.js`. Found live: a tile read with a margin lands on a slightly shifted
    grid (rio-tiler aligns its grid to the read's corner), so `_tile_values` (both) now takes the tile's own pixels
    from a read without one (the server's sharpened tiles no longer shift either), and the seams' flags give the
    second side's colour where both are, as `tile` draws. README, `quickstart-worksets.md`; screenshot
    `mosaic-viewer` retaken. `analyzer.test.js` (viewer tests on the drawn style), `recolour.test.js` (1). Live, read
    only, on the user's workset: no requests while a slider moves, 5 brightness steps drawn in 160 ms, sharpening in
    75 ms; against the server's tiles with the same style, 15 of 35,546 pixels differ by at most 3 levels (6
    sharpened: the 16-bit codes), the source frames' 25 more on the tile's edge (seams found from a margin of 8, not 1).
  - Done (2026-11-01), all three steps on `recolour-core`; step 3: `inspector.js` draws WebODM's thermal orthophoto
    layer from value tiles (`watch` replaces its `createTile`, `valuesUrl` from its own tile's URL, `drawStyle`), in
    every palette; its look stays in the layer's URL, changed with `setUrl(url, true)` and recoloured
    (`restyleOrthophoto`), WebODM's layer panel's changes recoloured too; the laid mosaics (`mosaicValuesUrl`,
    `drawnFromValues`) and the isotherm overlays (`isothermStyle`, recolour.js's paint mode) likewise; the legend's
    and scale's curve from the layer's histogram (`histogramOf`, asked once); the Image sliders apply as they move
    (no preview), the frames window's picture on release (`sliding`). `recolour.js`: paint mode, canvases Leaflet
    1.3 drops while loading let go of. `plugin.py` loads `recolour.js` on the map. The server's coloured tiles,
    isotherms and curves stay in the API (`api.md`), no longer asked for by the pages. README, `quickstart-inspector.md`;
    screenshots `inspector-image`, `inspector-mosaics` retaken. `inspector.test.js` (updated, 1 new), `recolour.test.js`
    (1). Jest 224, ESLint, Ruff, Django 170 (1 skipped). Live, read only, on the user's task: WebODM's layer all
    canvases from 9 value tiles, no coloured tiles asked; no requests while a slider moves (5 brightness steps 159 ms,
    sharpening 188 ms on 512-pixel tiles); the isotherm painted with no requests; against the plugin's tiles at most
    7 levels apart on 0.2% of pixels, against WebODM's own magma at most 3; a laid mosaic from values, its tab's
    values asked on a change, zooming in and out with no errors.
- **The Thermal Inspector's top stays in view** (the user, 2026-11-01, from `new.md`): "in the Thermal Inspector,
  make the top section a header area that remains visible when you scroll down. This way the controls and
  temperature are always visible."
  - What it builds on (`inspector.js` `panelHtml`, `inspector.css`): the panel (on WebODM's 2D map, the toolbar's
    Inspector button) scrolls as a whole past 70% of the window's height (`max-height: 70vh; overflow-y: auto`).
    From the top: the heading (Thermal Inspector, its ×, dragged to move the panel), the mode buttons (Hover, Pin,
    the region shapes, Line) with the polygon/line hint and any notice, the readout (the temperature under the
    cursor), then Palette, the colour scale (its bar and range fields), "Legend on the map", Image, Mosaic Overlays,
    Isotherm, Manual Corrections, Pinned points, Regions and lines, Saved measurements. The whole panel is drawn
    again on each change (`panel.innerHTML`).
  - Proposed: one step, `inspector-header`: the heading, mode buttons, hints and readout in a header kept at the
    top of the panel while the rest scrolls under it (CSS `position: sticky`, a white background and a line under
    it); the panel's drag by its heading unchanged. README and `quickstart-inspector.md` if they describe it; a
    screenshot of the panel scrolled down.
  - Decided (the user, 2026-11-01): **also Palette and the colour scale** in the header; **before Faster image
    adjustments**.
  - Done (2026-11-01), `inspector-header`: `inspector.js` `panelHtml` (the heading, modes, hints, readout, Palette
    and the scale in `.dt-inspector-top`), `inspector.css` (sticky over the panel's padding, above the sections'
    buttons, a line under it); "Legend on the map", Image and the sections below scroll under it. README ("The
    panel's top stays in view"), `quickstart-inspector.md` section 2. Screenshots `inspector`, `inspector-line`,
    `inspector-image`, `inspector-saved`, `inspector-mosaics` retaken (read only; the first three and
    `inspector-saved` show the panel scrolled under its top). `inspector.test.js` (1). Jest 207, ESLint.
- **The Thermal Inspector's Mosaic Overlays and Manual Corrections** (the user, 2026-11-01, from `new.md`):
  - The requests: "in the Thermal Inspector, change "Workset mosaics" to "Mosaic Overlays". Also make sure it's only
    visible when any workset mosaics actually exist." "in the Thermal Inspector, change Correction to Manual
    Corrections. Place the checkbox directly next to it and remove the "Corrector for another...." description
    entirely. This way when someone wants to make manual corrections they can check the box which expands them.
    Unchecking returns to defaults and collapses the options again."
  - What it builds on (`inspector.js`): `mosaicsHtml` already returns nothing when the project has no mosaics, and
    the server lists only worksets whose mosaics are built (`inspector_api.map_mosaics`, a workset without a built
    Mosaic, Harmonized or Source frame raster is left out), so the section already shows only when one exists.
    `correctionHtml`: the heading "Correction", under it a tick box labelled "Correct for another emissivity and
    reflected temperature"; ticked, the emissivity and reflected fields, what each layer was measured with, and the
    "Approximate (a broadband model)…" line. Unticking keeps the values typed (`correctionInput`), so ticking again
    brings them back; the correction is kept in the browser per task (`saveCorrection`).
  - Proposed: one step, `inspector-names`: "Mosaic Overlays" for the section (its visibility unchanged; a test that
    it's absent without mosaics); "Manual Corrections" as the heading, with the tick box in it and no label;
    unticking forgets the values typed, so the next tick starts again from the topmost layer's own; the
    "Approximate…" line and the layers' measured-with lines kept. README, `quickstart-inspector.md` (sections 4 and
    7), screenshots `inspector-saved`, `inspector-mosaics` and any showing the panel's sections retaken.
  - Decided (the user, 2026-11-01): **before Faster image adjustments**.
  - Done (2026-11-01), `inspector-names`: `inspector.js` `mosaicsHtml` ("Mosaic Overlays"), `correctionHtml` (the
    tick box in the "Manual Corrections" heading, `.dt-inspector-heading` in `inspector.css`; its label gone),
    `correctionInput` (unticked, the correction is just `{on: false}`, so the browser's copy is removed and the next
    tick starts from the topmost layer's own values). README, `quickstart-inspector.md` sections 4 and 7 (its
    section 4 anchor, linked from `quickstart-worksets.md`). Screenshots `inspector`, `inspector-image`,
    `inspector-saved`, `inspector-mosaics` retaken (read only). `inspector.test.js` (2: Mosaic Overlays absent
    without mosaics; the heading, and unticking forgetting the values). Jest 206, ESLint.
- **Normalize and harmonize in DJI Thermal Task** (the user, 2026-11-01, with a screenshot of DJI Thermal Task's
  panel): "When creating a thermal task we should settings at the top that are disabled by default for normalizing
  and harmonizing, accompanied by a brief description of what they do."
  - What it builds on: dji-thermal-cli's normalization (`api.normalization`, a `Normalization` given to `process`)
    has two parts: one ambient and reflected temperature for every frame (the flight's medians of the recorded
    values, unless given), and each frame's offset against its overlapping neighbours removed (camera drift; frames
    the mosaic can't place get none). The Analyzer's workset setting **Normalize** applies both; its **Harmonized**
    mosaic is the one built with them. Both need every photo on the server before any is converted, while DJI
    Thermal Task converts each photo as it uploads (`api.py` `TaskConvert`). A workset's conversion runs in WebODM's
    worker with its progress, and **Use for parent task** puts a workset's TIFFs in the dataset's own task, which a
    DJI Thermal Task's task now is (`dataset-in-task`).
  - Proposed: at the top of the panel, **Normalize** and **Harmonize** (it needs Normalize), off. Off: as now. On:
    the photos go to the task's dataset first, a workset with these settings and the panel's measurement values is
    converted in the worker, and its TIFFs go into the task, which then starts processing, with the browser closed
    or not.
  - Decided (the user, 2026-11-01): **through a workset** (the photos in the task's dataset, "Also keep the photos"
    ticked and locked; the workset and its mosaics stay in the Analyzer); **the same two settings in the Workset
    Creation Settings**; **next, before the speed-up**.
  - Steps:
    1. `harmonize-setting`: worksets get `harmonize` beside `normalize` (`conversions.DEFAULTS`, `parse_settings`:
       Harmonize ticks Normalize; a record or saved defaults without `harmonize` read it as `normalize`, so the
       existing normalized worksets show both). Normalize alone: every frame measured with the flight's medians of
       the recorded ambient and reflected temperatures (read from the frames in the conversion job; a value typed
       in Measurement wins), `process(normalize=False)`; with Harmonize, `process(normalize=True)` as now. The
       summary chip "normalized" or "harmonized"; the WebODM plan's `--normalize` sets both. The Frames section of
       the Workset Creation Settings: the two tick boxes with a line each. Tests: `test_analyzer.py`,
       `analyzer.test.js`. Docs: `measurement.md` ("Normalize and harmonize"), `quickstart-worksets.md`, README.
       Done (2026-11-01): `conversions.py` (`harmonize` in `DEFAULTS` and `parse_settings`, `harmonized`,
       `api_arguments(s, medians)`, `flight_medians` from each frame's `describe`, `normalized_medians`; the job
       keeps the medians as the results' `normalization` with `offsets: False`), `mosaics.py` (the workset's medians),
       `conversion_tasks.checks` ("Not harmonized"), `conversions.js` (the two boxes framed together when off the
       plan, the chip, the plan's `--normalize`, "Normalizing…"/"Harmonizing…"), `dataset.js` (the finding's fix
       text). README, `measurement.md`, `quickstart-worksets.md`; screenshot `workset-settings` retaken.
       `test_analyzer.py` (4, one converting 3 frames of the M4T flight normalized alone), `analyzer.test.js` (1 new,
       5 changed).
    2. `thermal-task-normalize`: at the top of DJI Thermal Task's panel, **Normalize** and **Harmonize**, off, a
       line each. On: the task is created and made its own dataset, every photo (and the RGB ones) uploaded to the
       dataset, the GCP file and the text files sent with the workset's TIFF names (`_temp_c.tiff`), then
       `POST .../tasks/<t>/workset` makes a workset (°C TIFFs, the panel's measurement values, the two settings,
       mosaics) that, once converted, is sent to the task (`use_for_parent`) and the task committed with the panel's
       processing node; the mosaics are built after. The panel's message says the task processes once the workset
       is converted, with a link to the dataset. Tests: `upload.test.js`, `test_api.py`. Docs: the Thermal Task
       quickstart, README.
       Done (2026-11-01): `ThermalTaskPanel.jsx` (`renderFrames` after the photo count, Harmonize ticks Normalize,
       "Also keep the photos" ticked and locked), `upload.js` (`startWorkset`: the photos 10 per request to the
       dataset with their progress, the text files with `worksetTiffName`), `textFiles.js`, `serverApi.js`
       (`startWorkset`), `ThermalTaskButton.jsx` (the message); `api.py` `TaskWorkset` (a partial task that is a
       dataset with photos; °C TIFFs and mosaics, the panel's values, `then` with the task's node),
       `conversions.create(then=)` and `run` (`commit_parent` once converted, before the mosaics),
       `conversion_tasks.commit_parent` (the text files kept through `use_for_parent`, committed as WebODM's
       commit does; a failure is the task's error). README (step 2), `quickstart-thermal-task.md` section 2;
       screenshot `thermal-task-panel` retaken. `test_api.py` `TestTaskWorkset` (4, one converting 3 frames of the
       M4T flight end to end), `upload.test.js` (2), `textFiles.test.js` (1). Live (2 thermal and 1 RGB photo, a GCP
       file; the workset request intercepted): Harmonize ticked Normalize and locked the photos kept, the photos
       went to the dataset (no conversion requests), the request carried the settings, the message; the task and
       dataset removed after.
- **A dataset for a DJI Thermal Task's task** (the user, 2026-11-01, with a screenshot of a task's expanded panel
  on the Dashboard): "I created this thermal task using the DJI Thermal Task button. There needs to be a way to
  create and link a dataset in the thermal analyzer. I propose a button to create and link but navigates to the
  dataset in the thermal analyzer once linked."
  - What it builds on: DJI Thermal Task converts each photo on the server into the task's TIFF (`api.py`
    `TaskConvert`) and keeps no original. A dataset holds the original R-JPEGs (`datasets.IMAGE_EXTENSIONS`: JPEG
    only), so a dataset made for such a task starts empty. A task made from a workset already has the hidden tag
    `.dji-thermal-from-<dataset id>` (`conversion_tasks.FROM_TAG`), which gives its expanded panel the **Thermal
    dataset** button (`main.js`) and is removed when the dataset is deleted (`unlink_made`).
  - Proposed: on the expanded panel of a task whose images are the plugin's TIFFs and that has no dataset, a
    **Create thermal dataset** button: the server makes a dataset in the task's project, named after the task,
    gives the task the `.dji-thermal-from-` tag, and the browser opens the new dataset (empty: its **Add images** uploads
    the flight's photos). After that the panel shows **Thermal dataset**, as a workset's task does.
  - Decided (the user, 2026-11-01): **the button, and a tick box in DJI Thermal Task's panel** ("Also keep the
    photos in a DJI Thermal Analyzer dataset": the same upload fills a new linked dataset, no second upload);
    **next, before the speed-up**.
  - Steps:
    1. `task-dataset`: `POST .../projects/<p>/tasks/<t>/dataset` (`api.py` `TaskDataset`; change permission; not
       on a dataset's own task; over quota refused): the task's linked dataset if it has one, else a new one named
       after the task, the task tagged `.dji-thermal-from-<id>` (`conversion_tasks.link_dataset`). DJI Thermal
       Task's tasks get the hidden tag `.dji-thermal-task` when created. `main.js`: **Create thermal dataset** on
       the expanded panel of a task with that tag or a thermal orthophoto (older tasks) and no dataset; a click
       makes it and opens the dataset page. Tests: `test_api.py`, `main.test.js`.
       Done (2026-11-01): as above (`conversion_tasks.linked_dataset`, `link_dataset`; `main.js`
       `DjiThermalTaskDataset`; `upload.js` `THERMAL_TASK_TAG`); README, `quickstart-thermal-task.md` section 5,
       `api.md`; no screenshot (a task's panel shows its CRS). `test_api.py` `TestTaskDataset` (5), `main.test.js`
       (3), `upload.test.js`. Live on the user's ThermalTest (its thermal orthophoto, no tag): the button shown,
       a click made the dataset and opened it, the panel then had Thermal dataset; the dataset deleted after, the
       task's tags back to none.
    2. `keep-photos`: the tick box in DJI Thermal Task's panel. With it, the upload links a dataset to the new
       task first (step 1's call), each photo's conversion request also saves the photo (thermal or not, any JPEG)
       in that dataset (`TaskConvert`, only into the task's own linked dataset), and the dataset's analysis starts
       once the task is committed; a failed upload removes the dataset with the task. The result names the dataset
       with a link. Tests: `upload.test.js`, `test_api.py`.
       Done (2026-11-01): `ThermalTaskPanel.jsx` (the tick box, off by default; the photos not converted, RGB or
       another camera's, as `otherPhotos`), `upload.js` (`taskDataset`, `dataset` sent with each conversion,
       `uploadOtherPhotos` 10 per request, `analyzeDataset` after the commit, `removeDataset` with the task),
       `serverApi.js`, `ThermalTaskButton.jsx` (the result's link), `api.py` `keep_in_dataset`, `DatasetAnalyze`
       counts the dataset's size first. README, `quickstart-thermal-task.md` sections 2 and 5; screenshot
       `thermal-task-panel` retaken. `upload.test.js` (4), `test_api.py` (2). Live (3 thermal and 2 RGB photos of the
       M4T flight, WebODM's commit intercepted so nothing processed): the task tagged and linked, the result's link,
       the dataset with the photos (10 MB) and analyzing; the dataset and the task removed after.
- **Ready to be public** (the user, 2026-11-01, from `new.md`): "this repo will be made public soon, be sure to
  scan anything checked in that might be considered personal or secret."
  - The scan (2026-11-01), of the 121 tracked files and every commit on every branch (225; 222 pushed):
    - No secret: no key, token, password (but the tests' own `test1234` users), `.env`, private path or address;
      commits carry only GitHub's noreply address. No DJI file or flight image, now or ever (the only file ever
      removed is `exiftool_camera.config`). No PNG holds text or EXIF chunks. No mention of the earlier port's
      source.
    - `webodm-thermal-analyzer-ui.png` at the repo root, committed by mistake with the Inspector image step
      (98f4abc, pushed): the user's uncropped splash, with Google's map credit (no coordinates or place). A
      duplicate of `docs/images/splash-source.png`.
    - Test fixtures at real-looking places: `inspector.test.js`'s points, `textFiles.test.js`'s GCPs and `test_converter.py`'s GPS (history
      only, removed 2026-10-31); `main.test.js` used the dev dataset's id.
    - `upcoming-changes.md`: the user's dataset name (about 30 times), two paths in the user's home folder, the
      native Windows install's checks, and the user's words quoted.
  - Decided (the user, 2026-11-01): **`upcoming-changes.md` kept, the dataset's name and the home paths scrubbed**
    ("the test flight", "its own repository"); **the history left as it is** (nothing in it is secret; no
    force-push).
  - Done (2026-11-01), `public-scan`: the root image removed; `inspector.test.js`'s points and `textFiles.test.js`'s GCPs moved to a made-up place
    in the sea (0.5 N, 0.5 E, the same distances between them), `main.test.js` a made-up dataset id; the plan
    scrubbed. Jest 192, ESLint.
- **Names and the splash image** (the user, 2026-11-01, from `new.md`):
  - The requests: "make webodm-thermal-analyzer-ui.png the splash image for the readme and docs. Resize a copy if
    needed and check in the source image and any copies to an appropriate location." "Rename the Thermal Analyzer
    tab to be the Dji Thermal Analyzer. Same for the title on the main ui page." "Rename "Thermal Task" button to
    "Dji Thermal Task"."
  - What it builds on: the image (untracked, at the repo root) is 2185×1930, 2.8 MB: a task's map with the
    Thermal Inspector open, from before the colour scale and Image section; its sidebar says "Thermal Analyzer";
    its corner credits "Map data: © Google Maps" (a basemap was loaded under the orthophoto, which the
    screenshots' rule leaves out). The names: WebODM's sidebar entry (`plugin.py` `main_menu`), the landing page's
    heading and the dataset page's breadcrumb (`templates/`), the pages' titles (`dataset.js`), the Dashboard's
    button (`ThermalTaskButton.jsx`, built), links and hints that name them (`ThermalTaskPanel.jsx`,
    `datasets.js`, `main.js`), and README and docs (about 25 and 25 mentions); screenshots showing the sidebar or
    the button are retaken.
  - Proposed: one step, `names-splash`. The image in `docs/images/` (the source, and a copy about 1200 px wide
    shown at the top of README and `docs/index.md`, linking to the source).
  - Decided (the user, 2026-11-01): **"DJI Thermal Analyzer" and "DJI Thermal Task"**; **the user's image, the
    map credit cropped off** (it keeps the earlier panel and name). First of the new phases, before the speed-up
    and Part 2's step 5.
  - Done (2026-11-01), `names-splash`: "DJI Thermal Analyzer" in WebODM's sidebar (`plugin.py`), the landing
    page's heading and title (`analyzer_pages.py`, `datasets.html`), the dataset page's breadcrumb and title
    (`dataset.html`, `dataset.js`), and "DJI Thermal Task" on the Dashboard's button (`ThermalTaskButton.jsx`,
    rebuilt), in the links and hints naming them, the manifest's description, README and docs. The image cropped
    of its bottom 28 px (the map credit): `docs/images/splash-source.png` (2185×1902) and `splash.png` (1200 px,
    256 colours, 414 KB) at the top of README and `docs/index.md`, linking to the source; `CLAUDE.md` and the
    `docs` skill say it isn't made by `dev/screenshots.js`. Jest 192, Django 148 (1 skipped), ESLint, Ruff;
    screenshots showing the sidebar or the button retaken and looked at (`thermal-task-button`,
    `thermal-task-panel`, `analyzer-list`, `dataset`, `dataset-files`, `picture-viewer`, `mosaic-viewer`,
    `mosaic-frames`, `dji-sdk` and the six `inspector*`).
- **The colour scale and the Image section in the Thermal Inspector** (the user, 2026-11-01, with a screenshot of
  the mosaic viewer's panel):
  - The request: "Let's move the color palette into the Thermal Inspector control along with copying the Image
    section and functionality we use in the mosaics viewer." The screenshot shows the Analyzer's mosaic viewer
    panel: Palette, the colour scale, the range boxes ("49.2 to 125.4 °F", Auto), "This mosaic: -49.2 to 133.6 °F",
    and the Image section (Brightness, Contrast, Gamma, Sharpening, Linear/Equalized, Reset).
  - What it builds on:
    - The Inspector panel has Palette (applied to every thermal layer) and the "Legend on the map" tickbox. The
      range is read from the layer: an orthophoto's `rescale`, set in WebODM's own layer panel; a mosaic's,
      `mosaicRange` (its 2nd to 98th percentile).
    - The mosaic viewer (`viewer.js`): `controlsHtml`/`imageHtml`, `slidRange` and `sliderPositions` (brightness
      and contrast move and narrow the range around Auto), `SLIDERS`, `adjustQuery`. Its tiles and frame pictures
      are drawn by the server with `gamma`, `equalize=1` and `sharpen` (`colouring.parse_adjust`, `colour`,
      `mosaics` equalization from the mosaic's histogram, `tile_buffer` margins for sharpening).
    - The orthophoto: drawn by WebODM's tiler (a colour map and `rescale` only), or by the plugin's
      `inspector/tiles` for DJI's palettes (`inspector.tile`: a colour table over low..high, no adjustments).
  - Decided (the user, 2026-11-01):
    - **The panel gets the scale and range**, under Palette: the colour scale (as the legend's), the range boxes in
      the user's unit, Auto, and the layer's own lowest and highest temperatures. **The map's legend stays**, with
      its tickbox.
    - **They act on the topmost thermal layer shown** (the one the legend reads); **each layer keeps its own** range
      and adjustments.
    - **Nothing is remembered**, as the mosaic viewer: each visit starts from the layer's own range and no
      adjustments.
    - **The range stays in step with WebODM's layer panel** both ways, as the palette does.
  - Proposed build, one step (`inspector-image`):
    - Server: `inspector/tiles` draws the orthophoto in any palette (DJI's, or WebODM's colour maps by their
      encoded colours) with `gamma`, `equalize=1` and `sharpen` through `colouring.colour`, sharpening with a
      margin; the equalization from the orthophoto's histogram, worked out once and kept in the task's `thermal/`
      folder (by the orthophoto's time). An unadjusted orthophoto in one of WebODM's colour maps stays on WebODM's
      tiles, so WebODM's layer panel keeps working as now.
    - Browser: the panel's scale, range boxes and Auto (an orthophoto's Auto from the 2nd and 98th percentiles in
      WebODM's tile metadata), and the Image section from `viewer.js`, shared rather than copied. A mosaic's
      adjustments go in its tile and frame URLs; an orthophoto's, in the plugin's tile URL. The frames window's
      pictures are drawn with the layer's adjustments.
    - Tests (Django: the tile with each adjustment, the histogram kept; Jest: the panel, ranges in step with
      WebODM's URL, per-layer state), live check, README, quickstart section 3, screenshots.
  - Done (2026-11-01), `inspector-image`:
    - Server: `inspector.tile` draws through `colouring.colour` in any palette's encoded colours
      (`inspector_api.palette_colors`: DJI's or WebODM's colour maps), with gamma, equalize (the orthophoto's
      histogram, `inspector.histogram`: read at most 4,096 pixels a side, kept as `thermal/histogram.json` by
      `colouring.kept_histogram`) and sharpen (`_raster_tile`'s `buffer`, sigma from the orthophoto's pixel and the
      tile's); `inspector/curve` gives the legend's shares.
    - `scale.js`: the Image section's maths and controls moved from `viewer.js` (`SLIDERS`, `slidRange`,
      `sliderPositions`, `sliderGamma`, `adjustQuery`, `toneShares`, `adjustShares`, `imageControlsHtml`), used
      by both. `inspector.js`: `scaleHtml` and `imageHtml` under Palette (the scale, range boxes in the user's
      unit, corrected with the correction, Auto, "This layer", then the Legend tickbox and Image); the topmost
      layer's look (`lookOf`, a preview while a slider moves, drawn on release: `setLook`); an orthophoto's range
      and adjustments live in its tile URL (`withPalette(url, name, display, adjust)`: the plugin's tiles in DJI's
      palettes or adjusted, WebODM's otherwise; `adjustOf`, `withRange`), a mosaic's in `laidMosaic`'s `adjust`
      and `auto` (`mosaicQuery`, so its frames too); an orthophoto's Auto from WebODM's tile metadata's
      percentiles (`autoRange`); the legends follow the tone curve (`barHtml`, the server's curve when
      equalized). WebODM's layer panel: a range set there is the layer's; its own range sent again with a colour
      map doesn't undo the Inspector's (`__dtPanelRange`); the panel's histogram fields only show a range set in
      the Inspector after a reload (a plugin can't reach them).
    - Tests: Django 148 (1 skipped; the tile in WebODM's colour maps, with gamma, equalized with its histogram
      kept, sharpened; the curve); Jest 192 (URLs, Auto, the panel's range typed and Auto, sliders previewed then
      drawn, equalized with the curve and Reset, in step with WebODM's panel, per-layer state with a mosaic and
      its frames). Mutation checks (WebODM's panel's resent range undoing the Inspector's, a mosaic's adjustments
      left out of its query) fail them. Live on the test flight (no writes, no console errors): Auto, contrast,
      Equalized (the curve asked), gamma and sharpening reach the tiles; the frame picture drawn with the
      orthophoto's gamma; the laid mosaic with its own range and gamma; the mosaic viewer's gamma unchanged. The
      histogram the check made in the task's folder removed. README, quickstart section 3, `palettes.md`,
      `api.md`; screenshots: `inspector-image` (new), `inspector`, `inspector-line`, `inspector-frames`,
      `inspector-mosaics` retaken (`inspector-saved` retaken, unchanged).
- **The Thermal Inspector's panel and legend: movable, the legend's ends labelled** (the user, 2026-11-01, from
  `new.md`):
  - The request: "Thermal Inspector should always open in the same location but the form should be draggable to
    move around within the webodm viewer allowing for it to be moved out of the way. Same for the thermal
    palette/scale control." And: "The temperature palette/scale ui control needs to show the minimum/maximum
    temperatures at their respective ranges of the scale. Example: an image has a temperature range of 55F-105F,
    I expect the beginning of the scale to say 55 and the end of the scale to say 105, with in between values along
    the gradient."
  - What it builds on: on WebODM's map, the Inspector's panel (`.dt-inspector-panel`) opens left of its toolbar
    button, top right, in the same Leaflet control as the source frames window (`.dt-inspector-frames`, left of the
    panel). The legend (`.dt-legend`) is its own control, top left, shown by the panel's "Legend" tickbox. Nothing
    in the plugin is dragged today.
  - The legend today (`inspector.js` `legendHtml`; the mosaic viewer's own, `viewer.js` `legendHtml`) marks only
    round values inside the range (`scale.js` `scaleTicks`), so its ends are unlabelled unless the range starts or
    ends on a round value. Its range is the layer's colour range: a WebODM orthophoto's `rescale` (what WebODM's
    layer settings chose, by default from the orthophoto's statistics, not always its own lowest and highest
    temperatures); a mosaic's, the range of its palette.
  - Proposed: one step, `inspector-move`. The panel dragged by its heading, the legend by any part of it, both
    kept inside the map. The ends of both legends labelled with the range's own values, with round values between
    them (one that would crowd an end left out).
  - Decided (the user, 2026-11-01):
    - It comes **before Part 2's step 5**.
    - **The legend's ends show the colour range's own values**, with round values between them. When the image's
      own lowest or highest temperature lies outside that range, a line under the bar gives them ("Image: 41–118
      °F").
    - **A moved panel or legend goes back to its place** when the panel is closed and opened again, the legend
      hidden and shown again, or the page reloaded; nothing is remembered.
    - **The source frames window moves with the panel**, beside it, on the other side when there is no room.
  - Done (2026-11-01), `inspector-move`:
    - `scale.js` `rangeTicks`: the ends with the range's own values (to the round values' decimals, a tenth when
      that would round them), round values between that are more than 18% of the bar from an end; used by both
      legends (`inspector.js` `legendHtml`, `viewer.js` `legendHtml`).
    - `inspector.js`: `layerExtent` (WebODM's tile metadata's statistics for an orthophoto, the tab's stats for a
      mosaic: `laidMosaic`'s `extent`) and `extentHtml` ("Image: low–high", corrected with the correction).
      `movable` (pointer events, a CSS translate kept inside the map, re-fitted after a redraw or the map's
      resize; the box grabbed last raises its Leaflet corner over WebODM's other controls); the panel by its
      heading (not its links), the legend anywhere; `placeFrames` moves the frames window with the panel and puts
      it on the panel's right when only that side has room. Reset on close, on the legend's tickbox, on reload.
    - Tests: Jest 185 (`rangeTicks`, the image line, `movable`, the panel with the frames window, the legend; four
      tests' expected ticks updated). Mutation checks (no reset on close, the frames not following, no end
      labels) fail them. Live (read only, no writes, no console errors): both dragged inside the map without
      panning it, the frames window flipped right at the map's left edge, both back after close/hide; legends
      "9.9 20 30 40 51.5 / Image: -42.5–56.6 °C", the mosaic viewer "9.5 20 30 40 51.9". README, quickstart
      section 3; screenshots retaken: `inspector`, `inspector-line`, `inspector-saved`, `inspector-frames`,
      `inspector-mosaics`, `mosaic-viewer`, `mosaic-frames`.
- **Thermal Analyzer, part 2** (the user, 2026-11-01; details under "Done: Thermal Analyzer, part 2" below):
  the workset mosaics laid on WebODM's 2D map from the Thermal Inspector (for comparing with any task's layers), the
  source frames window, measuring tools and saved measurements there, and the frame page. In five steps; steps 1
  (the mosaics on the map), 2 (the source frames window), 3 (measuring: lines, surroundings, ΔT), 4 (saved
  measurements, the emissivity correction) and 5 (the frame page) done 2026-11-01. Done.
- **The mosaic viewer's image controls** (the user, 2026-10-31, from a screenshot of dji-thermal-ui's viewer panel:
  "How much of this can be built into the mosaic/harmonized/source frame viewers?"; details under "Done: The
  mosaic viewer's image controls" below): the frame pixel under the cursor, brightness, contrast, gamma,
  sharpening, Linear/Equalized, an isotherm, and a click keeping the readout with "Follow the cursor". Done
  (2026-11-01), in four steps.
- **Documentation** (the user, 2026-10-31, from `new.md`; details under "Done: Documentation" below): the docs
  hosted from this GitHub repo, with quickstart tutorials and screenshots, kept current with every feature change.
  Done; GitHub Pages is turned on by the user once the repo is public.
- **UX review** (the user, 2026-10-31, from `new.md`: "how would you make this ui more intuitive?"; details under
  "Done: UX review" below): a review of every page and control the plugin adds, proposals for the user to choose
  from, then the chosen ones built. Done: the review, all 13 proposals in six steps, and a bug it found.
- **Picture viewer in the Files view** (the user, 2026-10-31, from `new.md`; details under "Done: Picture
  viewer" below): clicking the picture in the Files view's detail pane opens it in a window on the page, with a
  close button and basic controls, instead of a new tab. Done.
- **Linux, Windows and macOS** (the user, 2026-10-31, from `new.md`; details under "Done: Linux, Windows and
  macOS" below): the plugin works on every way WebODM is installed: Docker on all three systems (the macOS
  installer runs Docker), and the native Windows installer, checked end to end there. Done.
- **Thermal Inspector** (the user, 2026-10-30): the earlier Pixel Inspector ported as a control on WebODM's 2D map,
  for thermal orthophotos, with the palette and unit shared with the Analyzer; in five steps (details under
  "Up next: Thermal Inspector" below). Lands in 1.0.0 if that is not published first, else in 1.1.0. Steps 2–5
  and 3b done (the last, isotherms and the legend, 2026-10-31), and dji-thermal-cli 1.10.0 pinned with the fallback
  to its internal tables dropped (2026-10-31, `pin-cli-1.10.0`). Done.
- **Release 1.1.0** — 2026-11-05, `release/1.1.0` (the user: "prepare the plugin for release"): WebODM 4.0.0
  support beside 3.3.2; manifest 1.1.0, `CHANGELOG.md`. Tests: Ruff, ESLint, Jest 281, Django 208 with
  `app.tests.test_plugins` on 4.0.0 and 3.3.2. Release check: `dist/dji-thermal-1.1.0.zip` (`public/build` built
  against 4.0.0) installed through Administration > Plugins on three WebODMs, pip installing each one's numpy and
  Pillow (4.0.0: 2.5.4 and 13.0.0; 3.3.2: 1.26.2 and 11.3.0), no webpack; on each, the M4T flight's 40 thermal
  frames (3 RGB ignored): a dataset analyzed, a workset with mosaics, the viewer, a frame's region, a task from the
  workset processed and measured in the Inspector, and a DJI Thermal Task processed. Docker 4.0.0: 812 s and 200 s
  (10.2 to 31.4 °C); Docker 3.3.2 (the 4.0.0-built scripts work there): 632 s and 201 s; native Windows 4.0.0: 604 s
  and 196 s, the plugin then removed without a restart. No console errors; each check's project deleted, the
  installed copies removed, the mounted copy back. The user tags `v1.1.0`, attaches the zip and updates
  WebODM-Plugins' `directory.json`.
- **Release 1.0.0** — 2026-10-30, `release/1.0.0` (details below); redone 2026-11-02 and published (tag `v1.0.0`).
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
- **dji-thermal-cli 1.7.0 for Python 3.9** — 2026-10-29, in its own repository: branch
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

## Done: Thermal Analyzer, part 2

**The request** (the user, 2026-11-01): the phase after the mosaic viewer's image controls; port as much of
dji-thermal-ui's code as sensible (its `thermal_measure.py`, `frontend/src/measure/`, `frontend/src/frame/`), as the
last phase did with its colouring.

**Decided** (the user, 2026-11-01):
- **Built**: the measuring tools, saved measurements, the frame page, and the mosaics as layers on WebODM's own 2D
  map for comparing (not dji-thermal-ui's Compare page).
- **The Thermal Inspector is where the work happens** (the user: "It makes sense for this to exist in the Thermal
  Inspector since that's the view where this work will take place"): the workset mosaics are laid on WebODM's map
  from the Inspector's panel, never as entries in WebODM's Layers panel (the user: "which is ok"; found in WebODM
  3.3.2: that list is the map component's React state, with no hook to add to it; the hook passes the component
  (`mapView`), but filling its state means faking WebODM's internal layer metadata for a task with no orthophoto,
  undocumented and broken by the next change to `Map.jsx`). What a plugin has: the Leaflet map from
  `Map.willAddControls` (the Inspector already draws its tiles on it) and `PluginsAPI.Map.sideBySideChanged(layer,
  side)`, the public function WebODM's Layers panel calls, which puts a layer on the right of WebODM's split
  control, so a mosaic can be swiped against any task's orthophoto or surface model.
- **When the Inspector appears**: as now (a task on the map has a thermal orthophoto), and also when the map's
  project has a workset with mosaics, so they can be laid over an RGB task's orthophoto (the button added, shown
  once the plugin has answered).
- **Comparing within the same project**: the mosaics of any workset in any dataset of the map's project.
- **The source frames window in the Inspector** (the user: "hover/select, drop a pin etc... and a popout with the
  source frames that viewed the image appears on the right"), as in the mosaic viewer: on workset mosaics, and on
  WebODM thermal orthophotos made from a workset whose mosaics are built, with that workset's camera models
  (from GPS and gimbal, not ODM's refined cameras, so the frame pixel can be slightly off there).
- **Measuring in the Inspector**, on WebODM's thermal orthophotos and the workset mosaics alike (it already has
  pins and regions); the Analyzer's mosaic viewer page keeps what it has (readout, frames window, Image, Isotherm)
  and links to the map.
- **A workset's link to the map opens the project's map** (`/map/project/<id>/`; a holder task has no map), with
  the Inspector open and that workset's mosaic laid on it.
- **The frame page is a page of its own**, as dji-thermal-ui's: a frame list beside it, the panel with Image,
  Isotherm, Measure and the changed parameters; opened from the frames window ("Open this frame", dropped from the
  last phase, comes back), in the mosaic viewer and the Inspector, and from the Files tab's detail pane (its kept
  `view.frames` hook), with its own URL.
- **Saving, renaming and deleting measurements** is for those who can change the project, as with worksets; those
  who can only view it see the saved measurements and can still measure without saving.

**Design** (Claude's, to check while building):
1. **Workset mosaics in the Inspector**: `GET projects/<project>/inspector/mosaics` (the project's worksets with
   mosaics, by dataset, for those who can view it); the panel lists them, a tickbox lays a tab (Mosaic, Harmonized,
   Source frame, View angle) on the map with the existing mosaic tiles in the Inspector's palette and range,
   opacity, and "Swipe" (`sideBySideChanged`); hover and pins read the topmost thermal layer, a mosaic or an
   orthophoto. `main.js` creates the control on every map and shows its button when `hasThermal` or the project
   has mosaics. The workset's "Open on the map" link. Not on WebODM's public maps (the plugin's API needs a login).
   **Done** (2026-11-01, `inspector-mosaics`): `inspector_api.py` (`InspectorMosaics`, `map_mosaics`,
   `InspectorProjectPalette`; `region_request`, `isotherm_request`, `palette_response` shared), `inspector.py`
   (`raster_region`, `raster_isotherm`: any raster, a mosaic's unit and no-data marker, nearest pixel as its tiles),
   `analyzer_api.py` (`MosaicRegion`, `MosaicIsotherm`, `has_map` and a workset's `project` / `project_map`),
   `inspector.js` (a mosaic is a thermal layer: `laidMosaic`, `mosaicTileUrl`, `paletteKey`, the panel's Workset
   mosaics; each isotherm overlay mirrors its layer's clip, `mirrorClip`), `main.js` (the Inspector on every map),
   `conversions.js` and `viewer.js` / `viewer.html` (Open on WebODM's map). Found: WebODM shows a project's map only
   when one of its tasks finished with an orthophoto or elevation model (`Project.get_map_items`; otherwise "A map is
   not available", no plugin runs), so the link shows only then; WebODM's divider clips one layer on its right, so
   an isotherm copies its layer's clip (this also fixes an orthophoto swiped from WebODM's panel). Laid mosaics are
   not remembered between visits. Tests (the user, 2026-11-01: meaningful tests need no asking now):
   `inspector.test.js` (the button, laying, hover in °C, a region, tab, opacity, Swipe, the clipped isotherm, a
   link, the helpers), `main.test.js` (changed: every map), `analyzer.test.js` (the map link), `test_inspector.py`
   (a °F mosaic's region and isotherm), `test_analyzer.py` (the list, its 404s, region, isotherm, refusals). Jest 170,
   Django 135 (1 skipped), ESLint, Ruff; live on the test flight (project 1's map): laid by the link, hover, the
   legend, Harmonized, opacity, Swipe against WebODM's thermal orthophoto, the isotherm (clipped), a region, a pin,
   lifted; a scratch project without a map (made and deleted). Docs: the Inspector quickstart's section 4, the
   worksets quickstart, `api.md`, README; screenshots `inspector` retaken, `inspector-mosaics` new.
2. **The source frames window in the Inspector**: `viewer.js`'s frames window shared (moved to a script both
   load), on a click or a pin; on an ODM orthophoto from the workset its task records (`conversions/<id>/tasks.json`).
   **Done** (2026-11-01, `inspector-frames`): `frames.js` / `frames.css` (the window, `framesUrl`, `frameUrl`,
   `orthophotoFrames`), loaded by the mosaic viewer and the map (`plugin.py`, `main.js`, `viewer.html`); `inspector.js`
   (`framesSource`: a mosaic's own frames, or for an orthophoto the workset whose TIFFs its task processed, drawn in
   the layer's palette and range converted to the mosaic's unit; the window beside the panel, the point and the
   frame's outline on the map, redrawn with the palette, asked again on a mosaic's other tab, closed with its layer or
   the Inspector); `conversion_tasks.holding` (the tasks made from a workset, and the dataset's own while the workset
   was the last sent there) listed as each mosaic's `tasks` by `map_mosaics`. A click in Hover on a layer with frames
   is the Inspector's (else WebODM's popup, as before); a pin, and a pin's name in the panel, open them too. On an
   orthophoto none is the pixel's own (ODM blends), so they are by view angle, and the window says the point is placed
   from GPS and gimbal. Tests: `inspector.test.js` (a mosaic's frames: the click, the URL, next, the palette, another
   tab keeping the frame, closed, lifted; an orthophoto's: by view angle, its palette and range in °F, a pin; an
   orthophoto from elsewhere left to WebODM), `main.test.js` (changed: frames.css), `test_analyzer.py` (`holding`;
   the list's `tasks`). Jest 173, Django 137 (1 skipped), ESLint, Ruff; live on project 1: the test flight's task
   (from workset `324fe5774f35`, 49 frames at the point, by view angle, next, inferno), its mosaic laid by the link (61
   frames, the mosaic's own first, Harmonized), the mosaic viewer's window unchanged; no console errors (the palette
   put back to ironred after). Docs: the Inspector quickstart's section 5, README, `index.md`, `api.md`; screenshot
   `inspector-frames` new.
3. **Measuring tools**: dji-thermal-ui's tools (Spot, Line, Area, Box, Circle: `measure.ts`, `drawing.ts`) beside
   the Inspector's pins and regions, from its `thermal_measure.py` (`check_geometry`, `region_stats`,
   `profile_points`, `mosaic_measure`): statistics and histogram, where the extremes are, the surroundings and ΔT,
   the isotherm's share, a line's profile (with each sample's frame on a mosaic); its result panel and charts
   (`result.tsx`, `charts.tsx`) in plain JavaScript. The Inspector's region endpoint and this share one module.
   Decided (the user, 2026-11-01): the Inspector's own toolbar is extended rather than a second one added (it already
   had Pin, Rectangle, Circle, Polygon, statistics, histogram and the extremes marked): a Line tool, and every
   region's surroundings, ΔT and isotherm share; pins stay one pixel's temperature (no disc, surroundings or ΔT).
   **Done** (2026-11-01, `inspector-measure`): `inspector.py` (`raster_region` takes a line: a strip
   `LINE_HALF_WIDTH` 0.25 m either side, its `length` and `_profile` every pixel up to 1,000 samples, on a mosaic each
   sample's source frame; every region's `surroundings` (a ring from its outline out to its size, 1 to 3 m; a band 1 m
   beside a line) and `delta_t`, and `isotherm_share` when asked; GEOS, as WebODM has no shapely), `inspector_api.py`
   (`region_request`'s `isotherm`, `region_isotherm`), `analyzer_api.py` (`MosaicRegion` passes the source frame
   band), `regions.js` (a line: clicks, double-click or Enter, `lineGeometry`), `inspector.js` (Line mode, L1…
   numbered apart from R1…, the rows, `profileHtml` with hover marking the point on the map and a click opening its
   frames, the line labelled at its start, the isotherm's limits sent and the shown region measured again when they
   change, `profileCsv`, the regions CSV's new columns), `inspector.css`. Tests: `test_inspector.py` (a line's
   profile and length, a sample without data, a one-point line refused; surroundings and ΔT of a hot square and of a
   line along a hot band; the isotherm share, refused limits), `test_analyzer.py` (a mosaic line's frames),
   `inspector.test.js` (changed: the CSV's columns and the new rows; new: a line drawn, its profile hovered, its CSV,
   L/R numbering; the isotherm share measured again). Jest 175, Django 140 (1 skipped), ESLint, Ruff; the isotherm
   share's test seen failing with the upper limit ignored. Live on project 1 (read only): the test flight's
   orthophoto (a line: 13.1 m, surroundings and ΔT, the profile hovered and clicked to the frames window; a rectangle
   with the isotherm Above: 19.3 %) and its workset's mosaic (a line, each sample's frame named); no console errors.
   Docs: README, `index.md`, the Inspector quickstart's section 2, `api.md`; screenshots `inspector` retaken (the
   shot now closes the frames window its pin opens), `inspector-line` new.
4. **Saved measurements**: named, with a comment, kept with what they measure (a workset's
   `viewer/measurements.json`, a task's `thermal/measurements.json`, replaced atomically), listed in the panel,
   renamed and deleted, exported as CSV and GeoJSON; the approximate emissivity / reflected-temperature correction
   (`mosaic_correction`). The Inspector's own pins and regions stay in the browser as now.
   Decided (the user, 2026-11-01): each region, line and pin row of the Thermal Inspector's panel gets a Save
   action (a name and an optional comment); the saved ones are a "Saved measurements" section every viewer of the
   project sees, renamed, commented, deleted and exported (CSV, GeoJSON) by those who can change it; unsaved drawings
   stay in the browser. The correction (emissivity, reflected temperature) is a Correction section of the panel, kept
   in the viewer's browser like the palette: it changes the numbers (readout, pins, regions, lines, the legend's
   labels, the isotherm's limits), not the map's colours; a saved measurement records the correction it was
   measured with.
   **Done** (2026-11-01, `inspector-saved`): `measurements.py` (the lists, replaced under the folder's lock: a task's
   `thermal/measurements.json`, a workset's `viewer/measurements.json`), `correction.py` (dji-thermal-ui's broadband
   model, transmission 1; a layer's baseline: the median of what an orthophoto's TIFFs record in their XMP,
   dji-thermal-cli's `Emissivity` and `ReflectedTemperatureC`, or a workset's settings, its normalizing's reflected
   temperature, its mosaic frames' records), `inspector_api.py` (`region_request`'s `correction`, `layer_correction`,
   `saved_list`, `saved_record` measured on the server, `saved_change`, `saved_removal`, `InspectorMeasurements`,
   `InspectorMeasurement`), `inspector.py` (`raster_region`'s `correction`, before the isotherm's share),
   `analyzer_api.py` (`mosaic_region`, `MosaicMeasurements`, `MosaicMeasurement`), `plugin.py`; `inspector.js` (the
   Correction section, `corrected` / `uncorrected`, `rawIsotherm` for each layer's tiles, the legend's corrected marks,
   pins keep their layer and are shown corrected, a region measured again when its correction changed, even while it
   was measured; a Save on each pin and region row, its form, Saved measurements drawn dashed in green, renamed,
   deleted, `savedCsv`, `savedGeoJson`; a saved one leaves the browser's lists), `inspector.css`. CSV and GeoJSON are
   made in the browser, of the saved measurements of the layers on the map. Tests: `test_inspector.py` (the model
   written out, an orthophoto's baseline, a corrected region and its isotherm share, saving, renaming, deleting,
   refusals, who can only view), `test_analyzer.py` (a mosaic's saved pin, corrected pin and region, its tab
   refused, renamed, deleted), `inspector.test.js` (changed: a layer's name, the region's body, the layers' order;
   new: the model and the legend's marks, saving a region with its form, renaming, deleting, exports, a viewer without
   Save, the correction measuring again with the pins and isotherm tiles, a layer without a baseline). Jest 180,
   Django 145 (1 skipped), ESLint, Ruff; the JS model's and `raster_region`'s correction each seen failing when broken.
   Live on project 1 (it wrote, then deleted what it saved and the files it made): the test flight's orthophoto
   (baseline 0.91, 21.06 °C from its TIFFs; a rectangle at emissivity 0.8, mean 40.05 to 42.38 °C; saved with a
   comment, a pin saved; back after a reload, renamed) and its workset's mosaic (a rectangle saved); deleted through
   the panel; no console errors. Docs: README, `index.md`, the Inspector quickstart's sections 6 and 7,
   `measurement.md`, `api.md`; screenshots `inspector` retaken, `inspector-saved` new (the form filled, not sent).
5. **The frame page**: one frame with the Image and Isotherm sections, the tools in its pixels, and measured again
   exactly by dji-thermal-cli with changed parameters (dji-thermal-ui's `measure_frame`, `parse_changes`).
   Design (2026-11-01): an Analyzer page of its own, `datasets/<id>/worksets/<cid>/frame?frame=…`: the frame list
   beside it (← and → step), the frame panned and zoomed (Leaflet in pixels), the panel with Image (palette, range,
   sliders), Isotherm, the readout under the cursor, the frame's figures and histogram. Coloured in the browser from
   its values (a value PNG and `recolour.js`, as the maps). The Inspector's tools (Pin, Line, Rectangle, Circle,
   Polygon) in the frame's pixels, with the same statistics, surroundings, ΔT, isotherm share and profile. Measure
   again: distance, humidity, emissivity, reflected and ambient temperature changed, measured exactly by
   dji-thermal-cli; a second pane beside it, the readout both values and their difference. Opened from the source
   frames window ("Open this frame", mosaic viewer and Inspector) and the Files tab's detail pane (the newest ready
   workset). Left out: dji-thermal-ui's visual pair (the plugin pairs no visual photos) and its locator map (it would
   show where the flight was).
   Decided (the user, 2026-11-01): **measurements on a frame are savable** (as the Inspector's, kept with the
   workset, each with the parameters it was measured with); **all the frames, with a switch** (All / In the mosaic /
   Oblique once the mosaics are built); **downloads: the PNG as shown, the temperatures as CSV and as a 32-bit TIFF**
   (no location); **"New workset with these"** after measuring again (the Worksets tab's form filled in).
   Steps: (a) the server: the frame list, a frame measured (with changes), its values tile, a region in its pixels,
   the downloads; (b) the page: list, frame, Image, Isotherm, readout, figures, measure again; (c) the tools and saved
   measurements on frames; (d) the links in, New workset with these, docs and screenshots.
   **Done** (2026-11-01, `frame-page`, in the four steps): `frames.py` (the list from the analysis, the converted and
   the mosaics' frames; a frame measured by dji-thermal-cli as the workset converted it: its settings, the flight's
   medians when it normalized, the frame's offset when it harmonized; `parse_changes` as the workset form; a value
   PNG with no margin; `region` in pixels: a line's strip 1 px either side, the ring 3 to 10 px, a pin its pixel;
   CSV and float TIFF downloads), `frames_api.py` (`frames`, `frame`, `frame/values` with an ETag, `frame/region`
   in °C, `frame/download?kind=` (DRF keeps `format`), `frame/measurements` in the workset's
   `viewer/frame-measurements.json`, apart from the mosaics' so the Inspector doesn't list them), `inspector.statistics`
   shared with the map's regions, `values_response`'s margin; `frame.html` and `frame.js` (the list with All / In the
   mosaic / Oblique, Leaflet in pixels with a canvas overlay coloured by `recolour.js`, the panes moving together,
   the readout from the values, Measure again with the second pane and the difference, the figures, PNG/CSV/TIFF;
   the Measure section with regions.js's tools on the first pane, a circle made a pixel polygon, measured again when
   the changes or the isotherm change, the Inspector's statistics with `pixels`, the profile hovered marking its
   point; Saved on this frame), `viewer.js` (`bindControls`: the palette, range, Image and Isotherm behaviour, shared
   by the two pages), `frames.js` (`framePageUrl`, the window's Open this frame, new tab), `dataset.js` (the Files
   tab's frame links to the newest ready workset, `fromQuery`), `conversions.js` (`useFrom`: the form filled with the
   workset's settings and the changes), `inspector.css` (the frames window scrolls, its links plain). Tests:
   `test_frames.py` (new: shapes in pixels, a harmonized workset's settings and offset in °F, changes checked; on the
   flight a frame equal to the workset's own TIFF, measured again, its value PNG and 304, a rectangle, CSV and TIFF,
   saving, listing by frame, a viewer's refusal, renaming, deleting; the page for who can see the dataset),
   `frame.test.js` (new: the lists, the parameters typed, the URLs, the readout, the page's frame from a link, stepping,
   measuring again with both panes moving together, limits refused locally, downloads, a slider making no request, a
   pin measured and saved, measuring again on the isotherm and the changes, renaming and deleting, pixels for a
   circle and a line's sizes), `analyzer.test.js` (Open this frame, the Files tab's frame page, the form from the
   frame page), `inspector.test.js` (Open this frame). Jest 239, Django 178 (1 skipped), ESLint, Ruff; the panes' syncing
   seen failing when broken. Live on the test flight's worksets (the measuring check wrote one measurement, renamed and
   deleted it, and its empty file was removed): 218 frames (42 in the mosaic), hover, a slider with no request,
   emissivity 0.8 beside the frame, stepping and the Oblique list in the URL, CSV and TIFF; a rectangle, a 360 px line
   with its profile marking the frame, a circle and a pin; Open this frame from the mosaic viewer and from the
   Inspector's window, the Files tab's link, the form filled from New workset with these (not sent); no console errors
   but WebODM's own livereload. Docs: README (the summary, the frames window, the Files tab, The frame page),
   `index.md`, the worksets quickstart's One frame at a time, the Inspector and Analyzer quickstarts, `measurement.md`,
   `api.md`; screenshots `frame-page` and `frame-measure-again` new, `mosaic-frames`, `dataset-files` and
   `inspector-frames` retaken (its viewport taller, for the window's foot).

Open, to check in step 1: the Inspector's palette and range are per thermal layer today; a mosaic laid beside an
orthophoto takes the same palette, and its own range unless the user links them.

## Done: The mosaic viewer's image controls

**Request** (the user, 2026-10-31): dji-thermal-ui's viewer panel (a separate repository,
`frontend/src/viewer/panel.tsx`) in the plugin's mosaic viewer (`viewer.html`, `viewer.js`: the Mosaic,
Harmonized, Source frame and View angle tabs). Its "Open this frame" is left out for now (the plugin has no frame
page; the user, 2026-10-31).

**Builds on**: the viewer's palette, range and Auto (shared by the temperature tabs, `styleGroup`), its tiles and
frame pictures drawn by the plugin (`mosaics.tile`, `mosaics.frame_image`, `mosaics.rendered`), its readout
(`mosaics.point`, `MosaicPoint`) and frames window (`select`, `pipHtml`); the Thermal Inspector's isotherm tiles
(`inspector.isotherm`); and dji-thermal-ui's drawing code (`analyzer/colouring.py`: the tone curve, the unsharp
mask, the isotherm's grey; `analyzer/thermal_measure.py`: `tone`, `equalization`, `value_histogram`,
`curve_shares`; `frontend/src/viewer/view.ts`: `slidRange`, `sliderPositions`, `SLIDERS`, `sliderGamma`), numpy
only and AGPL as the plugin, adapted to Python 3.9 and ES5. Within the plugin rules: the plugin's own page,
endpoints and data; nothing in WebODM. WebODM's own map (the Thermal Inspector) is not changed: its thermal layer
is drawn by WebODM's tiler.

**Decided** (the user, 2026-10-31):
- **The isotherm keeps the palette inside and greys the rest**, as dji-thermal-ui (the Thermal Inspector keeps its
  one colour over the pixels inside).
- **A click keeps the point**: it keeps the "Under the cursor" readout on the clicked point (and opens the frames
  window, as now); a "Follow the cursor" button under the readout lets go, so it follows the mouse again.
- **Nothing remembered between visits**, as the range: each visit starts at the Auto range, no adjustments and no
  isotherm; only the palette is saved, as now.

**Design** (Claude's, to check while building):
- **Drawn by the server, never in the browser**: the tiles and the frames window's pictures take the adjustments and
  the isotherm as query parameters (with the palette and range), so the colour bar, drawn with the same curve, always
  matches; the readout's temperatures never change.
- **Brightness and Contrast move and narrow the range** (dji-thermal-ui's `slidRange`), around the Auto range; the
  range boxes follow the sliders, and a typed range moves the sliders (`sliderPositions`).
- **Equalized only on the temperature tabs**; its histogram of the whole mosaic is worked out the first time it is
  asked for and kept beside the mosaic's other viewer files (until the mosaics are built again), so mosaics built
  before work without a rebuild.
- **Sharpening reads a margin around each tile** (`tile_buffer`, as the Source frame tab's seams), so tile edges
  don't show.
- **The temperature tabs share the adjustments and the isotherm**, as they share the palette and range; View angle
  has gamma, sharpening and Linear only, and no isotherm.
- **Layout**, as dji-thermal-ui: an "Image" section (the sliders, Linear/Equalized, Reset: the Auto range and no
  adjustments) and an "Isotherm" section (None, Above, Below, Between, limits in the user's unit) below the range;
  "Under the cursor" and "The mosaic" as now.

**Steps**, each on its branch, with its tests (agreed with the user before they are written), a live check on
the test flight, and README and docs (`docs/`, screenshots retaken):
1. **Frame pixel**: `mosaics.point` reads bands 4 and 5 (`source_u`, `source_v`, written by dji-thermal-cli since
   1.4.0; the dev server's mosaics have them) as `frame_pixel`; the readout shows "Frame pixel x, y" (none for a
   mosaic without them).
   **Done** (2026-10-31, `viewer-frame-pixel`): `mosaics.point` (as dji-thermal-ui's `api.py`), `viewer.js`
   `readoutHtml` (as its `panel.tsx`); README, `docs/quickstart-worksets.md`, `docs/api.md`, screenshot
   `mosaic-viewer` retaken. Tests (agreed): `test_analyzer.py`'s mosaic test (the frame pixel as the frames window
   finds it, none outside), `analyzer.test.js`'s readout test. Django 134 (1 skipped: Windows only), Jest 161,
   ESLint, Ruff; live on the test flight: the row shows, matching the frames window's pixel within one.
2. **A click keeps the point, "Follow the cursor"** (`viewer.js`).
   **Done** (2026-10-31, `viewer-follow`): `viewer.js` (`pin`, `follow`, `followHtml`, `readoutHtml(res, unit,
   pinned)`; the marker on its own layer, kept when the frames window closes; Esc outside a field; another tab reads
   the kept point again), `viewer.html`'s hint; README, `docs/quickstart-worksets.md` (and its frame pixel, missed in
   step 1), screenshot `mosaic-frames` retaken. Tests (agreed): the frames window's test changed (the click's point
   replies, the marker on the new layer), a new test "a click keeps the readout on its point until Follow the cursor
   or Esc", the readout test's button. Jest 162, ESLint; live: kept on moving, closing the window and changing tab;
   the button and Esc let go.
3. **The Image section**: brightness, contrast, gamma, sharpening, Linear/Equalized, Reset; tiles, frame pictures
   and the colour bar.
   **Done** (2026-11-01, `viewer-image`): `colouring.py` (dji-thermal-ui's `colouring.py` and the colours of its
   `thermal_measure.py`: `colour` with a `margin` instead of `rows`, no source-frame colours; `parse_adjust`,
   `value_histogram`, `equalization`, `tone`, `curve_shares`, `kept_histogram` keyed on the file, not the read
   function); `mosaics.py` (`tile` and `frame_image` drawn by it, `shares`, `histogram` kept as
   `viewer/histogram-<kind>.json`, `tile_pixel_m` for the unsharp mask's sigma, `is_temperature` counting Source
   frame); `analyzer_api.py` (`mosaic_style` with the adjustments, `MosaicCurve`: `mosaics/<tab>/curve`);
   `viewer.js` (from `view.ts`: `slidRange`, `sliderPositions`, `SLIDERS`, `sliderGamma`, `toneShares`,
   `adjustQuery`; `imageHtml` from `panel.tsx`), `scale.js` (`paletteCss`, `gradientCss` along shares),
   `analyzer.css`; README, `docs/quickstart-worksets.md`, `docs/api.md`, screenshots `mosaic-viewer` and
   `mosaic-frames` retaken. The frames window's pictures use their mosaic's curve, so they match the colour bar.
   Tests (agreed): `test_analyzer.py` (the drawing without images; in the mosaic test the adjusted tiles, the
   curve, the refusals and the kept histogram), `analyzer.test.js` (the helpers; the page's sliders, Equalized,
   Reset and frame pictures). Django 135 (1 skipped: Windows only), Jest 164, ESLint, Ruff; live on
   the test flight: each slider, Equalized and Reset, on Mosaic, Harmonized and View angle, and the frames
   window. The live check's `histogram-as_converted.json` and `histogram-harmonized.json` (a cache) were removed
   from that workset's `viewer/` folder afterwards (2026-11-01), leaving it as found.
4. **The Isotherm section**: tiles and frame pictures.
   **Done** (2026-11-01, `viewer-isotherm`): `colouring.py` (dji-thermal-ui's `parse_isotherm` and
   `isotherm_range`), `mosaics.tile` and `frame_image` (the isotherm to `colouring.colour`), `analyzer_api.py`
   (`mosaic_isotherm`: `isotherm=above,T|below,T|between,A,B` in the mosaic's unit, temperatures only), `viewer.js`
   (`isothermParam` from its `measure.ts`, `isothermHtml`, `isothermQuery`; shared by the temperature tabs, kept by
   Reset), `analyzer.css`; README, `docs/quickstart-worksets.md`, `docs/api.md`, screenshots `mosaic-viewer` and
   `mosaic-frames` retaken. Tests (agreed): `test_analyzer.py` (the isotherm's drawing and parsing; its tile and
   refusals), `analyzer.test.js` (`isothermParam`; the section in the page test). Django 135 (1 skipped: Windows
   only), Jest 165, ESLint, Ruff; live on the test flight: Above 40 and Between 20–30 on the map and in the frames
   window, the reversed range's error, shared with Harmonized, none on View angle, None removes it.

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
- **macOS checks after 1.0.0**, at the very end (since dropped: macOS's installer runs WebODM in Docker, see "Up
  next: Linux, Windows and macOS").

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

## Done: Linux, Windows and macOS

**The request** (the user, 2026-10-31): "This needs to support Linux, Windows and MacOS. You're currently on WSL with
access to Windows for any Windows specific tests. I do prefer we limit the need to run platform specific tests on
MacOS as it requires me to pull on my macbook and run the tests there. Make sure any tests are truly necessary and
not just providing coverage."

**Where the platform matters.** WebODM is installed with Docker on all three systems (the plugin's Python then runs
in WebODM's Linux container, the same everywhere) or with its native installers, which its docs recommend on Windows
and macOS (the plugin's Python then runs on that system). The browser side (the pages, the map control) is the same
JavaScript everywhere: no platform tests. What differs, found by reading the code (2026-10-31):
- `datasets.locked` holds the dataset's records with `fcntl.flock`, imported at the top of `datasets.py`: **on
  Windows the plugin fails to import** (no `fcntl`), so nothing of it works. Needs a lock that works on Windows
  (`msvcrt.locking`) with `fcntl` kept on Linux and macOS.
- `converter.exiftool_command` runs `exiftool` to copy the R-JPEG's metadata into the TIFF; WebODM's Docker image
  installs it (on every system, the user confirmed), a native install may not have it. To find out what the native installers ship; if not there, the
  plugin needs another way (dji-thermal-cli writes its TIFFs' EXIF/XMP itself, `tiffout`), or says so on the SDK
  page.
- DJI's own SDK (`sdk.py`): its zip has Linux and Windows libraries, none for macOS; dji-thermal-cli picks the
  folder (`native.bindings.platform_dirs`). On macOS the SDK page says there is no known DJI SDK for macOS (the
  built-in port is used, as without it): agreed by the user, 2026-10-31.
- Paths: zip members and stored paths use `/`, files are read with `os.path`; `os.replace` over a file another
  process has open fails on Windows (thumbnail cache, SDK install, records). To check where it can happen.
- dji-thermal-cli is pure Python and tested on all three systems by its own release workflow.
- **The React parts** (`public/thermal/*.jsx`: the Thermal Task button and dialog) are built by WebODM's webpack
  when the plugin loads (`app/plugins/functions.build_plugins`), skipped when `public/build` exists. WebODM-Plugins'
  guidance says webpack is not available on native installs; then the log says "webpack-cli is not installed, plugin
  will not work" and the Thermal Task button is missing. The release zip has no `public/build` (`dev/package.sh`
  takes committed files only). Either the zip ships the built files (built against WebODM's version, so rebuilt for
  each release), or those parts move to plain JavaScript like the rest of `public/`.

**What WebODM says** (read 2026-10-31): the plugin guide and WebODM-Plugins' guidance say nothing about supporting
several systems; the only platform notes are the dev setup (native Windows when no JSX is needed, otherwise Docker)
and that webpack is missing on native installs. WebODM's own loader handles Windows (`npm.cmd`, `webpack-cli.cmd`),
and its docs recommend the native installers on Windows and macOS, so a directory plugin reaches all three. The
guidance asks for responsive UI ("work on mobile as well as desktop"); WebODM itself sets a mobile viewport and uses
Bootstrap 3 (the menu folds under 768px), with small-screen rules in a few of its own views (task list, edit form,
paginator, 3D view). The user (2026-10-31): no phone-width work unless WebODM supports mobile, and then to know how
far; so the plugin keeps to what Bootstrap gives (nothing breaks or overflows under 768px), with no phone-specific
layouts, and the UX review checks desktop only.

**Found on 2026-10-31, after the first answers**:
- **The macOS installer runs WebODM in Docker** (webodm.org's FAQ: "simply a manager program to help you setup
  WebODM with docker"). On a Mac the plugin's Python is always in WebODM's Linux container: **nothing in the plugin
  is macOS-specific**, and no Mac run is needed. The SDK page needs no macOS message (DJI's Linux library is used in
  the container). Only Docker on Apple Silicon is left to check: if WebODM's image runs as arm64 there, DJI's x64
  library can't load, and dji-thermal-cli's `platform_dirs` would look for `release_x86` (to check, and say so on
  the SDK page).
- **The Windows installer runs natively** (WebODM_Setup.exe, free, on WebODM's GitHub releases). This machine has
  one installed already, WebODM 3.2.7 in `C:\WebODM` (stopped, with projects of its own). It has no node, npm or
  webpack (so the React parts can't build), and exiftool only inside ODX (`apps/ODX/SuperBuild/install/bin`), not
  on WebODM's PATH.
- **exiftool isn't needed.** dji-thermal-cli's public `process()` (with `outputs=("temp_c:tiff",)`) writes the same
  float32 TIFF, with no exiftool and no CLI change: the R-JPEG's EXIF block kept byte for byte (GPS, Exif IFD, maker
  notes), DJI's whole XMP packet with `Camera:BandName` = `LWIR` added, and the same `dtc:` tags the plugin writes
  (Software, Distance, DistanceSource, Humidity, Emissivity, ReflectedTemperatureC, AmbientTemperatureC). It keeps
  more than exiftool does: exiftool drops the DJI XMP tags it can't write (ImageSource, the rangefinder's). The one
  difference: its `dtc:Software` doesn't say "with DJI's Thermal SDK x" when DJI's SDK measured (a small CLI change,
  if wanted). `converter.convert` then calls `process()` on the one file and moves its `<stem>_temp_c.tiff` into
  place; `copy_metadata`, `exiftool_command` and `exiftool_camera.config` go.

**Proposed steps**:
1. **The code made portable** (Linux tests as now): the lock (`msvcrt` on Windows), the converter on
   `process()` (no exiftool, the same on every system), the `os.replace` cases, the React parts built by
   `dev/package.sh` into the zip's `public/build` (the user's choice). Each Windows branch small and in one place,
   so Linux runs cover the rest.
2. **Windows checks from this machine**: the tests of what differs (the lock, `os.replace`, the SDK's Windows
   library) with Windows' Python; then the plugin's zip installed in a native WebODM as a user would, with a Thermal
   Task and an Analyzer dataset, as the release check does on Linux.
3. **macOS**: no Mac runs (Docker, as on Linux). Apple Silicon checked from WebODM's image manifest, if possible
   without a Mac.

**Progress**: the converter on `process()`, exiftool and `exiftool_camera.config` gone (2026-10-31,
`converter-without-exiftool`; `test_converter`, `test_sdk`). The records' lock and every file replacement in
`portable.py` (`fcntl` or `msvcrt`; `os.replace` tried again for a second on Windows, where a file another
process has open can't be replaced), its `test_portable` passing on Linux and with the native WebODM's Python 3.9
on Windows (2026-10-31, `portable-files`; the `test` skill's Windows step). The React parts built into the zip's
`public/build` by `dev/package.sh` (`ship-build`). Mosaics with `jobs=1` (`mosaic-jobs-windows`, below). The DJI
Thermal page on an ARM server (`sdk-processor-message`, below). The `release-check` skill's native Windows step.

**Done** (2026-10-31, merged as `platforms-done`): checked on the native Windows WebODM 3.3.2 with the zip of
these changes, in a project of its own, deleted afterwards, and the plugin removed: no webpack run (the built
files used), the Thermal Task button on every project, 40 frames of the M4T flight (and 3 RGB photos, left out)
converted through the panel and processed on the native node (orthophoto 9.8 to 33.3 °C, 212 s); an Analyzer
dataset of the same frames analyzed, converted with mosaics, shown in the viewer (WebODM's Leaflet from the build),
a task created from the conversion and processed (269 s). The full Django suite passes (134, the Windows-only test
skipped); `test_portable` passes on Windows.
- **Mosaics on Windows**: the first run's mosaics failed ("No frames to mosaic"). dji-thermal-cli started worker
  processes, which Windows' Celery worker allows (Linux's daemon processes don't), and a started process doesn't
  have the plugin's site-packages ("No module named 'dji_thermal_cli'"). `mosaics.build` now passes `jobs=1`, as
  analysis and conversions did. Reinstalling the plugin over a running WebODM keeps the worker on the old code until
  WebODM restarts (the user restarted it for the check).
- **The Analyzer task's orthophoto read -76.2 to 57.7 °C** (its frames about 7 to 32 °C), where the Thermal Task's
  was in range: like the closed October case (an ODM reconstruction, not the plugin), seen here on the native node.
  Noted, not looked into further.
- **Apple Silicon**: WebODM's webapp image is built for amd64 and arm64, so Docker on an Apple Silicon Mac runs
  arm64 Linux. DJI's SDK zip has x64 and x86 libraries only, and dji-thermal-cli's `platform_dirs` maps any other
  processor to `release_x86`. The DJI Thermal page now says the SDK can't run on that processor and refuses an
  upload; the built-in port is used (checked in the dev container with the processor patched to aarch64 and
  arm64). dji-thermal-cli could name ARM itself in its own message (a CLI change, if wanted).

**Seen on the native Windows WebODM 3.3.2** (2026-10-31, the zip of `main` installed through Administration >
Plugins, then removed):
- WebODM logged "Running webpack for dji-thermal" then "webpack-cli is not installed, plugin will not work"; the
  dashboard has no Thermal Task button (404 for `build/ThermalTaskButton.js` and `.css`). The mosaic viewer's map
  needs `build/Leaflet.js` the same way.
- Everything else loads: the plugin registers, dji-thermal-cli 1.10.0 with numpy and Pillow install from pip's
  Windows wheels, the Thermal Analyzer and DJI Thermal pages open (the built-in port reported).
- **A WebODM bug on Windows**: after pip succeeds, `pyutils.requirements_installed` puts the packages' folder on
  PYTHONPATH with `:` (Windows uses `;`), sees none of them, logs "Failed to install requirements.txt" and writes no
  `install_md5`, so every start of WebODM runs pip again (and needs the internet). It hits every plugin with
  requirements. The plugin can work around it in its own `check_requirements` (write `install_md5` when its pinned
  packages are in its site-packages); the fix itself belongs in WebODM. `os.pathsep` alone isn't enough: the
  native installer's Python has a `python._pth`, which makes it ignore PYTHONPATH. The fix is `pip freeze --path
  <site-packages>` (tested on the native Windows Python and in Docker). The user submitted it to WebODM as
  [PR #2046](https://github.com/WebODM/WebODM/pull/2046) (one line, no test changes), merged by the maintainer on
  2026-10-31: **no workaround in the plugin**; WebODM releases after 3.3.2 write `install_md5` on native Windows.
- The native app logs in by itself (no login form); its server answers only on Windows' 127.0.0.1:29800, and
  Windows' firewall blocks connections from WSL, so the check went through a reverse tunnel (Windows' Python
  connecting out to WSL), stopped afterwards.

**Decided** (the user, 2026-10-31): **ship the build**. Asked why the rewrite was needed (the answer below), the
user chose the built files in the zip over the rewrite. The Thermal Task panel
embeds WebODM's own `NewTaskPanel` (name, node, options and presets, map preview, review), which only webpack can
import, and WebODM has no hook to convert photos uploaded through its own button. So: ship `public/build` in the
zip (built by `dev/package.sh` in the dev container; WebODM skips webpack when it is there, as its core plugins run
on the native installer), or a plain-JavaScript rewrite with a smaller form of our own (proposed: ship the build).

**Decided** (the user, 2026-10-31): the plugin supports Docker (all three systems), the native Windows installer and
the macOS installer (Docker); the React parts ship built in the zip (first a rewrite, changed, see above); a
native Windows WebODM is used for the checks.

Also decided (the user, 2026-10-31): the converter on `process()`, exiftool dropped; `dtc:Software` stays as the
CLI writes it (no CLI change); the Windows checks use the install in `C:\WebODM` (unused), which the user upgraded
to 3.3.2.

**Open**: none.

## Done: Picture viewer

**The request** (the user, 2026-10-31): "On the Files view, when the user clicks the image in the detail pane to
view the full image; pop open an inscreen window with a close button and basic image controls instead of opening
in a new tab/window"

**Builds on**: the Files view's detail pane (a dataset's page, Files tab: `dataset.js` `detailHtml`). Its picture
is a link, opened in a new tab, to `thumbnail?size=large`: a thermal frame drawn in the user's DJI palette at its
own size (640x512 on the M4T), a photo as a JPEG of at most 1280x1280. The original file is at `files?file=`
(Download gives it).

**Proposed**: a viewer drawn over the page (plain JavaScript and CSS in the Analyzer's pages, WebODM's theme
colours, no library), opened by clicking the picture:
- the picture fitted to the window, with zoom in, zoom out, fit and 100% buttons, the mouse wheel zooming where
  it points, dragging to pan;
- the file's name, previous and next (the table's order, as the pane's selection uses), and Download (the
  original);
- closed by its close button, Escape or a click outside the picture; the arrow keys go to the previous and next.
- Jest for the zoom and the order; checked live on the user's data.

**Open** (for the user):
none. Decided (the user, 2026-10-31): a photo is shown from the original file at full size (its load time is
expected), opening at the zoom that fits it in the viewer, with a control to go back to that fit; a thermal frame
shows the palette picture; previous and next included.

**Built** (2026-10-31, `picture-viewer`): `public/picture_viewer.js` (`ThermalPictureViewer.open`, with the zoom's
sums as plain functions: `fitView`, `zoomLimits`, `zoomAt`, `wheelFactor`), opened from `dataset.js` (`viewerSrc`,
`viewerItems`, `viewPicture`), its styles in `analyzer.css`. As proposed, plus: **Fit** and **1:1** buttons, the
zoom shown in percent, a double click zooming in where it points (to 100% at least) and back to the fit, the keys
+, −, 0 and 1; zoomed beyond 100% the pixels are drawn square (a thermal frame's pixels show); the file shown
becomes the selected one, its row scrolled to, so closing leaves the table on it; Ctrl/Cmd-click on the picture still
opens it in a new tab. The viewer is on the page's body, above WebODM's top bar (z-index 99999), which covered it
inside the page. Tests: no new ones (the user's rule: tests are added only after asking); Jest 161 and ESLint pass,
`test_analyzer` (58). Live check on the test flight (GETs only, no thumbnail added to the cache): opened at frame 2
of 327 fitted (186%), zoom in, 1:1, the wheel (the point under the mouse kept), a drag, Fit, → and ← (Previous
disabled at the first, the selection following), Esc and a click beside the picture closing it; a 4032x3024 photo of
the M4T flight served to the browser only (fitted at 32%, refitted when the window shrank).

## Done: Documentation

**The request** (the user, 2026-10-31): "Plan to setup the github repo to host the documentation." and "Plan out
the documentation. We'll also want to provide quickstart tutorials with screenshots and then maintain the
documentation as feature changes require going forward."

**Builds on**: README.md (the plugin's public page today: what it does, installing, using it, the converted images,
the outside services); the `live-check` skill's Playwright scripts (the same login and pages, for screenshots).

**Where things stand** (checked 2026-10-31): the repo is private, with no GitHub Pages and no wiki. GitHub Pages on
a private repo needs a paid plan; on a public repo it is free, as are its Actions minutes. The repo has to be public
anyway for the release: WebODM downloads the zip from the URL in WebODM-Plugins' `directory.json`.

**Proposed**:
1. **Hosting**: a `docs/` folder of Markdown on `main`, which GitHub shows as pages with no build at all; GitHub
   Pages ("Deploy from a branch", `main` `/docs`) turned on once the repo is public, giving a site with no workflow
   of ours (GitHub runs its own Pages build, free on a public repo). README stays the short public page and links to
   the docs.
2. **Contents**:
   - Quickstarts, each one task end to end with a screenshot per step: a thermal orthophoto from a DJI flight (Thermal
     Task), checking a flight before processing (Thermal Analyzer: upload, analyze, Files, Problems, WebODM plan), a
     workset and its mosaic viewer, measuring on the map (Thermal Inspector: point, region, isotherms, legend).
   - Guides: measurement settings (emissivity, distance, reflected and ambient temperature: what each changes), the
     palettes, DJI's own SDK (the DJI Thermal page), the Docker and native Windows installs.
   - Reference: the converted images (from README), the HTTP API the plugin adds, troubleshooting (the messages a
     user can meet and what to do), cameras supported.
3. **Screenshots made by a script**: a Playwright script (`dev/`, beside the live checks) that logs in to the dev
   WebODM, opens each page in a set state and saves the screenshots the docs use, at one window size. Rerun after a
   UI change, so a screenshot is never out of date by hand. A `docs` skill with the steps.
4. **Kept current**: a rule in CLAUDE.md, as for README: a change to what the user sees updates the docs and reruns
   the screenshots on the same branch.

**Decided** (the user, 2026-10-31):
- Screenshots go in `docs/` (the only images the repo takes; CLAUDE.md's "never commit an image" rule gets that
  exception on the docs branch).
- They may show the user's own data, but a shot that includes a flight's image never shows where it was taken:
  no coordinates (the Files tab's and the detail pane's GPS columns, the Inspector's readouts, WebODM's map
  coordinates), no addresses or place names. The script blanks those before each capture, and each screenshot is
  looked at before it is committed. The map pages show the place through the basemap (street names, houses around
  the orthophoto), so their shots turn the basemap off (decided by Claude, the user leaving it open: the safe
  reading). Shots without a flight's image (the DJI Thermal page, empty forms) need nothing blanked.
- GitHub Pages (`main` `/docs`) once the repo is public.

**Done** (2026-10-31, `docs`):
- `docs/`: `index.md`; quickstarts `quickstart-thermal-task.md`, `quickstart-analyzer.md`, `quickstart-worksets.md`,
  `quickstart-inspector.md`; guides `installing.md`, `measurement.md`, `palettes.md`, `dji-sdk.md`; reference
  `converted-images.md`, `troubleshooting.md`, `api.md`; `_config.yml` for Pages (Jekyll, primer theme). Plain
  Markdown that reads on github.com too (no definition lists).
- `dev/screenshots.js` (16 shots in `docs/images`, 2.6 MB), read only on the dev WebODM: GETs, the login, `describe`
  and an Inspector region's statistics only; every request beyond WebODM aborted (no basemap); the detail pane's
  latitude and longitude and the camera's serial number (also not for publishing, decided by Claude) hidden; a page
  showing a number with 5+ decimals refused. Every shot looked at. Settings from `.env` or the environment.
- The `docs` skill; CLAUDE.md: the docs rule (a change a user sees updates its page and screenshots) and the image
  exception for `docs/images`; README links the docs. Found on the way: README's Installing still said a release
  zip needs WebODM's webpack and that only Docker was checked; corrected.
- Left for the user: GitHub Pages (Settings > Pages, `main` `/docs`) once the repo is public; the site will be
  https://winuxnomacs.github.io/webodm-dji-thermal/.

## Done: UX review

**The request** (the user, 2026-10-31): "Using your expert ux designer skills, how would you make this ui more
intuitive?"

**Scope**: everything the plugin adds to WebODM: the Thermal Task button and its dialog, the Thermal Analyzer's
list, a dataset's page (summary, Worksets, Files, Problems, WebODM plan), the mosaic viewer, the Thermal Inspector
on the map, the DJI Thermal page under Administration.

**Proposed**:
1. **Review**: each page walked through in a browser on the user's data, as a first-time user with a flight to
   process would (upload, analyze, convert, process, inspect), at desktop width (the user: no phone layouts); what is unclear, hidden,
   inconsistent with WebODM or the other pages, or takes more steps than needed. Written up as ranked proposals,
   each with what changes and why, screenshots and mockups, sorted into quick fixes and larger changes.
2. **The user chooses** which to build; the chosen ones become steps here, each on its branch, tested and checked
   live.

**The review** (2026-10-31): every page walked through in a headless browser at 1440×900 on the test flight, read
only. It found one bug, fixed first (the mosaic viewer page drawn over WebODM's menus, `fix-picture-viewer-classes`
above). Proposals, the most useful first; the numbers are for choosing.

*Larger changes*
1. **Problems and the WebODM plan speak in command-line flags.** Every suggestion on the Problems tab is
   dji-thermal-cli's, e.g. "--mosaic-normalize (uses the flight median) or set one value with --ambient-temp and
   --reflected-temp", "--mosaic-max-pitch DEG to include them", "deg C". So are the plan's Notes. A WebODM user has
   no command line and has to work out which setting each flag is. Proposed: for the findings the plugin knows (by
   code: `ambient_temp_varies`, `oblique`, `temperature_max_outlier`, `rangefinder_distance`, `rangefinder_invalid`,
   …), the plugin's own wording naming the setting on the Worksets tab ("Tick Normalize in Workset Creation
   Settings"), with a button that sets it in the form. Findings it doesn't know keep the CLI's text. The code under
   each finding (`ambient_temp_varies`) moves into a tooltip. The plan's command line stays, folded under "As a
   command". The CLI's own wording stays: its users need the flags.
2. **The step after a workset is hidden.** A converted workset shows View mosaics; **Create task** and **Use for
   parent task**, the way to an orthophoto, are in its ⋯ menu with Rename and Delete. Proposed: a workset with no
   task shows **Create task** as a button beside View mosaics; Use for parent task stays in the menu.
3. **No path through the dataset page.** The page opens on the Worksets tab with the creation form at the top, but
   a first-time user should look at Problems and the WebODM plan before choosing settings. Proposed: a line of steps
   under the summary, each a link with its state: "1 Check: 2 warnings → 2 Create a workset (the plan's settings
   are recommended) → 3 Create a task → 4 Measure on the map". While there are no worksets, **Use the WebODM plan's
   settings** is the main button and the form says so.
4. **Two ways in, no signpost.** The Dashboard's Thermal Task and the Thermal Analyzer both turn DJI photos into a
   task, and neither says when to use the other. Proposed: one line in each: the Thermal Task panel says "To check
   the flight first or compare settings, use the Thermal Analyzer"; the Analyzer's New Dataset dialog and its empty
   list say "For a task straight away, use Thermal Task on the Dashboard".
5. **The ⚠ chips read as errors.** On the Worksets tab the settings' chips (temp_c:tiff, pseudo:png ⚠, not
   normalized ⚠, all frames ⚠) are orange with a warning sign where a setting differs from the WebODM plan, with
   that meaning only in a tooltip. On a new dataset the defaults show three warnings. Proposed: a neutral chip
   marked "≠ plan", and one line after them: "≠ plan: differs from the WebODM plan (hover for its value)".
6. **The same measurement fields, asked two ways.** The Thermal Task panel asks unit, emissivity, reflected,
   ambient, humidity, distance; the Workset Creation Settings ask distance, humidity, emissivity, reflected,
   ambient, then the unit of the files, with other labels ("Distance" / "Distance to the target") and other hints
   ("As recorded (0.91)" in the field / "each image's own" in the field and "recorded 0.91" under it). Proposed:
   one order, labels and hint style for both.

*Quick fixes*
7. **Numbers broken mid-number in the mosaic viewer's panel**: "95% under 2. / 04 °C", "the groun / d plane", a
   file name split as "…_T.JP / G" (`.ta-viewer .ta-viewer-values td { word-break: break-all }`). Wrap at spaces,
   and break a long word only when it doesn't fit (`overflow-wrap: anywhere`).
8. **Format codes shown as they are**: "temp_c:tiff, pseudo:png" in the chips, "temp_c tiff, pseudo png" in the
   mosaic viewer's subtitle. In words: "°C TIFFs, colour PNGs".
9. **Two palettes, unexplained**: a workset reads "palette ironred", its mosaics open in DJI arctic (the
   Preferences palette). The workset's palette colours its PNGs only: say "colour PNGs in ironred".
10. **A note that reads as cut off**: "--distance lrf (the default) measures with the rangefinder's" (the CLI's
    wording, meaning its distance). Gone with 1; otherwise reworded in dji-thermal-cli's next release.
11. **File names twice** in the "unusual maximum temperature" warning: in its sentence (with values) and again as
    chips. Keep the chips (they open the files) and the values in their tooltips.
12. **Jargon in New Dataset**: "The R-JPEGs of a flight (the _T.JPG files)" → "DJI thermal photos (the _T.JPG
    files)".
13. **The Analyzer list's Worksets column** reads "2/2": "2" when all are ready, "1 of 2 ready" otherwise.

Screenshots of each page are kept outside the repo (they show the flight's location).

**Decided** (the user, 2026-10-31): tests whose expected wording changes get the new text, nothing else added or
changed, each such test named in its step. All 13, in an order Claude chooses, planned around what is left so nothing is
done twice. So: proposals that change the same code go on one branch; the screenshots and the docs wait for the
last UX step (Documentation is next, then the release, redone once at the end); each step updates README.md as it
goes (the docs are written once, from it); 10 needs no dji-thermal-cli release, as 1 replaces that text.

**Steps**, each its own branch, tested (Jest, ESLint, the Django tests where Python changes) and checked live:
1. The mosaic viewer: 7 (wrapping), 8 and 9 in its subtitle (`viewer.js`, `analyzer.css`). Done, `ux-viewer`:
   the panel's values wrap at spaces (`overflow-wrap: anywhere`), a file name after its underscores; outputs in
   words from one table, `conversions.PRODUCT_NAMES` (`output_text`: "°C TIFF", "colour PNG in ironred", the
   palette only on the coloured outputs; sent with a dataset as `product_names` for step 2), used by `summary_text`,
   so the subtitle and the workset cards' description read "°C TIFF, colour PNG in ironred · normalized · …".
   Ruff, Jest 161, `test_analyzer` 58; live on both worksets (GETs only).
2. The Worksets tab's chips and workset cards: 5, 8, 9 (`conversions.js`), and 2 (Create task beside View mosaics,
   same file). Done, `ux-worksets`: chips and the Outputs list name the outputs in words (the names sent with the
   dataset, `product_names`, so every viewer has them); the palette chip only where there are colour outputs
   ("colour PNG in ironred"); a chip off the plan is neutral, marked "≠ plan", with one legend line after the chips
   (the form's fields: a dashed grey edge, "≠ plan: …"); Create task beside View mosaics on a workset in no task
   (neither its own task nor the dataset's), in the menu otherwise; the form's hints say "colour outputs" and
   "16-bit grey outputs". Test changed (expected text only): `analyzer.test.js`, "lists what settings change
   dji-thermal-cli's defaults…", outputs "temp_c TIFF, pseudo TIFF" (no names loaded there). Jest 161, Ruff,
   `test_analyzer` 58; live (GETs only): both worksets, the settings open, a workset shown taskless (its tasks
   removed from the page's copy of the response) with Create task beside View mosaics.
3. Problems and the WebODM plan: 1, 11, 10 with them (`dataset.js`; the buttons reuse the form's "Use these
   settings" path in `conversions.js`). Done, `ux-problems`: `dataset.SETTING_NAMES` turns dji-thermal-cli's options
   into the settings' names (and "deg C" into °C) in findings and plan notes; `FINDING_FIXES` gives the plugin's own
   advice for `*_varies`, `oblique`, `temperature_max/min_outlier`, `rangefinder_distance/_invalid/_outlier`, with a
   button for the two one setting fixes (Normalize; frames at or below −80°: `conversions.useSettings`, the rest of
   the form kept, the Worksets tab opened); a message's list of files and values is dropped (the values in the
   file links' tooltips); the rangefinder note reworded; the code in the finding's tooltip; the plan's command
   folded under "As a dji-thermal-cli command". Test changed (expected text only): `analyzer.test.js`, "shows the
   problems with what addresses them…", "--replace-above" → "Replace temperatures above". Jest 161; live (GETs
   only): the four findings, both buttons (Normalize ticked, then −80° with Normalize kept), the plan's notes.
4. The dataset page's steps and empty Worksets: 3, after 2 and 3, which its links point to (`dataset.js`,
   `dataset.html`). Done, `ux-steps`: `dataset.stepsHtml` under the summary, once analyzed: 1 check the problems
   (done with none, or once a workset exists: warnings may be accepted), 2 a workset (its link puts the WebODM
   plan's settings in the form), 3 a task (the dataset's own or a workset's, linked on the Dashboard), 4 the map of
   the first processed task; the first not done in bold. The empty Worksets list says to choose settings (the
   plan's a good start) for those who can convert. No test changed; Jest 161; live (GETs only): the real dataset
   (✓ checked, ✓ 2 worksets, ✓ in a task, the map link), and as a new dataset (its worksets and tasks removed from
   the page's copy): the plan link filled the form (Normalize, −80°) on the Worksets tab.
5. The Thermal Task panel: 6 and its half of 4 (`thermal/ThermalTaskPanel.jsx`, one webpack rebuild; the workset
   form's side of 6 in `conversions.js`). Done, `ux-measurement`: the panel's order (emissivity, reflected, ambient,
   humidity, then distance) and words in both: "Distance to the target" with "Laser rangefinder, else as recorded",
   "As recorded", "Set for all photos"; "As recorded (0.91)" placeholders and "Recorded: 0.91" hints in the workset
   form too (its intro "Left empty, each photo keeps the value its camera recorded."); a distance chip reads
   "recorded distance"; the Problems advice and option names follow (`dataset.js`). The panel's first line points to
   the Thermal Analyzer. Tests changed (expected text only): `analyzer.test.js`, "shows what the flight recorded
   beside each measurement parameter…" (3 strings) and "shows the recorded values once an analysis running…"
   (2 strings). Jest 161 (measurement 11); JSX rebuilt in the dev container; live: the panel for 6 M4T photos (only
   `describe`, no task), the workset form's fields in the same order.
6. The Analyzer list: 12, 13 and its half of 4 (`datasets.js`, `datasets.html`). Done, `ux-analyzer-list`: the
   Worksets column reads "2" when all are ready, else "1 of 2 ready"; New Dataset says it is for checking a flight
   first and points to Thermal Task for a task straight away, as does the empty list; "The DJI thermal photos of a
   flight (the _T.JPG files)". Test changed (expected text only): `analyzer.test.js`, "filters the list by the
   search…", "1/2" → "1 of 2 ready". Jest 161; live (GETs only): the row, the dialog, the list shown empty.

All six steps done (2026-10-31). The Documentation phase is next; its screenshots show this UI.

## Up next: Thermal Inspector

**The request** (the user, 2026-10-30): "The thermal inspector is not showing on the 2d orthomosaics for any of the
tasks for the First Project." Not a bug: the earlier plugin's Pixel Inspector (shown as "Thermal Inspector") was
never ported, it was planned for after the Analyzer (below). WebODM's own map works and shows its Thermal layer on
the three tasks of First Project (each a single `lwir` band with alpha). Moved to Up next, "thermal inspector next".

**Builds on**: the earlier control (about 3,000 lines of JavaScript, 3,700 of Jest tests): the value under the
cursor, pinned points, region statistics, isotherms, a legend, image adjustment. It used three things of the fork
WebODM 3.3.2 lacks: the `point` and `region-stats` endpoints, the highlight colormaps (`hl_<mode>_<color>`) and the
`thermal_correction` tile parameter. WebODM 3.3.2 has the map hooks it needs (`PluginsAPI.Map.willAddControls`,
`handleClick`); the Analyzer's mosaics already draw tiles in any palette (`mosaics.rendered`).

**Decided** (the user, 2026-10-30):
- **Included**: the temperature under the cursor, pinned points, region statistics, isotherms and the legend, and
  **choosing the thermal layer's palette among every supported one** (DJI's and WebODM's). Not ported: the
  temperature correction (it needs WebODM's tiler).
- **Thermal layers only**: the control shows only when the map has a thermal orthophoto (an `lwir` band).
- **Pins and regions kept in the browser**, per viewer, for the same tasks, as before.
- **One unit for everything, WebODM's**: the inspector, the Analyzer and WebODM's own map share WebODM's unit
  setting (`unit_system`, kept in the browser; metric is °C, imperial °F), defaulting to WebODM's default (metric);
  changing it anywhere changes it everywhere. **Kelvin is dropped** from the Analyzer. The unit a user saved in the
  Analyzer becomes WebODM's setting once, in their browser, then is removed.
- **One palette for everything**: the Analyzer's preferred palette is the thermal map's palette, and choosing one
  on the map saves it as the preference.
- **DJI's palettes come from dji-thermal-cli**, which ships them as its own rebuilt tables (`tsdk/data`), so every
  thermal task offers them, with or without its frames. The CLI gets a public function for them first, released
  there, and the plugin pins that version (rather than reading the CLI's internal `tsdk.tables`).
  Changed (the user, 2026-10-31, when the palette lists' mismatch was reported as a bug): until that release is
  pinned, the plugin uses `palette_luts()` when the installed CLI has it, else the same built-in tables 1.9.0 holds
  (`tsdk.iirp_isp.pseudo_color_lut(tsdk.tables.load())`, what `palette_luts()` calls); the fallback goes with the pin.

**Steps** (each on its own branch, tested and merged):
1. **dji-thermal-cli** (merged in its `main` 2026-10-30, `palette-luts`, as `palette_luts()`, with a test against a
   flight frame; its release waits: see below): a public function giving DJI's palettes without a frame ({name: 256 RGB colours}, the iirp
   tables its palettes come from), tests, a `release/X.Y.0` branch (a minor version). The user pushes and tags;
   once it is on PyPI the plugin pins it, and the Analyzer's palettes can come from it too (no longer only from a
   workset's frames).
2. **The unit and palette shared**: the Analyzer's unit choice writes WebODM's `unit_system` and follows its change
   event (`onUnitSystemChanged`); °C and °F only; the saved unit migrated once and removed; the palette preference
   read and saved by the map through the existing `display` endpoint.
   **Done** (2026-10-30, `shared-unit-palette`): `analyzer_core.js` (`userUnit` is WebODM's alone, `setUserUnit`
   as WebODM's selector does it, `migrateUnit` on each Analyzer page, `savePalette`; the Preferences dialog's °C/°F
   and its palettes, DJI's then WebODM's; a page reloads when the unit changes in another tab); the viewer saves a
   temperature tab's palette; `conversions.py` (the preference is a palette of DJI's or WebODM's `COLORMAPS`; a unit
   saved before is handed to the page once), `mosaics.default_palette` (a WebODM colour map preferred); the Thermal
   Task form defaults to WebODM's unit. Django 121 (`app.tests.test_plugins` included), Jest 131. Live check on
   :8002 (the preference PUT intercepted, nothing saved): admin's saved °F became the browser's imperial units on an
   Analyzer page, WebODM's map then showed Imperial, the dialog offered °C/°F and the 20 palettes.
3. **The control, the value under the cursor, pins and the palette**: the plugin's own endpoints for a task the
   user can view (the orthophoto's value at a point; its tiles drawn in any palette and range); a control through
   `willAddControls` on maps with a thermal orthophoto; the palette chosen switches the thermal layer's tiles to
   the plugin's, keeping WebODM's layer panel (opacity, range) working; pins with CSV export.
   **Done, with WebODM's colour maps** (2026-10-30, `inspector-core`): DJI's palettes need the plugin's own tiles
   and the CLI's `palette_luts` (step 1: merged in dji-thermal-cli's `main`, not yet released), so they follow as
   step 3b. Built: `inspector.py` (`thermal_orthophoto`, `point`, `region`: rasterio on the orthophoto, its alpha
   band, the task's crop; WebODM 3.3.2's rio-tiler 2.1 lacks the reader the earlier control used),
   `inspector_api.py` (`projects/<id>/tasks/<id>/inspector/point` and `/region`, WebODM's `TaskNestedView`: viewers
   of the task, or a public task), `public/inspector.js` (a plain script like the viewer, added by `main.js` through
   `willAddControls` with WebODM's Leaflet; the readout, pins in `localStorage`, the palette applied to each
   thermal layer as it is added and followed through its tile URL, so a colour map chosen in WebODM's layer panel
   is saved too; clicks while pinning taken from WebODM's popup with `PluginsAPI.Map.onHandleClick`),
   `public/inspector.css`. Tests: `tests/test_inspector.py` (an orthophoto they write, UTM, known values: 7),
   `__tests__/inspector.test.js` (8) and `main.test.js`. Live check on the test flight's task map (the preference PUT
   intercepted): 30.41 °C under the cursor, two pins (33.77 and 50.36 °C) with no WebODM popup, jet chosen and drawn.
4. **Region statistics**: rectangle, circle and polygon; minimum, maximum, mean, percentiles, histogram, the
   hottest and coldest pixels marked; CSV; read at native resolution up to a size limit; the task's crop respected.
   **Done** (2026-10-31, `inspector-regions`): `public/regions.js` (the earlier drawing tool and its geometry as a
   plain script, `ThermalRegions`: WebODM's map has no drawing tool a plugin can use), the Regions section of
   `public/inspector.js` (R1, R2…, kept in `localStorage` beside the pins; statistics from step 3's `region`
   endpoint at the region's centre, a table and an SVG histogram; the hottest and coldest pixels as markers; CSV of
   a row per region; WebODM's popup kept off while drawing and for the click Leaflet fires after a drag; the panel
   kept within the map). Leaflet 1.3.1 (WebODM's) added to the dev dependencies for the tests. Tests:
   `__tests__/regions.test.js` (8, on real Leaflet), `inspector.test.js` (10). Live check on the test flight's
   map (read only; the regions removed afterwards): a rectangle (84,376 pixels, 11.48–53.99 °C, mean 30.32 °C), a
   circle and a polygon partly off the orthophoto, kept across a reload, no WebODM popup.
3b. **DJI's palettes on the map**: **Done** (2026-10-31, `inspector-dji-palettes`, a bug the user reported):
   `converter.palette_luts` (the CLI's, or 1.9.0's built-in tables, above), `inspector.tile` and
   `inspector/tiles/<z>/<x>/<y>` (`InspectorTiles`: the orthophoto's first band as WebODM's map draws it, bilinear,
   over `rescale`, `size` 256 or 512, the crop with `crop=1`, no data from the alpha band; `?palette=` one of DJI's).
   `inspector.js`: the Analyzer's list (`paletteOptions`, the same as `analyzer_core`'s, now exported); a DJI palette
   moves the layer's URL to the plugin's tiles and a colour map back to WebODM's (`withPalette`), range kept. WebODM's
   layer panel rebuilds the URL from its own colour map and range: a range change keeps the user's palette (DJI's
   too), a colour map chosen there is saved, one of WebODM's not in the list (rdylgn, spectral…) is drawn but not
   saved and shown in the inspector's list. Fixed on the way: a range change in WebODM's panel used to reset the
   palette to the one that panel showed. Tests: `test_inspector.py` (11: the tables, the tiles' colours, alpha, crop,
   512, refusals), `inspector.test.js` (13). Live check on the test flight's map (preference PUTs intercepted):
   19 palettes listed as the Analyzer's, DJI hotiron drawn by the plugin's tiles (200s), viridis chosen in WebODM's
   panel saved and back on WebODM's tiles, spectral drawn and not saved.
5. **Isotherms and the legend**: above, below or between limits, drawn by the plugin's tiles; the colour bar of the
   palette and range in the shared unit.
   **Done** (2026-10-31, `inspector-isotherms-legend`): `inspector.isotherm` and `inspector/isotherm/<z>/<x>/<y>`
   (`InspectorIsotherm`: `low` and/or `high` in °C, `color` RRGGBB, the thermal tiles' size and crop; reads the tile
   as `inspector.tile` does, both through `_tile_data`), `inspector/palette?name=` (`InspectorPalette`: a palette's
   256 colours, DJI's or any of WebODM's colour maps, encoded as WebODM's tiler gives them). `public/scale.js`
   (`ThermalScale`: the viewer's colour-scale gradient and round ticks, moved out of `viewer.js` for both).
   `inspector.js`: the Isotherm section (Off, Above, Below, Between; limits typed in the user's unit, kept in °C;
   six colours; started within the layer's range; kept in `localStorage` per tasks), an overlay layer over each
   thermal layer with its tiling and hidden with it (WebODM's `hide`/`show` followed); the legend control at the top
   left (WebODM's buttons cover the bottom corners) for the topmost thermal layer shown: palette, range from its
   URL, ticks in the user's unit, the isotherm's part outlined in its colour; "Legend on the map" remembered.
   Tests: `test_inspector.py` (14: the isotherm's colours, alpha and crop, its refusals, the palette's colours),
   `inspector.test.js` (18). Live check on the test flight's map (preference PUTs intercepted; a fresh browser
   profile, so nothing kept): the legend of the saved palette (DJI arctic, 10–50 °C); above 40 °C painted in red,
   then 40–45 °C in blue over DJI hotiron, isotherm tiles all 200s; in imperial the legend in °F (60–120) and the
   limits 104 and 113 °F; the legend hidden; Off removed the overlay; no console errors.

**Fixed** (2026-10-31, the user: "we should definitely fix the cli"): dji-thermal-cli's
`test_process_writes_r_jpegs_with_the_parameters_used` (flight data) failed on its `main` before `palette-luts` too:
the R-JPEG copy's picture is exactly Pillow's JPEG of the pseudo output (quality 92, 4:2:0), but the test held it
within 4 of the uncompressed output, and on the flight's first frame compression alone loses 7.2. The test now
compares with that JPEG (`fix-rjpeg-picture-test`, merged in its `main`; its full suite: 1191 passed, 10 skipped).
Released as 1.10.0 (the user, 2026-10-31: 1.9.2, never published, folded in; published by its release workflow,
which now runs CI first, see below); the plugin pins it and `converter.palette_luts` is the library's alone
(`pin-cli-1.10.0`; Django 135 on 1.10.0, live check on the test flight: DJI palettes and isotherms drawn).

**Fixed** (2026-10-31, the user agreed to the plugin doing it): WebODM installs a plugin's requirements with `pip
install -U --target`, which leaves the old version's `dji_thermal_cli-X.dist-info` beside the new one when the pin
changes; the library reads its version from that metadata, so after an upgrade the old version would be named in
converted TIFFs' Software tag, the reports and the SDK page. `Plugin.check_requirements` now calls
`converter.remove_stale_metadata` after WebODM's install: in its own site-packages, the metadata of any package
`requirements.txt` pins at another version, once the pinned version is installed (`stale-package-metadata`; tests in
`test_converter.py`, `TestStaleMetadata`; on the dev server a planted 1.9.0 folder was removed on reload).

**Tests**: the Jest tests ported (rewritten without Enzyme, which this repo doesn't have), Django tests of the
endpoints on the flight's orthophoto (`DT_FLIGHT_DIR`), the CLI's own tests for its function; live checks on
First Project's three tasks (read only, thumbnails blocked).

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
The Pixel Inspector moved ahead, as the Thermal Inspector (2026-10-30, "Up next: Thermal Inspector" above).

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
