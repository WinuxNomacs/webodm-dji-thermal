# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps: the plugin's **Thermal Task**
button converts each R-JPEG into a temperature image (degrees Celsius) as it is uploaded, with measurement
settings you can change, then WebODM processes them like any other task.

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
and the DJI Thermal page, `/plugins/dji-thermal/`), and `public/` (`main.js`, which adds the button and the page's link under Administration, and
`thermal/`, the button and panel, JSX built by WebODM's webpack when the plugin is installed).

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
