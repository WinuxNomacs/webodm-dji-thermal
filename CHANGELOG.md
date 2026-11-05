# Changelog

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
