# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps: the plugin converts each
R-JPEG into a temperature image (degrees Celsius) as it is uploaded, then WebODM processes them like any other
task.

**In development**: nothing is released yet. See [upcoming-changes.md](upcoming-changes.md) for the plan.

Temperatures are computed with [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/), a pure-Python
implementation of DJI's Thermal SDK: no native library and no outside service.

## The converted images

Each thermal R-JPEG becomes a single-band 32-bit float TIFF of its temperatures in degrees Celsius, measured with
the parameters the camera recorded in the photo (distance, humidity, emissivity, reflected temperature). It keeps
the photo's EXIF and DJI XMP metadata that ODM uses (GPS, altitudes, capture time, camera and gimbal angles, RTK
accuracy) and is marked as a thermal band (`Camera:BandName` = `LWIR`), so ODM processes it as thermal. The RGB
photos DJI's thermal drones take beside the thermal ones, and any other file, are left as they are.

## Cameras

Every camera dji-thermal-cli decodes: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S. The M4T has been
checked on a real flight; the others on DJI's Thermal SDK sample images only.

## Developing

`CLAUDE.md` describes the dev environment (WebODM in Docker on port 8002, `dev/webodm.sh`) and the checks.

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
