# DJI Thermal Analyzer plugin for WebODM

[![The Thermal Inspector on a thermal orthophoto in WebODM: a pinned point, a measured region and an isotherm](images/splash.png)](images/splash-source.png)

The DJI Thermal Analyzer plugin turns the radiometric thermal photos of a DJI drone (R-JPEGs) into temperature maps in
[WebODM](https://github.com/WebODM/WebODM). It adds three things to WebODM:

- **DJI Thermal Task**, a button on each project of the dashboard. It's the quick way: the photos are converted into
  temperature images as they upload, then WebODM processes them like any other task.
- **DJI Thermal Analyzer**, in WebODM's menu, for a flight you want to look at first. It checks the photos, converts
  them with the settings you choose (several worksets side by side), shows quick mosaics on a map and each frame on
  its own page, and makes a WebODM task from the workset you pick.
- **Thermal Inspector**, on WebODM's map of a processed thermal task. It shows the temperature under the cursor,
  pinned points, the statistics of regions and lines (surroundings, ΔT, a line's profile), measurements saved for
  the project, a correction for another emissivity, isotherms and a legend, lays the Analyzer's mosaics on the map to
  compare them with the project's own layers, and shows the frames that saw a point.

Temperatures are computed on your WebODM server by [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/),
a pure-Python version of DJI's Thermal SDK. The plugin calls no outside service.

## What you can do

- **Get a temperature map straight from the drone's photos.** DJI Thermal Task converts the R-JPEGs as they upload,
  so there's nothing to preprocess before a WebODM task: [A thermal map with DJI Thermal Task](quickstart-thermal-task.md).
- **Check a flight before processing it.** What each photo is, the problems found, how well the frames cover the
  ground, and the WebODM options to use, saved as a preset: [Checking a flight](quickstart-analyzer.md).
- **Preview mosaics and try settings, then make WebODM models from the result.** Normalize, harmonize, change the
  palette and the measurement values, leave out oblique frames, and compare worksets side by side; then make a WebODM
  task from the one you pick, or try several in one task: [Worksets, mosaics and a task](quickstart-worksets.md).
- **Compare mosaics and orthophotos, adjusting them in real time.** Lay a workset's mosaic on WebODM's map, swipe it
  against a task's orthophoto, and change the palette, range, brightness, contrast, gamma and isotherm as you watch:
  [Mosaic Overlays](quickstart-inspector.md#4-mosaic-overlays-on-the-map) and
  [Colours, legend and isotherms](quickstart-inspector.md#3-colours-legend-and-isotherms).
- **Analyze your results.** The temperature under the cursor, pins, lines with their profile, regions with their
  statistics, histogram, surroundings and ΔT, isotherms, measurements saved for the project, and a correction for
  another emissivity: [Measuring on the map](quickstart-inspector.md).
- **Trace a temperature back to its photos.** The frames that saw a point on the map, each one measured in its own
  pixels or measured again with other values: [The frames that saw a point](quickstart-inspector.md#5-the-frames-that-saw-a-point)
  and [One frame at a time](quickstart-worksets.md#one-frame-at-a-time).
- **Clean a dataset.** The hottest frames first, the frames without GPS, noisy frames or files removed, oblique
  frames left out: [Read the summary](quickstart-analyzer.md#2-read-the-summary) and
  [The workset](quickstart-worksets.md#2-the-workset).
- **Export the temperatures.** TIFFs in °C, °F or K, CSV, colour PNGs, R-JPEGs and zips, with the location stripped
  for sharing: [The converted images](converted-images.md).
- **Keep everything on your own server.** No outside service is called; an administrator can have DJI's own SDK
  compute the temperatures instead: [DJI's own Thermal SDK](dji-sdk.md).

## Quickstarts

Each one walks through a task from start to finish.

1. [A thermal map with DJI Thermal Task](quickstart-thermal-task.md): from the flight's photos to an orthophoto
   of temperatures.
2. [Checking a flight in the DJI Thermal Analyzer](quickstart-analyzer.md): upload the photos, read the problems
   found and the settings WebODM should use.
3. [Worksets, mosaics and a task](quickstart-worksets.md): convert the photos, look at the mosaics and at each frame
   (measured, or measured again with other values), and make a WebODM task from them.
4. [Measuring on the map](quickstart-inspector.md): temperatures, points, regions and lines on the processed map,
   saved for the project and corrected for another emissivity.

## Guides

- [Installing](installing.md): WebODM in Docker (Linux, Windows, macOS) or WebODM's native Windows installer.
- [Measurement settings](measurement.md): emissivity, distance, reflected and ambient temperature, humidity, and
  what each one changes.
- [Palettes and units](palettes.md): how temperatures are coloured and in which unit they're shown.
- [DJI's own Thermal SDK](dji-sdk.md): having DJI's library compute the temperatures instead.

## Reference

- [The converted images](converted-images.md): what a temperature TIFF holds.
- [Troubleshooting](troubleshooting.md): messages you may see and what to do about them.
- [The plugin's API](api.md): the HTTP endpoints the pages use.
- [Developing the plugin](developing.md): the code's map, the dev environment, the tests, and recipes for changing it.

## Cameras

Every camera dji-thermal-cli decodes: H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T and XT S. The M4T has been
checked on a real flight; the others on DJI's Thermal SDK sample images.

The plugin's source, releases and issues are on
[GitHub](https://github.com/WinuxNomacs/webodm-dji-thermal). It's licensed under the
[AGPL-3.0](https://github.com/WinuxNomacs/webodm-dji-thermal/blob/main/LICENSE). It's built on WebODM,
dji-thermal-cli, DJI's thermal format and SDK, and many open-source projects: see the README's
[Thanks](https://github.com/WinuxNomacs/webodm-dji-thermal#thanks).
