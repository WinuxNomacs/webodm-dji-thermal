# Changelog

## 1.0.0 (2026-10-30)

The first release, for WebODM 3.3.2 or later.

**Thermal Task**

- A **Thermal Task** button in each project: pick a flight's photos (and a GCP file); the DJI thermal R-JPEGs among
  them are found by their content, the RGB photos are ignored and not uploaded.
- Each thermal photo is converted on upload into a single-band float32 TIFF of temperatures in degrees Celsius,
  with the photo's GPS, camera and gimbal metadata and marked as a thermal band, so WebODM processes the task into
  a thermal orthophoto.
- **Measurement settings** at upload: emissivity, reflected and ambient temperature, humidity, in °C or °F (WebODM's
  unit system by default), within each camera's ranges; left empty, each photo keeps its recorded value. Distance:
  the laser rangefinder's by default, else the recorded one, or one distance for all photos. The values used are
  recorded in each TIFF's XMP.
- A photo that fails is left out with its reason; a GCP file, `geo.txt` and `image_groups.txt` get the converted
  images' names.

**Thermal Analyzer**, in WebODM's menu

- **Datasets** of a flight's photos (or a folder, its subfolders kept) in any project you can view, shared as the
  project is, counted in its owner's quota.
- **Analysis** by dji-thermal-cli's check, in WebODM's worker: the files with their capture data and temperatures,
  the problems found and what addresses them, and a WebODM plan (coverage, task options, the conversion command).
- **Conversions** with every dji-thermal-cli setting (outputs, measurement, normalization, pitch limit, gimbal
  overrides, thresholds), kept side by side, downloaded as a zip or file by file; each user's defaults saved.
- **Mosaics** of a conversion (as converted and harmonized), placed from the frames' positions with no WebODM task,
  in a map viewer: palettes and range changed live, the temperature, frame and view angle under the cursor, the
  reports and files.
- **Create task** from a conversion: its °C TIFFs in a WebODM task of the project, with the plan's ODM options as
  ticked, waiting for a processing node set in WebODM's own panel.

**DJI's own Thermal SDK**

- A **DJI Thermal** page under Administration, for superusers: upload DJI's Thermal SDK 1.8 zip (checked on its
  sample images) to have DJI's own library compute the temperatures, or `DJI_THERMAL_SDK_DIR` at deployment. It
  runs in a process of its own; without it, dji-thermal-cli's built-in port is used.

**Cameras**: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S (temperatures by
[dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/) 1.9.0). The M4T checked on a real flight, the others
on DJI's Thermal SDK sample images. The server calls no outside service.
