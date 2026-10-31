# Checking a flight in the Thermal Analyzer

The Thermal Analyzer looks at a flight's photos before you process them. It tells you what each photo is, what
problems it found, and which WebODM settings to use.

## 1. Make a dataset

Open **Thermal Analyzer** in WebODM's menu. It lists the thermal datasets of every project you can view.

![The Thermal Analyzer's list of datasets](images/analyzer-list.png)

Press **New Dataset**. Give it a name, choose the project, and choose the flight's photos or their folder (you can
also drop them on the page).

![The New Dataset dialog](images/new-dataset.png)

Only JPEGs are uploaded. Visible photos are listed but not analyzed. Once uploaded, the photos are analyzed in
WebODM's background worker; the page shows its progress and a **Cancel** button.

The dataset is kept in a task of the project called "Thermal dataset: *name*". So it's shared as the project is, and
its photos count toward the project owner's storage.

## 2. Read the summary

The dataset's page opens with a summary: a row per camera with its frames, how many have GPS, the temperatures, when
they were taken, the height and the size.

![A dataset's page: the summary, the steps and the Worksets tab](images/dataset.png)

Each figure is a link. Click the temperatures to see the hottest frames first, or the GPS count to see only the frames
without GPS.

Under the summary are the steps from photos to a temperature map. Each shows a ✓ when it's done, or links to where
you do it:

1. check the problems,
2. create a workset,
3. create a task from it,
4. measure on the map.

## 3. Look at the files

The **Files** tab lists every file with its capture time, height, gimbal pitch, temperatures, distance and
emissivity. You can filter it, sort it by any column and show thumbnails.

![The Files tab, with a file's detail pane](images/dataset-files.png)

Click a file to open its detail pane beside the table. It shows the picture (a thermal frame drawn from its
temperatures) and everything the analysis read from the file. Click the picture to see it full size:

![The picture viewer](images/picture-viewer.png)

In the viewer, zoom with the buttons, the mouse wheel or a double click, and drag to move around. **Fit** and **1:1**
reset the zoom. The arrows (or ← and →) go to the previous and next files; × or Esc closes it.

To select several files, Ctrl/Cmd-click or Shift-click them; the pane can then download them as a zip.

## 4. Check the problems

The **Problems** tab lists what the analysis found: errors, warnings and notes. Each one says how to address it in
the workset's settings, and names the files concerned.

![The Problems tab](images/dataset-problems.png)

Some problems are fixed by a single setting, such as **Normalize** or leaving out oblique frames. Those have a button
that sets it in the workset settings for you.

## 5. Read the WebODM plan

The **WebODM plan** tab shows how well the frames cover the ground and which WebODM task options to use, with the
reason for each.

![The WebODM plan tab](images/dataset-plan.png)

**Use these settings** fills in the workset settings the plan recommends. That's the next step:
[Worksets, mosaics and a task](quickstart-worksets.md).

## Also on the dataset's page

- **Add images** adds photos to the dataset; run **Analyze again** afterwards.
- The pencil renames the dataset and the bin deletes it. The link icon beside its name copies a link to the page.
- The gear beside the Thermal Analyzer's heading sets your preferences: the temperature unit and the palette
  (see [Palettes and units](palettes.md)).
