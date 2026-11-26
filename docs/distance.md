# How DJI uses distance

A DJI thermal photo holds several distances and heights: the distance the thermal camera was set to, the laser
rangefinder's reading, and the drone's altitude. Only one of them goes into the temperatures. This page explains what
each one is, what DJI does with the distance, and why the plugin measures **As recorded** by default and marks
**Laser rangefinder, else as recorded** as experimental. The setting itself is described in
[Measurement settings](measurement.md#distance-to-the-target).

The findings below come from reading dji-thermal-cli and its port of DJI's Thermal SDK 1.8, and from measuring DJI's
sample images and one M4T flight with it. Where a finding rests on less than that, it says so.

## What the distance is for

A thermal camera measures the infrared radiation reaching it, not temperature. Between the surface and the camera,
the air absorbs some of the surface's radiation and adds some of its own. DJI's SDK corrects for that air from three
values: the distance, the ambient temperature and the relative humidity. The distance is only an input to this
correction. It isn't used to place the photo, focus the camera or change the photo's raw data.

**The raw data doesn't depend on the distance.** On the photos checked (the iirp format, the M4T's on older
firmware, and most other DJI cameras), the raw values are the camera's uncorrected reading, and DJI applies the
correction on top when it computes temperatures. So any distance can be applied afterwards, and changing it changes
only how the photo is measured, never the photo. The hirp format (the M3TD and M4T on newer firmware) hasn't been
checked this way.

## The distances in a photo

| Value in the photo | What it is | Used for temperatures? |
|---|---|---|
| The thermal camera's distance, in DJI's thermal data | The distance the pilot set in DJI Pilot 2's temperature measurement settings. On the M4T it is 5 m (16 ft) unless changed, with 50 % humidity. | Yes, by DJI's apps and tools, and by the plugin by default (**As recorded**). |
| `LRFTargetDistance` | The laser rangefinder's beam length, from the camera to the point the laser hit. | Only if you choose **Laser rangefinder** (experimental). |
| `LRFTargetAbsAlt`, `LRFTargetLat`, `LRFTargetLon` | Where the laser hit, as a position and altitude. | No. |
| `RelativeAltitude`, `AbsoluteAltitude` | The drone's height above take-off, and its altitude. | No. |

**The camera doesn't take the rangefinder's distance on the M4T.** With its default settings, the M4T writes 5 m into
every photo, whatever the drone's height. On the M4T flight checked, all 217 photos record 5 m, while the rangefinder
read from 8.9 m to 30.4 m (23.9 m median). Other models may differ: DJI's H30T documentation says DJI Pilot 2 can read
the rangefinder automatically, and DJI's H30T sample image records 13 m. This hasn't been checked on an H30T flight.

**DJI calibrates the camera at a fixed distance.** DJI's Thermal Analysis Tool guide (v1.2) says: "The camera's
default calibration distance is generally fixed during production. This is the distance at which temperature
measurements are the most accurate."

**The target's altitude is computed, not measured.** `LRFTargetAbsAlt` is the drone's altitude minus the drop along
the laser beam: `AbsoluteAltitude - LRFTargetDistance x sin(-gimbal pitch)`. On the M4T flight this formula matches
the recorded value to within 0.06 m (the median over its 217 photos). So the value is only as good as the drone's
altitude. It is the altitude of whatever the laser hit (a roof, a tree's canopy, the ground), not an object's height.
The plugin's mosaics use it only to place frames, never to measure.

**The drone's altitude isn't a distance to the surface.** `RelativeAltitude` is the height above the take-off point,
not above the ground under the drone, and the camera is often tilted. Neither DJI's SDK nor the plugin uses the
altitude for temperatures.

## One distance for the whole photo

DJI's SDK takes one distance per photo, and every pixel is measured with it. The laser hits one point, near the
centre of the frame. In a straight-down photo of a roof with the ground 6 m lower around it, a laser reading from the
roof is applied to the ground too. In an oblique photo, the near and far edges of the frame get the centre's distance.

## What each camera accepts

Each camera accepts a range of distances, read from DJI's sample images with the SDK the plugin uses:

| Cameras | Distance accepted |
|---|---|
| M3TD and M4T on newer firmware (hirp) | 0 to 1000 m |
| H30T, and the M4T on older firmware (iirp) | 1 to 300 m |
| H20N, M2EA, M30T, M3T, and the M3TD on older firmware | 1 to 25 m |
| H20T, XT S | 1 to 25 m, in whole metres. They ignore the distance the photo records and use 5 m unless given another, and the XT S won't measure below 5 m. |

**A rangefinder reading is clamped to the camera's range.** On the cameras that accept up to 25 m, a reading of 60 m
or 120 m at mapping heights is measured as 25 m. Each photo's notes say so, but the photo is still counted as measured
with the rangefinder.

## What the distance does to the temperatures

DJI's correction treats a longer distance as more air, which absorbs more of the surface's radiation. On the M4T
flight, DJI's table gives the share of the radiation that gets through as:

| Distance | Radiation getting through |
|---|---|
| 1 m | 0.945 |
| 5 m (as recorded) | 0.858 |
| 25 m | 0.716 |
| 120 m | 0.433 |

These shares were read at 20 °C. The SDK accepts no distance below 1 m on these photos, so even 5 m is a correction,
not none.

To undo the absorption, the SDK pushes each pixel away from the ambient temperature you enter. A surface at the
ambient temperature doesn't move. Every other surface is pushed further away the longer the distance. From 5 m to
120 m, the push grows about 1.9 times on the M4T photos checked, 1.7 times on the M3TD sample and 1.4 times on the
H30T sample.

Measured on one frame of the M4T flight, with the ambient temperature it recorded (27.6 °C):

| Distance | Mean | Coolest pixel |
|---|---|---|
| 5 m (as recorded) | 22.8 °C | 13.2 °C |
| 21 m (the rangefinder's) | 21.8 °C | 10.0 °C |
| 100 m | 18.8 °C | −3.5 °C |
| 200 m | 17.8 °C | −3.5 °C |

So at long distances, the result depends mostly on the ambient temperature you enter. The humidity matters far
less: on that frame at 120 m, 10 % against 95 % moves the coldest pixels by about 0.3 °C.

A scene that spans several degrees can't be put right by choosing the ambient temperature. Take ice at 0 °C and a
sunlit object at 18 °C, photographed from 120 m. Set the ambient temperature to 18 °C, and the object reads right
while the ice is pushed about 14 °C too cold. Set it to 0 °C, and the ice reads right while the object is pushed too
warm by about as much.

## Why Laser rangefinder is experimental

DJI's correction treats 120 m of air as letting through about half the radiation that 5 m of air does. Whether real
air absorbs that much at drone heights hasn't been measured for this plugin.

The one comparison seen so far points the other way. A user flying over a glacier at 120 m reported that measuring
with 120 m put either the ice or a reference station about 14 °C off, depending on the ambient temperature entered.
Measuring with the camera's recorded 5 m put both close to their known temperatures. That is one report, not a
measurement of the plugin's, but it suggests DJI's correction over-corrects at drone heights.

The rangefinder also brings problems of its own:

- **The temperatures no longer match the camera or DJI's tools.** They differ from the photo as its camera recorded
  it, by several degrees at flight heights and most in the coldest and warmest surfaces.
- **One reading covers the whole frame**, from the point the laser hit.
- **Readings are clamped to 25 m** on most cameras, so mapping flights get a distance that is neither the recorded
  one nor the real one.
- **Photos without a valid reading fall back** to the recorded distance, so one flight can mix distances.

So the plugin measures **As recorded** by default, as the drone's thermal camera was set up for the flight. Laser
rangefinder stays as a choice for testing. If you try it, or a distance of your own, check the result against
something of known temperature in the scene, such as melting ice at 0 °C, water, or an object you measured. The frame
page's **Measure again** shows one frame at several distances side by side
([Measurement settings](measurement.md#trying-other-values-on-one-frame)).

## What each output records

Every temperature TIFF records the distance it was measured with, and where that distance came from: `rangefinder`,
`embedded` (as recorded) or `option` (set for all photos). See [The converted images](converted-images.md). A
workset keeps the settings it was converted with.
