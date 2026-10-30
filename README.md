# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps: the plugin's **Thermal Task**
button converts each R-JPEG into a temperature image (degrees Celsius) as it is uploaded, with measurement
settings you can change, then WebODM processes them like any other task. Its **Thermal Analyzer** checks a flight's
photos before you process them (what each one is, the problems found and the WebODM options to use) and converts
them with every dji-thermal-cli setting, several conversions side by side.

**In development**: nothing is released yet. See [upcoming-changes.md](upcoming-changes.md) for the plan.

Temperatures are computed with [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/), a pure-Python
implementation of DJI's Thermal SDK: no native library and no outside service. An administrator can have DJI's own
SDK compute them instead (see [DJI's own Thermal SDK](#djis-own-thermal-sdk)).

## Using it

1. In a project on the dashboard, press **Thermal Task** (beside "Select Images and GCP") and pick the flight's
   photos, all of them if you like, and a GCP file if you have one. The plugin finds the thermal R-JPEGs among
   them by their content; the RGB photos taken with them are ignored and not uploaded.
2. **Measurement**: the values the temperatures are computed with. Each field shows the value the camera recorded
   and the range the camera accepts; left empty, every photo keeps its own recorded value.
   - **Temperature unit** of the values you enter: Celsius or Fahrenheit, by default WebODM's unit system. The
     task's images are always in degrees Celsius.
   - **Emissivity**, **reflected temperature**, **ambient temperature** (the H20T and XT S do not use it, and the
     form says so) and **relative humidity**.
   - **Distance** to the subject: by default each photo's laser rangefinder distance where it has a valid one
     (each photo of the M4T flight checked has one; DJI's sample images have none), else the distance the camera
     recorded (usually 5 m, whatever the flight height). Or the recorded distance, or one distance for all photos. With the rangefinder's distance, the
     temperatures differ slightly from DJI's own apps, which use the recorded one.
3. Below it, WebODM's own task panel: name, processing node, options and the photos on the map. Images are not
   resized: the thermal frames keep their size. **Review**, then **Start Processing**.
4. Each photo is converted as it is uploaded, a few at a time. A photo that fails is left out with its reason;
   the task then processes the others. A GCP file, `geo.txt` and `image_groups.txt` go in with the photos' names
   changed to the converted images' (`DJI_0001_T.JPG` becomes `DJI_0001_T.tif`).

The task's name is suggested from the first photo's date. WebODM's own upload also looks the place up on
OpenStreetMap's Nominatim; the Thermal Task does not, as the plugin calls no outside service.

## The Thermal Analyzer

**Thermal Analyzer**, in WebODM's menu, lists the thermal datasets of every project you can view.

1. **New Dataset**: a name, the project and the flight's photos (or their folder, whose subfolders are kept; you
   can also drop them on the page). Only JPEGs are uploaded; the RGB photos taken with the thermal ones are listed,
   not analyzed. The photos are then analyzed with dji-thermal-cli's check, in WebODM's worker, with its progress
   and a Cancel button.
2. **The dataset's page**: the frames, cameras, temperatures, capture times and height at a glance, then
   - **Files**: every file with its capture time, height, gimbal pitch, temperatures, distance (recorded and the
     rangefinder's) and emissivity, and the problems that name it; filtered by name, by kind or to those with
     problems, sorted by any column, with thumbnails if you like.
   - **Problems**: what dji-thermal-cli found (errors, warnings, notes), each with what addresses it and the files it
     names.
   - **WebODM plan**: how well the frames cover the ground, the task options to use (to copy) and the
     dji-thermal-cli command that prepares the images.
   - **Convert**: the images converted with dji-thermal-cli's settings, in WebODM's worker, with progress and Cancel:
     the outputs (temperature TIFFs in °C, °F or K, pseudo-colour PNGs, gray16, raw counts, DJI R-JPEGs and the
     others dji-thermal-cli writes) and their compression, the palette and colour range, each measurement parameter
     (each field shows the flight's recorded median; empty keeps each image's own), the unit of the files,
     normalization (one ambient and reflected temperature for every frame, each frame's drift removed), a gimbal
     pitch limit for nadir frames only, gimbal overrides, replacing temperatures above or below a threshold, and
     stripping the location. **Use the WebODM plan's settings** fills in what the plan recommends; **Save as my
     defaults** keeps your settings for new conversions (**Reset to defaults** goes back to dji-thermal-cli's). Each
     conversion is kept beside the others, with what it changed from the defaults, its files (each image's outputs
     and why any was skipped) and **Download all** (a zip) or each file. DJI's own SDK measures them when an
     administrator has installed it.
   - **Mosaics** (on by default in the settings, or **Build mosaics** from a conversion's menu): after converting,
     dji-thermal-cli places the frames side by side from their positions and angles, with no WebODM task needed,
     as converted and harmonized (normalized, each frame's offset against its neighbours removed). **View mosaics**
     shows them on a map over WebODM's base layers, a tab each, with the frame each pixel comes from and the angle
     it was seen at: the palette (the usual ones and the DJI palettes of the images) and the range changed live,
     with its colour scale and **Auto** (the 2nd to 98th percentile), the temperature, frame and view angle under
     the cursor, and what dji-thermal-cli reports (seams, misalignment, frame offsets, heights) with the mosaic
     files to download (also in the conversion's zip).
3. **Add images**, **Analyze again**, **Rename**, **Copy link** and **Delete** on the dataset's page; adding images
   marks the analysis out of date until it is run again. A conversion can be renamed and deleted from its menu.

A dataset is kept in a task of its project, named "Thermal dataset: *name*", which WebODM never processes: it
shows in the project's task list with "Set a processing node" (leave it unset). It is shared as the project is
(viewing the project shows the dataset, changing it allows adding images and analyzing, deleting the dataset needs
the project's delete permission), its photos and conversions count toward the project owner's storage quota (no
upload or conversion once the owner is over it), and it goes when that task or the project is deleted. Temperatures are shown in degrees
Celsius, or Fahrenheit with WebODM's imperial units.

## The converted images

Each thermal R-JPEG becomes a single-band 32-bit float TIFF of its temperatures in degrees Celsius, measured with
the Measurement settings above. It keeps the photo's EXIF and DJI XMP metadata that ODM uses (GPS, altitudes,
capture time, camera and gimbal angles, RTK accuracy) and is marked as a thermal band (`Camera:BandName` =
`LWIR`), so ODM processes it as thermal. Its XMP also records how it was measured, as dji-thermal-cli's own
outputs do (namespace `urn:dji-thermal-cli:xmp:1.0`): `Distance`, `DistanceSource` (`rangefinder`, `embedded` or
`option`), `Emissivity`, `Humidity`, `ReflectedTemperatureC`, `AmbientTemperatureC` and `Software`. The photos
themselves are not kept.

## DJI's own Thermal SDK

By default the temperatures come from dji-thermal-cli's built-in port of DJI's Thermal SDK v1.8, which gives the
same results as DJI's own SDK on DJI's sample images. If you prefer DJI's own library, it can compute every
photo's temperatures instead. The **DJI Thermal** page, under **Administration** in WebODM's menu (for
superusers only), shows which of the two is in use and changes it:

- **Upload** the [DJI Thermal SDK](https://www.dji.com/downloads/softwares/dji-thermal-sdk) zip as DJI's site gives
  it (version 1.8; another version is refused). The plugin keeps only the libraries for the server (Linux x64 in
  WebODM's Docker install), DJI's `License.txt` and one sample image per camera, and checks the SDK measures those
  samples before using it. DJI's license terms apply to the SDK; the plugin does not include it.
- **Update** replaces it with a newer zip, **Check** measures the samples again, **Remove** goes back to the
  built-in port.
- **At deployment**, `DJI_THERMAL_SDK_DIR` on WebODM's webapp container can name a folder for the SDK (an
  unpacked SDK, or an empty folder the page's upload then fills; WebODM must be able to write to it for Update). It
  wins over an upload. If it names a folder without the SDK, photos fail with that reason rather than being
  measured by another SDK.

DJI's library runs in a process of its own, never in WebODM's: if it crashes on a photo, that photo fails with
the reason and the others go on. A converted image records which SDK measured it in its XMP `Software` tag.

## Cameras

Every camera dji-thermal-cli decodes: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S. The M4T has been
checked on a real flight; the others on DJI's Thermal SDK sample images only.

## Developing

`CLAUDE.md` describes the dev environment (WebODM in Docker on port 8002, `dev/webodm.sh`) and the checks.

The plugin's parts: `converter.py` (R-JPEG to TIFF), `api.py` (its API, under `/api/plugins/dji-thermal/`:
`describe` a photo's camera, recorded values and ranges; `projects/<id>/tasks/<id>/convert` one photo into a
partial task, with WebODM's project permission), `sdk.py` with `page.py` and `templates/sdk.html` (DJI's own SDK
and the DJI Thermal page, `/plugins/dji-thermal/sdk/`), the Thermal Analyzer (`datasets.py`: the holder tasks and
their records; `analysis.py`: the analysis job, run by WebODM's worker; `conversions.py`: the conversions, their
settings and job, and each user's defaults; `mosaics.py`: a conversion's mosaics, their job, and the viewer's tiles
and values with WebODM's rio-tiler; `analyzer_api.py`: its API under `/api/plugins/dji-thermal/datasets`;
`analyzer_pages.py` with `templates/datasets.html`, `dataset.html` and `viewer.html`: its pages,
`/plugins/dji-thermal/`, `/plugins/dji-thermal/dataset/<id>` and its conversions' mosaics,
`.../dataset/<id>/conversion/<id>`), and `public/` (`main.js`, which adds the button and the DJI Thermal page's link
under Administration; `analyzer_core.js`, `datasets.js`, `dataset.js`, `conversions.js`, `viewer.js` and
`analyzer.css`, the Analyzer's pages, plain scripts; and `thermal/`, the button and panel (JSX) and WebODM's own
Leaflet for the viewer (`Leaflet.js`), built by WebODM's webpack when the plugin is installed).

The tests never use images or DJI's files from this repository: none is committed or published. Those that need
real R-JPEGs or DJI's SDK read them from your machine, set in an untracked `.env` file at the repo root, and are
skipped when these are not set:

```
DT_SAMPLES_DIR=/path/to/dji_thermal_sdk/dataset   # DJI's Thermal SDK sample images, one folder per camera
DT_FLIGHT_DIR=/path/to/a/flight                   # a real flight's photos, thermal and RGB, in any subfolders
DT_SDK_ZIP=/path/to/dji_thermal_sdk_v1.8.zip      # DJI's Thermal SDK zip as DJI's site gives it
```

`dev/webodm.sh up` mounts them read-only in the dev containers.

## License

[AGPL-3.0](LICENSE).
