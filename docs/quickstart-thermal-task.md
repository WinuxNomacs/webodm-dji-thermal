# A thermal map with DJI Thermal Task

From a DJI flight's photos to a WebODM orthophoto of temperatures, in one go. To look at the flight before
processing it, or to compare settings, see [Checking a flight in the DJI Thermal Analyzer](quickstart-analyzer.md)
instead.

You need the photos of a flight made with a [supported camera](index.md#cameras), and a WebODM project you can
change.

## 1. Choose the photos

On WebODM's dashboard, press **DJI Thermal Task** on your project, beside **Select Images and GCP**.

![A project on the dashboard, with the DJI Thermal Task button](images/thermal-task-button.png)

Pick the flight's photos. You can pick all of them: the plugin finds the thermal R-JPEGs by their content and leaves
out the visible (RGB) photos taken with them. You can add a GCP file too.

## 2. Check the measurement values

The panel shows how many thermal photos it found, then the values the temperatures are computed with.

![The DJI Thermal Task panel, with the measurement values and WebODM's task options](images/thermal-task-panel.png)

Each field shows the value the camera recorded and the range it accepts. Leave a field empty to keep each photo's
own recorded value; this is usually right. Fill one in when you know better, for example the emissivity of the
material you're measuring. [Measurement settings](measurement.md) explains each one.

**Temperature unit** is the unit of the values you type. The task's images are always in degrees Celsius.

## 3. Start processing

Below the measurement values is WebODM's usual task panel: the task's name, the processing node and the options.
The thermal frames keep their size; they aren't resized. Press **Review**, then **Start Processing**.

Each photo is converted into a temperature image as it uploads, a few at a time. If a photo can't be converted,
it's left out and the panel says why; the task processes the others.

## 4. Look at the result

When WebODM has finished, open the task's map. Its orthophoto holds temperatures, and the
[Thermal Inspector](quickstart-inspector.md) reads them.

## Good to know

- A GCP file, `geo.txt` and `image_groups.txt` are uploaded with the photos. The image names in them are changed
  to the converted images' names (`DJI_0001_T.JPG` becomes `DJI_0001_T.tif`).
- The task's name comes from the first photo's date. WebODM's own upload looks the place up on OpenStreetMap; the
  DJI Thermal Task doesn't, because the plugin calls no outside service.
- [The converted images](converted-images.md) describes what each uploaded TIFF holds.
