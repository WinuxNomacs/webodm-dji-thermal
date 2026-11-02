# Measurement settings

A thermal camera measures the infrared radiation reaching it, not temperature. To turn that into the temperature of
the surface, dji-thermal-cli (like DJI's own software) needs a few values about the surface and the air between it
and the camera. These are the measurement settings. The DJI Thermal Task panel and the Workset Creation Settings ask for
the same values, in the same order.

**Left empty, each photo keeps the value its camera recorded.** The pilot sets these in DJI's flight app, and the
camera writes them into each photo. Each field shows the recorded value (in the DJI Thermal Analyzer, the flight's
median) and the range the camera accepts.

## Emissivity

How well the surface gives off infrared radiation, from 0 to 1. This one matters most.

- Most natural and building surfaces are high: vegetation, soil, water, concrete, brick, asphalt, roofing felt,
  painted surfaces and skin are about 0.90 to 0.98.
- Bare or polished metal is low (often below 0.3). Its readings mostly show what it reflects, and are unreliable
  whatever value you set.

Set the emissivity of the surface you care about. With one value for the whole flight, surfaces of other materials
will be off. To compare surfaces of other materials afterwards, the Thermal Inspector's
[correction](quickstart-inspector.md#7-correcting-for-another-emissivity) shows approximately what they'd measure
with another emissivity and reflected temperature.

## Reflected temperature

Every surface reflects some of its surroundings' radiation, and more so the lower its emissivity. This is the
temperature of what the surface reflects. For surfaces facing up, that's mostly the sky, which can be far colder
than the air on a clear day. With a high emissivity it changes little.

## Ambient temperature and relative humidity

The air between the camera and the surface absorbs some radiation. The air temperature and humidity, with the
distance, tell how much. The effect is small at drone distances. The H20T and the XT S don't use the ambient
temperature, and the form says so.

## Distance to the target

How far the surface is from the camera, for the same air correction. Three choices:

- **Laser rangefinder, else as recorded** (the default): each photo's laser rangefinder distance where it has a
  valid one, else the distance its camera recorded. Of the photos checked, every M4T photo has one; DJI's sample
  images have none.
- **As recorded**: the distance the camera recorded. It's usually a fixed 5 m whatever the flight height. DJI's own
  apps use it, so choose this to match their temperatures exactly.
- **Set for all photos**: one distance you type.

With the rangefinder's distance, temperatures differ slightly from DJI's apps, but they're nearer the truth when
the camera recorded 5 m and the drone flew at 20 m.

## Temperature unit

The unit of the values you type: Celsius, Fahrenheit or Kelvin. The DJI Thermal Task's images are always in degrees
Celsius. In the Workset Creation Settings, **Unit of the files** sets the unit of a workset's temperature TIFFs
separately.

## Normalize and harmonize

The camera recalibrates itself during a flight, and the recorded ambient and reflected temperatures can change from
photo to photo. So overlapping frames of the same ground can read a degree or two apart, and a map made from them
shows seams. The Workset Creation Settings' Frames section has two settings for it, and the DJI Thermal Task panel
has the same two (the task's photos are then converted by a workset of its dataset):

- **Normalize** measures every frame with one ambient and reflected temperature: the flight's medians of the values
  the frames recorded (a value typed in Measurement is used instead). It's quick, and removes the jumps where the
  recorded values change.
- **Harmonize** also removes each frame's drift against the frames overlapping it, found by comparing their
  overlaps as a mosaic does. It takes longer, and frames that can't be placed (oblique, or without a position) keep
  their drift. Ticking it ticks Normalize. The WebODM plan recommends it for processing into a map.

## Trying other values on one frame

The frame page's **Measure again** measures one frame with other values for the distance, humidity, emissivity,
reflected and ambient temperature, exactly as a workset with them would, and shows it beside the frame as converted
(see [One frame at a time](quickstart-worksets.md#one-frame-at-a-time)). It's the quick way to see what a value
changes before converting the whole flight with it: **New workset with these** then fills in the Workset Creation
Settings. The Thermal Inspector's correction, on the map, is an approximation instead, for comparing surfaces.

A workset made before Harmonize existed with Normalize ticked did both, and shows both ticked. The mosaic viewer's
**Harmonized** mosaic is always harmonized, whatever the workset's settings.
