# Troubleshooting

The messages you may meet, and what to do about them.

## Thermal Task

**"None of the files picked is a DJI thermal photo."**

The plugin recognises DJI's radiometric R-JPEGs by their content. Photos from another camera, visible (RGB) photos
and thermal photos saved without their temperature data (a screenshot, an edited copy) aren't R-JPEGs. Pick the
`_T.JPG` files as the drone saved them.

**"… photos of a camera this plugin cannot convert are left out."**

They're R-JPEGs from a camera dji-thermal-cli doesn't decode. See [Cameras](index.md#cameras).

**"… photos could not be converted:"**, with a reason for each

Those photos are left out and the task goes on with the others. The reason says what went wrong with the photo.

**No Thermal Task button on the dashboard**

The plugin's scripts didn't load. Install the plugin from a release zip or WebODM's plugin list, which include the
built scripts (see [Installing](installing.md)), and reload the page.

## Thermal Analyzer

**"The project's owner is over their storage quota: free some space first"**

A dataset's photos and worksets count toward the project owner's storage quota. Delete worksets or datasets you
no longer need, or ask an administrator to raise the quota.

**"Wait for the analysis to finish, or cancel it, before adding images"**

Images can't be added while the dataset is being analyzed.

**"Add images to the dataset first"** / **"The images must be converted first"**

The step needs images, or a converted workset, that the dataset doesn't have yet.

**"The dataset's task is processing in WebODM: cancel it there first"**

**Use for parent task** replaces the images of the dataset's own task, which can't happen while WebODM is
processing it. Wait for it to finish, or cancel it on the dashboard.

**"The … job stopped before it finished"**

WebODM's worker stopped while running it, for example when WebODM restarted. Start it again.

**Settings marked "≠ plan"**

Not an error: the setting differs from what the WebODM plan recommends for processing into a map. Hover over it to
see the plan's value.

**The Files tab's thumbnails take a while the first time**

The thermal thumbnails are drawn from each frame's temperatures, on the server, in your palette. They're kept with
the dataset, so the next views are quick.

## Thermal Inspector

**No thermometer button on the map**

The Inspector appears on a task whose orthophoto holds temperatures: a single thermal band, as ODM makes from the
Thermal Task's or a workset's temperature TIFFs. An orthophoto of colour pictures has no temperatures to read.

**"This task has no thermal orthophoto"**

Likewise, the task's orthophoto isn't a temperature map.

**"Outside the task's crop"**, **"Outside the orthophoto"**, **"No data here"**

The point or region has no temperature to read there: the task's crop leaves it out, it's beyond the
orthophoto, or the orthophoto has no data there.

## DJI's own Thermal SDK

**"Not a zip file DJI's Thermal SDK can be read from"**, **"This is not DJI's Thermal SDK: the zip has no …"**

Upload the zip exactly as DJI's site gives it, version 1.8.

**"The zip has no DJI Thermal SDK libraries for this server"**

DJI builds the SDK for x64 and x86 processors only. On an ARM server, the built-in port is used.

**"DJI_THERMAL_SDK_DIR is set to …, which has no DJI Thermal SDK"**

The folder set at deployment is empty or wrong. Upload the SDK on the DJI Thermal page, or fix the folder. Until
then, photos fail with this reason rather than being measured by the built-in port.

## WebODM

**"Failed to install requirements.txt" in WebODM's log, at every start (native Windows)**

A bug of WebODM 3.3.2's native Windows install, fixed in later releases. The packages are installed and the plugin
works; WebODM only runs pip again at each start, which needs an internet connection.

If something isn't covered here, [open an issue](https://github.com/WinuxNomacs/webodm-dji-thermal/issues) with
what you did, what you saw, and WebODM's log.
