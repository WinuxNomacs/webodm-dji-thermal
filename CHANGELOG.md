# Changelog

## 1.3.0 (2026-11-12)

For WebODM 3.3.2 and 4.0.0, in Docker (Linux, Windows, macOS) or from its native Windows installer.

**New**

- **The ΔT tool**, after Hover in the Thermal Inspector and first on the frame page: click two spots, read the
  difference between them (second less first, corrected where a correction is set), save it, list it and export it
  as boxes and lines are. In the Inspector the two spots may be on two orthophotos either side of the divider (that
  ΔT is kept for the visit, not saved).
- **Ortho Overlays** in the Thermal Inspector: the project's other orthophotos, RGB or thermal, laid over the map
  with opacity, Swipe and Zoom to; a thermal one is read by the pointer and the measuring tools, so two flights can
  be compared. **Mosaic Overlays** is now a dropdown (“1 of 5 shown”) too, both at the end of the panel.
- **The overlays' own divider**: horizontal or vertical (its button, or a right-click on its handle), each overlay
  on the side you pick; readings and measurements follow it, each drawn only where its layer shows, as they do with
  WebODM's own divider.
- **One Measurements section** in the Inspector: pins, ΔTs, boxes, circles, polygons and lines in one list, with one
  Hide, one CSV (with a shape column) and one Remove all.
- **Pointer Info** (was “Under the cursor”), with **Temperature On Pointer**: the temperature in a small label beside
  the pointer, off unless ticked, kept with your preferences; on the mosaic viewer, the frame page and the Inspector.
- **Banded** in the Image section, on every page: flat bands of a set width in your unit (Auto picks a round width,
  steppable at once), for reading temperatures from colours.
- Hover and Pin are icons with tooltips, all the Inspector's tools on one row, each saying how it draws.

**Removed**

- **Equalized** (the colours stretched by the histogram), not useful for measuring: a view saved with it opens Linear.
- **ΔT from surroundings** under the cursor, replaced by the ΔT tool. Intensify stays.

**Fixed and made sturdier**

- A Thermal Task's upload is sent again when WebODM's proxy answers that it's restarting (502, 503, 504), and leaving
  the dashboard during the upload asks first.
- On a phone, the Analyzer's lists and tables scroll in their own box, not the whole page, and the Inspector's panel
  stops above the map's zoom buttons.
- With a correction set, the label beside the pointer shows the corrected temperature, as the panel does.
- Letting go of a divider off its handle no longer clicks the map; the divider takes turns with other plugins'.
- An isotherm reuses its layer's temperature tiles instead of fetching them again.

## 1.2.0 (2026-11-08)

The plugin's name is now **DJI Thermal Analyzer** (its id and folder stay `dji-thermal`, so upgrading keeps its
data). For WebODM 3.3.2 and 4.0.0, in Docker (Linux, Windows, macOS) or from its native Windows installer.

**New**

- **Intensify**, a mosaic viewer tab: the harmonized mosaic, each pixel less the median temperature within about
  2 m, so a narrow cooler or warmer feature (a seam letting air in) stands out wherever it is, in a blue-white-red
  palette centred on 0.
- **ΔT from surroundings** under the cursor: how much warmer or cooler a point is than the median within about 2 m,
  in the mosaic viewer, the frame page (with Measure again, for both measurements) and the Thermal Inspector.
- **The temperature unit (°C or °F) in WebODM's header**, beside the user icon, kept for your WebODM account; an
  administrator sets the default on the DJI Thermal page under Administration (°C unless set).
- **The colour range's arrows as a D-pad**: ◀ and ▶ narrow or widen the range, ▲ and ▼ raise or lower it (never past
  the hottest or coldest temperature), **Auto** in the middle.
- **Large thumbnails in the frame page's list**, with a Thumbnails box to list the names only.
- A workset's frames are drawn in the palette it chose (else yours), in its Files and on the frame page.
- A Community section (WebODM's Discord) and a Thanks section in the README; a developers' guide
  (`docs/developing.md`).

**Fixed and made sturdier**

- The Thermal Inspector's button shows only on maps with temperatures, not on the RGB maps of a project with
  mosaics; its scripts load on map pages only.
- A public map no longer asks for the user's preferences (refused for anonymous viewers).
- A workset's frames open on the frame page before the dataset is analyzed.
- Mosaics built again replace those built before only once built: if building them fails or is canceled, the
  workset keeps the ones it had.
- Images can't be added to a dataset while a workset converts or builds its mosaics (the page says why).
- A damaged thermal frame is counted in a workset as skipped, with the reason, not as not thermal.
- A job whose worker stopped fails within seconds; one queued while no worker runs says so.
- The Administration page says why when dji-thermal-cli can't be loaded.
- A full disk leaves no part of an image in a dataset, and says so; a large mosaic is never read whole.
- The Analyzer's list says why it couldn't load; an upload refused with a reason stops and says it; the mosaic
  viewer says when its readout never reached the server.
- DJI Thermal Task converts two photos at a time, leaving a small server room for other pages; pages poll less
  often in a background tab; cached pictures nobody has viewed for two weeks are deleted.
- An error in the plugin's task-deletion hook no longer stops WebODM deleting a task; a thumbnail asked for twice
  at once no longer fails.
- The documentation reviewed against the plugin as it is, and its screenshots retaken.

## 1.1.0 (2026-11-05)

**WebODM 4.0.0**, as well as 3.3.2, in Docker (Linux, Windows, macOS) or from its native Windows installer.

- The plugin runs on WebODM 4.0.0 (Python 3.14, Django 5.2, no PostGIS): WebODM installs numpy and Pillow at the
  versions of its own Python (3.9 for 3.3.2, 3.14 for 4.0.0).
- **Upgrading WebODM** from 3.x to 4.0.0 with the plugin installed: WebODM installs the plugin's packages again for
  its new Python by itself.
- The palettes WebODM 4.0.0 no longer has (hot, rainbow, gray_r) stay available: the plugin carries its own copies.
- Shapes (the Thermal Inspector's regions and lines, the frame page's figures, a task's crop) are measured with
  WebODM's own GDAL, so the plugin installs no compiled package of its own, and on native Windows it can be removed
  in Administration > Plugins without restarting WebODM.
- A line of one point is answered "A line needs two points".
- **Installing**: after loading a new version of the plugin, restart WebODM so it runs the new one (it keeps the
  version it started with).

## 1.0.0 (2026-11-02)

The first release, for WebODM 3.3.2 or later, in Docker (Linux, Windows, macOS) or from its native Windows
installer.

**DJI Thermal Task**, a button beside WebODM's "Select Images and GCP"

- Pick a flight's photos (and a GCP file); the DJI thermal R-JPEGs among them are found by their content, the RGB
  photos are ignored and not uploaded.
- Each thermal photo is converted on upload into a single-band float32 TIFF of temperatures in degrees Celsius,
  with the photo's GPS, camera and gimbal metadata and marked as a thermal band, so WebODM processes the task into
  a thermal orthophoto.
- **Only frames looking down** (a gimbal pitch limit, -80° by default), **Normalize** and **Harmonize** (through a
  workset of the task's dataset, the task then starting by itself, with its progress shown), and the task's
  palette.
- **Measurement** settings: emissivity, reflected and ambient temperature, humidity, in °C, °F or K, within each
  camera's ranges; left empty, each photo keeps its recorded value. Distance: the laser rangefinder's by default,
  else the recorded one, or one distance for all photos. The values used are recorded in each TIFF's XMP.
- The task's options start as the WebODM plan's; a photo that fails is left out with its reason; a GCP file,
  `geo.txt` and `image_groups.txt` get the converted images' names.
- **Also keep the photos in a DJI Thermal Analyzer dataset**, or **Create thermal dataset** on a task's panel
  later.

**DJI Thermal Analyzer**, in WebODM's menu

- **Datasets** of a flight's photos (or a folder, its subfolders kept) in any project you can view, shared as the
  project is, counted in its owner's quota, kept in a task of the project.
- **Analysis** by dji-thermal-cli's check, in WebODM's worker: a summary per camera, the files with their capture
  data and temperatures (a detail pane, a picture viewer, downloads, removing files), the problems found and what
  addresses them, and a WebODM plan (coverage, task options, saved as a WebODM preset).
- **Worksets** with every dji-thermal-cli setting (frames, outputs, measurement, colours, adjustments), kept side by
  side, each with its files measured (thumbnails, figures, a detail pane, removing frames), downloaded as a zip or
  file by file; each user's defaults saved.
- **Mosaics** of a workset (as converted and harmonized), placed from the frames' positions with no WebODM task (a
  harmonized workset's with Harmonize's alignment, not aligned again), in a map viewer: palettes, range and image
  adjustments changed live, an isotherm, the temperature, frame and view angle under the cursor, the frames that saw
  a point, the reports and files.
- **The frame page**: one frame at a time, measured in its pixels (pins, lines, regions), measurements saved on it,
  and measured again with other parameters by dji-thermal-cli.
- **Create task** from a workset (its °C TIFFs in a WebODM task of the project, with the plan's ODM options as
  ticked), or **Use for parent task** to process the dataset's own task again with another workset.
- **Preferences**: a temperature unit (WebODM's own), a palette, and the Thermal Inspector's legend, for each user.

**Thermal Inspector**, on WebODM's 2D map of a thermal orthophoto

- The temperature under the cursor, pins, and the statistics of regions and lines (their surroundings and ΔT, a
  line's profile, a histogram), downloaded as CSV; measurements saved for the project, also as GeoJSON.
- The map's palette (DJI's and WebODM's), colour scale and range, image adjustments, an isotherm and a legend.
- An approximate correction for another emissivity and reflected temperature (**Manual Corrections**).
- **Mosaic Overlays**: the Analyzer's workset mosaics laid on the map, with opacity and swipe; and the frames that
  saw a point clicked.

**DJI's own Thermal SDK**

- A **DJI Thermal** page under Administration, for superusers: upload DJI's Thermal SDK 1.8 zip (checked on its
  sample images) to have DJI's own library compute the temperatures, or `DJI_THERMAL_SDK_DIR` at deployment. It
  runs in a process of its own; without it, dji-thermal-cli's built-in port is used.

**Cameras**: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S (temperatures by
[dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/) 1.12.0). The M4T checked on a real flight, the others
on DJI's Thermal SDK sample images. The server calls no outside service.
