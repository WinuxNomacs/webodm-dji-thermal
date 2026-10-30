# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps. The plugin gives two ways in:

- **Thermal Task**, a button beside WebODM's "Select Images and GCP": the quick path. Each R-JPEG is converted into a
  temperature image (degrees Celsius) as it is uploaded, with measurement settings you can change, then WebODM
  processes them like any other task.
- **Thermal Analyzer**, in WebODM's menu: for a flight you want to look at first. It checks the photos (what each one
  is, the problems found, the WebODM options to use), converts them with every dji-thermal-cli setting (several
  worksets side by side), places the frames into mosaics shown on a map, and makes a WebODM task from the
  workset you choose.

Temperatures are computed with [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/), a pure-Python
implementation of DJI's Thermal SDK: no native library and no outside service. An administrator can have DJI's own
SDK compute them instead (see [DJI's own Thermal SDK](#djis-own-thermal-sdk)).

## Installing

WebODM 3.3.2 or later. Checked on WebODM's Docker install.

- **From WebODM's plugin list**: Administration > Plugins, find DJI Thermal, install it. WebODM installs without
  webpack (the native ones) get the copy the plugin list builds for them.
- **From a release**: download `dji-thermal-X.Y.Z.zip` from this repository's
  [releases](https://github.com/WinuxNomacs/webodm-dji-thermal/releases) (its sha256 is given there), then
  Administration > Plugins > **Load Plugin (.zip)**. The plugin's scripts are then built by WebODM's webpack,
  which the Docker install has.

WebODM installs the plugin's requirements in the plugin's own folder: dji-thermal-cli, with numpy and Pillow at
WebODM's own versions. Restart WebODM if it asks you to.

The plugin calls no outside service: photos are converted, analyzed and mosaicked on your WebODM server. The mosaic
viewer's base layers are WebODM's own, loaded by your browser as on WebODM's other maps.

## The Thermal Task

1. In a project on the dashboard, press **Thermal Task** and pick the flight's photos, all of them if you like, and a
   GCP file if you have one. The plugin finds the thermal R-JPEGs among them by their content; the RGB photos taken
   with them are ignored and not uploaded.
2. **Measurement**: the values the temperatures are computed with. Each field shows the value the camera recorded
   and the range the camera accepts; left empty, every photo keeps its own recorded value.
   - **Temperature unit** of the values you enter: Celsius, Fahrenheit or Kelvin, by default the unit of your
     Thermal Analyzer preferences, else WebODM's unit system. The task's images are always in degrees Celsius.
   - **Emissivity**, **reflected temperature**, **ambient temperature** (the H20T and XT S do not use it, and the
     form says so) and **relative humidity**.
   - **Distance** to the subject: by default each photo's laser rangefinder distance where it has a valid one
     (each photo of the M4T flight checked has one; DJI's sample images have none), else the distance the camera
     recorded (usually 5 m, whatever the flight height). Or the recorded distance, or one distance for all photos.
     With the rangefinder's distance, the temperatures differ slightly from DJI's own apps, which use the recorded
     one.
3. Below it, WebODM's own task panel: name, processing node, options and the photos on the map. Images are not
   resized: the thermal frames keep their size. **Review**, then **Start Processing**.
4. Each photo is converted as it is uploaded, a few at a time. A photo that fails is left out with its reason;
   the task then processes the others. A GCP file, `geo.txt` and `image_groups.txt` go in with the photos' names
   changed to the converted images' (`DJI_0001_T.JPG` becomes `DJI_0001_T.tif`).

The task's name is suggested from the first photo's date. WebODM's own upload also looks the place up on
OpenStreetMap's Nominatim; the Thermal Task does not, as the plugin calls no outside service.

## The Thermal Analyzer

**Thermal Analyzer**, in WebODM's menu, lists the thermal datasets of every project you can view, with their
analysis and worksets at a glance.

**Preferences** (the gear beside the Thermal Analyzer's heading) are kept for your WebODM account:

- **Temperature unit**: °C, °F or K, used throughout the Analyzer and the Thermal Task whatever unit an image or
  workset holds; by default WebODM's unit system (°F when imperial, else °C).
- **DJI palette**, where the frames hold it: the mosaics' temperature tabs open in it, new worksets start with it
  (unless your saved defaults have a palette of their own), and the Files tab's thumbnails of thermal frames are
  drawn in it, from their temperatures, on the server (the first view of a large dataset takes a while; they are
  kept with the dataset). By default each image's own.

### A dataset and its analysis

**New Dataset**: a name, the project and the flight's photos (or their folder, whose subfolders are kept; you can
also drop them on the page). Only JPEGs are uploaded; the RGB photos taken with the thermal ones are listed, not
analyzed. The photos are then analyzed with dji-thermal-cli's check, in WebODM's worker, with its progress and a
Cancel button.

The dataset's page opens with a summary, a row per camera (and one for all of them when there are several): its
frames and how many have GPS, the temperatures on the dataset's scale, when they were taken and over how long, the
height and the size. A camera's row opens its frames on the Files tab, and each figure opens them sorted by it
(hottest or highest first, in capture order; or only those without GPS). Then:

- **Files**: every file with its capture time, height, gimbal pitch, temperatures, distance (recorded and the
  rangefinder's) and emissivity, and the problems that name it; filtered by name, by kind or to those with
  problems, sorted by any column, with thumbnails if you like (in your preferred DJI palette, if you chose one).
- **Problems**: what dji-thermal-cli found (errors, warnings, notes), each with what addresses it and the files it
  names.
- **WebODM plan**: how well the frames cover the ground, the task options to use (to copy) and the dji-thermal-cli
  command that prepares the images.
- **Worksets**: see below.

**Add images**, **Analyze again**, **Rename** and **Delete** are on the dataset's page, with a link icon beside its
name to copy a link to it; adding images marks the analysis out of date until it is run again.

### Worksets

The **Worksets** tab, the first on a dataset's page and the one it opens on, converts the images into a workset
with dji-thermal-cli's settings, in WebODM's worker, with progress and Cancel. **Settings:** opens and closes the
settings, its chips showing what differs from the defaults either way; the **Outputs** section shows its own when
closed.

- **Outputs**: temperature TIFFs in °C, °F or K, pseudo-colour PNGs, gray16, raw counts, DJI R-JPEGs and the others
  dji-thermal-cli writes, and their compression; the palette and colour range of the pictures.
- **Measurement**: each parameter, with the flight's recorded median beside it (left empty, each image keeps its
  own), and the unit of the files.
- **Corrections**: normalization (one ambient and reflected temperature for every frame, each frame's drift
  removed), a gimbal pitch limit for nadir frames only, gimbal overrides, temperatures above or below a threshold
  replaced, the location stripped.
- **Use the WebODM plan's settings** fills in what the plan recommends; **Copy settings to form**, in a workset's
  menu, fills in that workset's; **Save as my defaults** keeps your settings for new worksets (**Reset to defaults**
  goes back to dji-thermal-cli's).

Each workset is kept beside the others, with what it changed from the defaults, its files (each image's outputs
and why any was skipped), **Download all** (a zip) or each file, and **Rename** and **Delete** in its menu. DJI's own
SDK measures them when an administrator has installed it.

### Mosaics

After converting (on by default in the settings, or **Build mosaics** from a workset's menu), dji-thermal-cli
places the frames side by side from their positions and angles, with no WebODM task needed: as converted, and
harmonized (normalized, each frame's offset against its neighbours removed). **View mosaics** shows them on a map
over WebODM's base layers:

- a tab for each mosaic (**Mosaic**, as converted, and **Harmonized**), **Source frame** (the mosaic with a black and
  white line where one frame meets the next) and **View angle** (the angle each pixel was seen at);
- the palette (the usual ones and the DJI palettes of the images; opening in your preferred one, if they hold it) and the
  range, changed live, with the colour scale
  and **Auto** (the 2nd to 98th percentile);
- the temperature, frame and view angle under the cursor;
- what dji-thermal-cli reports (seams, misalignment, frame offsets, heights) and the mosaic files to download (also
  in the workset's zip).

### A WebODM task from a workset

**Create task**, in a converted workset's menu, makes a WebODM task in the dataset's project from the
workset's temperature TIFFs in °C (the `temp_c` TIFF output), without uploading them again:

- It says what stops a task: a workset not finished converting, its location stripped (ODM needs it to place the frames), or
  fewer than 2 °C TIFFs. It also warns where the workset's settings are off the WebODM plan (not normalized,
  oblique frames kept, emissivity or humidity), with **New workset with the plan's settings**.
- The plan's ODM options, the recommended ones ticked and the others to consider, each with its value and why; and
  the task's name.
- The task is made **without a processing node**: it waits in the project with "Set a processing node", which opens
  WebODM's own panel (the node and the options, as ticked). Processing starts once you save it there.

The workset lists the tasks made from it, each with its status and a link to it on the dashboard. On the
dashboard, such a task has a **Thermal dataset** button in its expanded panel, back to the dataset. A task keeps
its images when the workset or the dataset is deleted (the button then goes).

**Use for parent task**, in the same menu, sends the workset's °C TIFFs to the dataset's own task (see below)
instead of a new one, so one task is processed again and again as you try worksets:

- The TIFFs replace the images sent there before, and what the task processed from them (its orthophoto, models and
  other results) is removed; the dialog says what it replaces. It is refused while the task is processing.
- The task then waits for a processing node, as a new one does: the link in the message opens it on the dashboard,
  where **Set a processing node** sets its node and options. A task without options gets the plan's recommended ones;
  options you set there are kept the next time.
- The workset shows that the dataset's task holds its TIFFs, with the task's status.

### Where a dataset is kept

A dataset is kept in a task of its project, named "Thermal dataset: *name*": its photos and worksets are in that
task's folder, apart from the images WebODM processes, so the task holds no image until a workset is sent to it
(**Use for parent task**). It shows in the project's task list with "Set a processing node"; leave it unset until it
holds a workset's TIFFs. Its expanded panel on the dashboard has a **Thermal dataset** button that opens the
dataset in the Thermal Analyzer. It is shared as the project is:

- viewing the project shows the dataset, its worksets and mosaics, and downloads them;
- changing the project allows adding images, analyzing, converting and making tasks;
- deleting the dataset needs the project's delete permission.

Its photos and worksets count toward the project owner's storage quota (no upload, conversion, mosaic or task once
the owner is over it); a task made from a workset counts its own images too. The dataset goes when its task or the
project is deleted. Deleting the dataset deletes its task too, unless a workset was sent to it: the task is then
kept as an ordinary WebODM task (named without "Thermal dataset:") with those images and what it processed.
Temperatures are shown in the unit of your preferences (see above).

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

The plugin's parts: `converter.py` (R-JPEG to TIFF), `api.py` (its API, under `/api/plugins/dji-thermal/`: `describe` a
photo's camera, recorded values and ranges; `projects/<id>/tasks/<id>/convert` one photo into a partial task, with
WebODM's project permission), `sdk.py` with `page.py` and `templates/sdk.html` (DJI's own SDK and the DJI Thermal page,
`/plugins/dji-thermal/sdk/`), the Thermal Analyzer (`datasets.py`: the holder tasks and their records; `analysis.py`:
the analysis job, run by WebODM's worker; `conversions.py`: the conversions, their settings and job, and each user's
defaults; `mosaics.py`: a conversion's mosaics, their job, and the viewer's tiles and values with WebODM's rio-tiler;
`conversion_tasks.py`: a WebODM task from a conversion, or the dataset's own task given its TIFFs; `analyzer_api.py`:
its API under `/api/plugins/dji-thermal/datasets`, with a conversion's `task` and `parent`; `analyzer_pages.py` with
`templates/datasets.html`, `dataset.html` and `viewer.html`: its pages, `/plugins/dji-thermal/`,
`/plugins/dji-thermal/dataset/<id>` and its conversions' mosaics, `.../dataset/<id>/conversion/<id>`), and `public/`
(`main.js`, which adds the button and the DJI Thermal page's link under Administration; `analyzer_core.js`,
`datasets.js`, `dataset.js`, `conversions.js`, `viewer.js` and `analyzer.css`, the Analyzer's pages, plain scripts; and
`thermal/`, the button and panel (JSX) and WebODM's own Leaflet for the viewer (`Leaflet.js`), built by WebODM's webpack
when the plugin is installed).

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
