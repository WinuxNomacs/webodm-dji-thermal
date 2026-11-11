# Palettes and units

## Your palette

A palette is the set of colours temperatures are drawn in. The plugin offers DJI's ten palettes (white hot,
black hot, ironred, arctic, rainbow and the others) and WebODM's colour maps.

You choose it once: the DJI Thermal Analyzer's preferences (the gear beside its heading), the mosaic viewer and the
Thermal Inspector all set the same palette, kept with your WebODM account. By default each image is drawn in the
palette it was shot in.

It's used:

- in the DJI Thermal Analyzer, for the Files tab's thumbnails and detail pane (drawn from the frames' temperatures, on
  the server; the first view of a large dataset takes a while), and as the palette new worksets start with; a
  workset's frames (its Files, the frame page) are drawn in the workset's own palette when it chose one;
- in the DJI Thermal Task panel, where the palette the task's map opens in starts on yours (else on the one the
  photos were shot in);
- in the mosaic viewer, where its temperature tabs open in it (the Intensify tab opens in blue-white-red, a palette
  of the mosaic viewer's own for differences, which isn't saved as yours);
- on WebODM's map of a thermal task, where the Thermal Inspector draws DJI's palettes itself, over the range set in
  its colour scale or in WebODM's layer panel (the same range). Its Image section, as the mosaic viewer's, changes
  how the colours are shared out over that range.

WebODM's own layer panel lists only WebODM's colour maps. Choosing one there also sets your palette; a colour map
WebODM has that the plugin's list doesn't is drawn but not saved.

## Reading temperatures from colours

A smooth palette shades gradually, so two nearby colours are hard to tell apart and a colour can't be matched to the
colour bar closely. For reading temperatures by eye, choose **Stepped** in the Image section (the mosaic viewer, the
frame page and the Thermal Inspector): the colours come in flat bands, each a band of temperatures of the same width
(2 °C, say), with the colour bar in the same bands, so every colour stands for a known span of temperatures. Its
width is Auto (a round width giving 10 to 20 bands over the range, changing with the range) or the one you type in
the field beside it, in your unit; the bands' edges fall on whole multiples of it (at 20, 22, 24 °C, not 21.3,
23.3 …). For an exact temperature, hover or pin it: the colours are only ever a picture of the temperatures.

## A workset's colours

A workset's colour pictures (the colour PNG and DJI R-JPEG outputs) are drawn in the palette and colour range set
in the Workset Creation Settings' Colours section. With no range, each picture uses its own.

The palette a workset chose (there, or in DJI Thermal Task, for the task's map) is also how its frames are shown:
the thumbnails and pictures in its Files, and the frame page (its list and the frame, which you can still draw in
another palette there). A workset left on "Each image's own" shows them in your palette, else as shot.

## The temperature unit

Temperatures are shown in °C or °F, whatever unit an image holds. Pick it in the **°C / °F menu** at the top of
every WebODM page, beside your user icon (or in the DJI Thermal Analyzer's preferences): it's kept with your WebODM
account, so it follows you to any browser.

It's linked to WebODM's own units (the Metric/Imperial selector on WebODM's map, kept in each browser): °F is
imperial, °C metric. Picking °F also switches WebODM to imperial lengths, and switching WebODM's units picks the
matching temperature unit. Opening WebODM in another browser sets its units to your choice.

Until you pick one, you get the default an administrator set on the **DJI Thermal** page under **Administration**
(°C unless they changed it), or the units this browser was already set to. Anyone viewing a public map without
logging in sees the administrator's default.

The images themselves don't change: the DJI Thermal Task's are in °C, a workset's frames' TIFFs in the units ticked in
its Outputs, and its mosaics in its Measurement section's **Unit of the files**.
