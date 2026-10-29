# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps: the plugin's **Thermal Task**
button converts each R-JPEG into a temperature image (degrees Celsius) as it is uploaded, with measurement
settings you can change, then WebODM processes them like any other task.

**In development**: nothing is released yet. See [upcoming-changes.md](upcoming-changes.md) for the plan.

Temperatures are computed with [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/), a pure-Python
implementation of DJI's Thermal SDK: no native library and no outside service.

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

## Cameras

Every camera dji-thermal-cli decodes: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S. The M4T has been
checked on a real flight; the others on DJI's Thermal SDK sample images only.

## Developing

`CLAUDE.md` describes the dev environment (WebODM in Docker on port 8002, `dev/webodm.sh`) and the checks.

The plugin's parts: `converter.py` (R-JPEG to TIFF), `api.py` (its API, under `/api/plugins/dji-thermal/`:
`describe` a photo's camera, recorded values and ranges; `projects/<id>/tasks/<id>/convert` one photo into a
partial task, with WebODM's project permission), and `public/` (`main.js`, which adds the button, and
`thermal/`, the button and panel, JSX built by WebODM's webpack when the plugin is installed).

The tests never use images from this repository: none is committed or published. Those that need real R-JPEGs
read them from two folders on your machine, set in an untracked `.env` file at the repo root, and are skipped when
these are not set:

```
DT_SAMPLES_DIR=/path/to/dji_thermal_sdk/dataset   # DJI's Thermal SDK sample images, one folder per camera
DT_FLIGHT_DIR=/path/to/a/flight                   # a real flight's photos, thermal and RGB, in any subfolders
```

`dev/webodm.sh up` mounts them read-only in the dev containers.

## License

[AGPL-3.0](LICENSE).
