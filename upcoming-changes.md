# Upcoming changes

## Phases (current and upcoming)

**Up next**
- **The user's testing and polishing** (2026-10-30): bugs and polish they report go here, each fixed on its own
  branch. Publishing 1.0.0 waits for it.
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
    HomerunObliqueII: a preset saved, saved again with a box unticked (asked, replaced, still one), then deleted
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
    `test_analyzer.py` `TestDatasetFiles` (3). Live check on HomerunObliqueII (GETs and the zip only): hover, a
    selection kept while hovering, a single download (872 KB), a Shift range of 4 and its zip, Esc.
    Then (the user, 2026-10-31, `detail-pane-palette`): the pane shows the palette picture, not DJI's embedded one:
    `thumbnail?size=large` (the frame's own size, cached beside the thumbnails), in the user's DJI palette, or the
    frame's own when theirs is one of WebODM's; Download still gives the file as uploaded.
  - Done: **Workset wording and layout** (the user, 2026-10-31, from `new.md`), `workset-wording-layout`; the
    Harmonized wording agreed with "made to agree on temperature" (so it doesn't suggest other attributes change);
    the WebODM plan's "Convert with these" became "Use these settings" (it fills the form, it doesn't create);
    `analyzer_core.sortRows` (moved from `dataset.js`) sorts both the Files tab and a workset's Files (Image and
    Result; Outputs and Notes not). Jest 159; live check on HomerunObliqueII (GETs only, a fresh browser profile):
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
    The user's own orthophotos are within their frames' range (HomerunObliqueII's frames -45.4 to 65.0 °C with sky in
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
    tagged the user's "HomerunObliqueII - default-webodm-recommendations", whose panel now has the button.
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
    seen on the user's "HomerunObliqueII - default-webodm-recommendations" and a check task). **WebODM's own, by
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
    section's caret drawn by the plugin (WebODM hid the browser's). Jest 122; live check on HomerunObliqueII (read
    only): the tabs Worksets, Files, Problems, WebODM plan, opened on Worksets; no console error.

- **Thermal Inspector** (the user, 2026-10-30): the earlier Pixel Inspector ported as a control on WebODM's 2D map,
  for thermal orthophotos, with the palette and unit shared with the Analyzer; in five steps (details under
  "Up next: Thermal Inspector" below). Lands in 1.0.0 if that is not published first, else in 1.1.0. Steps 2–5
  and 3b done (the last, isotherms and the legend, 2026-10-31), and dji-thermal-cli 1.10.0 pinned with the fallback
  to its internal tables dropped (2026-10-31, `pin-cli-1.10.0`). Done.
- **Linux, Windows and macOS** (the user, 2026-10-31, from `new.md`; details under "Done: Linux, Windows and
  macOS" below): the plugin works on every way WebODM is installed: Docker on all three systems (the macOS
  installer runs Docker), and the native Windows installer, checked end to end there. Done.
- **Picture viewer in the Files view** (the user, 2026-10-31, from `new.md`; details under "Done: Picture
  viewer" below): clicking the picture in the Files view's detail pane opens it in a window on the page, with a
  close button and basic controls, instead of a new tab. Done.
- **UX review** (the user, 2026-10-31, from `new.md`: "how would you make this ui more intuitive?"; details under
  "Done: UX review" below): a review of every page and control the plugin adds, proposals for the user to choose
  from, then the chosen ones built. Done: the review, all 13 proposals in six steps, and a bug it found.
- **Documentation** (the user, 2026-10-31, from `new.md`; details under "Done: Documentation" below): the docs
  hosted from this GitHub repo, with quickstart tutorials and screenshots, kept current with every feature change.
  Done; GitHub Pages is turned on by the user once the repo is public.

- **The mosaic viewer's image controls** (the user, 2026-10-31, from a screenshot of dji-thermal-ui's viewer panel:
  "How much of this can be built into the mosaic/harmonized/source frame viewers?"; details under "Done: The
  mosaic viewer's image controls" below): the frame pixel under the cursor, brightness, contrast, gamma,
  sharpening, Linear/Equalized, an isotherm, and a click keeping the readout with "Follow the cursor". Done
  (2026-11-01), in four steps.

- **Thermal Analyzer, part 2** (the user, 2026-11-01; details under "Up next: Thermal Analyzer, part 2" below):
  the workset mosaics laid on WebODM's 2D map from the Thermal Inspector (for comparing with any task's layers), the
  source frames window, measuring tools and saved measurements there, and the frame page. In five steps; steps 1
  (the mosaics on the map), 2 (the source frames window), 3 (measuring: lines, surroundings, ΔT) and 4 (saved
  measurements, the emissivity correction) done 2026-11-01; step 5 (the frame page) is next.

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

**Last**
- **Publish 1.0.0**, the final step, when the user says so: after any change to `dji-thermal/`, the release is redone
  (CHANGELOG, README, the zip rebuilt by `dev/package.sh` on the merge, its new sha256, the `release-check` skill);
  then the user tags `v1.0.0`, attaches the zip to the GitHub release and adds `{url, sha256}` to WebODM-Plugins'
  `directory.json` (details under "Done: Release 1.0.0" below).

**Later**
- **Server-folder datasets** for administrators (photos read in place on the server), in the Analyzer; replaces
  the earlier "Folder conversion" item (below).

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

## Up next: Thermal Analyzer, part 2

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
   Django 135 (1 skipped), ESLint, Ruff; live on HomerunObliqueII (project 1's map): laid by the link, hover, the
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
   the list's `tasks`). Jest 173, Django 137 (1 skipped), ESLint, Ruff; live on project 1: HomerunObliqueII's task
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
   share's test seen failing with the upper limit ignored. Live on project 1 (read only): HomerunObliqueII's
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
   Live on project 1 (it wrote, then deleted what it saved and the files it made): HomerunObliqueII's orthophoto
   (baseline 0.91, 21.06 °C from its TIFFs; a rectangle at emissivity 0.8, mean 40.05 to 42.38 °C; saved with a
   comment, a pin saved; back after a reload, renamed) and its workset's mosaic (a rectangle saved); deleted through
   the panel; no console errors. Docs: README, `index.md`, the Inspector quickstart's sections 6 and 7,
   `measurement.md`, `api.md`; screenshots `inspector` retaken, `inspector-saved` new (the form filled, not sent).
5. **The frame page**: one frame with the Image and Isotherm sections, the tools in its pixels, and measured again
   exactly by dji-thermal-cli with changed parameters (dji-thermal-ui's `measure_frame`, `parse_changes`).

Open, to check in step 1: the Inspector's palette and range are per thermal layer today; a mosaic laid beside an
orthophoto takes the same palette, and its own range unless the user links them.

## Done: The mosaic viewer's image controls

**Request** (the user, 2026-10-31): dji-thermal-ui's viewer panel (`~/gitrepos/python/dji-thermal-ui`,
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
HomerunObliqueII, and README and docs (`docs/`, screenshots retaken):
1. **Frame pixel**: `mosaics.point` reads bands 4 and 5 (`source_u`, `source_v`, written by dji-thermal-cli since
   1.4.0; the dev server's mosaics have them) as `frame_pixel`; the readout shows "Frame pixel x, y" (none for a
   mosaic without them).
   **Done** (2026-10-31, `viewer-frame-pixel`): `mosaics.point` (as dji-thermal-ui's `api.py`), `viewer.js`
   `readoutHtml` (as its `panel.tsx`); README, `docs/quickstart-worksets.md`, `docs/api.md`, screenshot
   `mosaic-viewer` retaken. Tests (agreed): `test_analyzer.py`'s mosaic test (the frame pixel as the frames window
   finds it, none outside), `analyzer.test.js`'s readout test. Django 134 (1 skipped: Windows only), Jest 161,
   ESLint, Ruff; live on HomerunObliqueII: the row shows, matching the frames window's pixel within one.
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
   HomerunObliqueII: each slider, Equalized and Reset, on Mosaic, Harmonized and View angle, and the frames
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
   only), Jest 165, ESLint, Ruff; live on HomerunObliqueII: Above 40 and Between 20–30 on the map and in the frames
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
`test_analyzer` (58). Live check on HomerunObliqueII (GETs only, no thumbnail added to the cache): opened at frame 2
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

**The review** (2026-10-31): every page walked through in a headless browser at 1440×900 on HomerunObliqueII, read
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
   `__tests__/inspector.test.js` (8) and `main.test.js`. Live check on HomerunObliqueII's task map (the preference PUT
   intercepted): 30.41 °C under the cursor, two pins (33.77 and 50.36 °C) with no WebODM popup, jet chosen and drawn.
4. **Region statistics**: rectangle, circle and polygon; minimum, maximum, mean, percentiles, histogram, the
   hottest and coldest pixels marked; CSV; read at native resolution up to a size limit; the task's crop respected.
   **Done** (2026-10-31, `inspector-regions`): `public/regions.js` (the earlier drawing tool and its geometry as a
   plain script, `ThermalRegions`: WebODM's map has no drawing tool a plugin can use), the Regions section of
   `public/inspector.js` (R1, R2…, kept in `localStorage` beside the pins; statistics from step 3's `region`
   endpoint at the region's centre, a table and an SVG histogram; the hottest and coldest pixels as markers; CSV of
   a row per region; WebODM's popup kept off while drawing and for the click Leaflet fires after a drag; the panel
   kept within the map). Leaflet 1.3.1 (WebODM's) added to the dev dependencies for the tests. Tests:
   `__tests__/regions.test.js` (8, on real Leaflet), `inspector.test.js` (10). Live check on HomerunObliqueII's
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
   512, refusals), `inspector.test.js` (13). Live check on HomerunObliqueII's map (preference PUTs intercepted):
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
   `inspector.test.js` (18). Live check on HomerunObliqueII's map (preference PUTs intercepted; a fresh browser
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
(`pin-cli-1.10.0`; Django 135 on 1.10.0, live check on HomerunObliqueII: DJI palettes and isotherms drawn).

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
