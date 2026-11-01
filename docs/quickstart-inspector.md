# Measuring on the map

The Thermal Inspector reads temperatures from a processed thermal task, on WebODM's 2D map. It works on any task
whose orthophoto holds temperatures: one made with [Thermal Task](quickstart-thermal-task.md), or from a
[workset](quickstart-worksets.md). It can also lay the mosaics of the Thermal Analyzer's worksets on the map, to
compare them with the project's own layers.

## 1. Open it

Open the task's map from the dashboard (**View Map**), and press the thermometer button on the map's right. The
button is also on any map of a project with workset mosaics, even one with no thermal orthophoto.

![The Thermal Inspector on a task's map, with a pinned point and a region](images/inspector.png)

## 2. Read temperatures

The panel's buttons choose what a click on the map does:

- **Hover**: the temperature under the cursor, beside it and in the panel.
- **Pin**: a click pins the point with its temperature (P1, P2…). The pins are listed in the panel; click one to go
  to it.
- **Rectangle**, **circle** and **polygon**: draw a region (R1, R2…). For a rectangle or circle, press and drag. For
  a polygon, click its corners, then double-click or press Enter to finish (Backspace removes the last corner, Esc
  cancels).

For each region, the panel shows the minimum, maximum, mean, median, standard deviation, 2nd and 98th percentiles,
the number of pixels, the area and a histogram. The hottest and coldest pixels are marked on the map.

Pins and regions can be hidden, removed, and downloaded as CSV. Your browser keeps them for the next time you open
the same task.

## 3. Colours, legend and isotherms

- **Palette**: the thermal layer's colours, from the same list as the Thermal Analyzer's. It's your palette
  everywhere: choosing one here also sets it in the Analyzer. The range is set in WebODM's own layer panel.
- **Legend on the map**: a colour bar with the palette's range, at the map's top left.
- **Isotherm**: paints the temperatures above, below or between limits you type, in a colour you choose. The
  legend marks the part painted. **Off** removes it.

Temperatures are shown in WebODM's units: °F when its map is set to Imperial, °C otherwise. See
[Palettes and units](palettes.md).

## 4. Workset mosaics on the map

**Workset mosaics** in the panel lists the mosaics of every workset in the project's datasets. Tick one to lay it
on the map, above WebODM's layers, or open the map from the workset's **Open on WebODM's map**, which lays it for
you.

![A workset's mosaic laid on the project's map and swiped against the thermal orthophoto](images/inspector-mosaics.png)

Once it's laid:

- Choose **Mosaic**, **Harmonized** or **Source frame**. It's drawn in your palette, over its own 2nd to 98th
  percentile.
- The slider sets its opacity.
- **Swipe** puts it on the right of WebODM's divider, with WebODM's layers on the left: drag the divider to compare
  it with a task's orthophoto or surface model. Choose that layer in WebODM's layer panel.
- The magnifier zooms to it.

Hover, pins, regions, the isotherm and the legend read the topmost thermal layer, the mosaic or a task's thermal
orthophoto.

The mosaics are the plugin's layers, not entries of WebODM's layer panel, and you lay them again each time you open
the map. WebODM shows a project's map only once one of its tasks has finished with an orthophoto or an elevation
model; until then, look at the mosaics in the Analyzer's [mosaic viewer](quickstart-worksets.md#3-the-mosaics).
