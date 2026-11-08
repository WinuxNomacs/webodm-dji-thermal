# Troubleshooting

The messages you may meet, and what to do about them.

## DJI Thermal Task

**"None of the files picked is a DJI thermal photo."**

The plugin recognises DJI's radiometric R-JPEGs by their content. Photos from another camera, visible (RGB) photos
and thermal photos saved without their temperature data (a screenshot, an edited copy) aren't R-JPEGs. Pick the
`_T.JPG` files as the drone saved them.

**"… photos of a camera this plugin cannot convert are left out."**

They're R-JPEGs from a camera dji-thermal-cli doesn't decode. See [Cameras](index.md#cameras).

**"… photos could not be converted:"**, with a reason for each

Those photos are left out and the task goes on with the others. The reason says what went wrong with the photo.
"The server did not answer in time" or "Cannot reach the server": the photo was sent three times without an answer
(a slow or dropped connection); add it to a new task once the connection is back.

**"None of the photos could be converted: the task was not created."**

Every photo picked failed to convert. The reasons are listed under the project; a photo of a camera dji-thermal-cli
decodes, as the drone saved it, converts.

**"The conversion failed: …"** / **"The conversion was canceled: the task will not start."** (Normalize or Harmonize)

With Normalize or Harmonize ticked, the photos are converted by a workset of the task's dataset in WebODM's worker,
and the task starts once it's done. The workset failed, for the reason given, or was canceled in the DJI Thermal
Analyzer. The photos are kept in the dataset: create a workset there with the settings you want, then **Use for
parent task** from its menu to put its images in the task (see
[Trying several worksets in one task](quickstart-worksets.md#trying-several-worksets-in-one-task)).

**"Converted, but the task didn't start: ..."**, with a **Start processing** button

The photos were converted, but putting their images in the task failed, for the reason given; the task still waits
for them. Once that is put right, **Start processing** puts them in and starts the task on the processing node
chosen. Don't use WebODM's own **Start Processing** for it: it would process the photos unconverted. WebODM deletes a
task left waiting for its images after 72 hours.

**No DJI Thermal Task button on the dashboard**

The plugin's scripts didn't load. Install the plugin from a release zip or WebODM's plugin list, which include the
built scripts (see [Installing](installing.md)), and reload the page.

## DJI Thermal Analyzer

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

**"Could not reach the server: check the connection, then try again."**

A button's request never reached WebODM (a dropped connection, or WebODM restarting): nothing was changed. Press it
again once WebODM answers.

**"The … job stopped before it finished"**

WebODM's worker stopped while running it, for example when WebODM restarted or its worker crashed. A running job
tells the plugin it's alive every 2 seconds; one silent for 5 seconds that WebODM's worker no longer has, or with no
worker answering, is marked so at the page's next update (on WebODM's native Windows install, where a busy worker may
not answer, once silent for five minutes). A job still waiting its turn behind others is not. Start it again.

**"Waiting for WebODM's worker, which isn't running"**

The job is queued, but WebODM's worker doesn't answer: it isn't running, or its message broker (Redis) is down. The
job starts once the worker does; restart WebODM if it doesn't come back.

**"The job could not be started (…). Try again in a moment."**

The analysis, workset or mosaics could not be handed to WebODM's worker: its message broker (Redis) did not answer,
for example while WebODM is starting. Start it again once WebODM is up.

**"Could not load the dataset." or "Could not load the mosaics." while a job runs**

The page lost the server for a moment (a dropped connection, or WebODM restarting). It keeps trying every few
seconds, and shows the job's progress again once the server answers.

**"Could not measure the frames for the table: …"**

A workset's Files table shows each frame's temperatures and measurement values, measured in WebODM's worker. The
message gives the reason; **Measure again** retries. A worker started before the plugin was updated runs its old
code (the reason then names a missing function): restart WebODM's worker, then Measure again.

**"Wait for the mosaics to be built, or cancel them, before removing frames"**

Frames can't be removed from a workset while its mosaics are being built. Wait for them, or cancel them, then
remove the frames and build the mosaics again.

**"A workset keeps at least one converted frame: delete the workset instead"**

Removing frames would leave the workset with none converted. Delete the workset from its **⋯** menu.

**"That would leave … without a converted frame: delete it first, or keep one of its frames"**

Removing these files from the dataset would take every converted frame from that workset. Delete the workset from
its **⋯** menu first, or leave one of its frames out of the selection.

**"Wait for … to finish converting, or cancel it, before removing files"** (or **"Wait for …'s mosaics to be built"**, **"Wait for the analysis to finish"**)

Files can't be removed from a dataset while it is analyzed or one of its worksets converts or builds its mosaics.
Wait for it, or cancel it, then remove them.

**"The mosaics were built with frames since removed"**

Frames have been removed from the workset since its mosaics were built, and the mosaics still include them.
**Build again** builds them from the frames the workset keeps.

**Settings marked "≠ plan"**

Not an error: the setting differs from what the WebODM plan recommends for processing into a map. Hover over it to
see the plan's value.

**The Files tab's thumbnails take a while the first time**

The thermal thumbnails are drawn from each frame's temperatures, on the server, in your palette. They're kept with
the dataset, so the next views are quick; those nobody has viewed for two weeks are deleted (drawn again if viewed).

## Thermal Inspector

**No thermometer button on the map**

The Inspector appears on a task whose orthophoto holds temperatures: a single thermal band, as ODM makes from the
DJI Thermal Task's or a workset's temperature TIFFs. An orthophoto of colour pictures has no temperatures to read.
On a project's map it also appears when a workset of one of the project's datasets has built mosaics.

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

A bug of WebODM 3.3.2's native Windows install, fixed in WebODM 4.0.0. The packages are installed and the plugin
works; WebODM only runs pip again at each start, which needs an internet connection.

If something isn't covered here, [open an issue](https://github.com/WinuxNomacs/webodm-dji-thermal/issues) with
what you did, what you saw, and WebODM's log.
