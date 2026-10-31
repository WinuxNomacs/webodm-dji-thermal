# The converted images

## A Thermal Task's images

Each thermal R-JPEG becomes a single-band 32-bit float TIFF of its temperatures in degrees Celsius, measured with
the [measurement settings](measurement.md) of the task. The photos themselves aren't kept.

The TIFF keeps all of the photo's EXIF and DJI XMP metadata, including what ODM uses: GPS, altitudes, capture time,
camera and gimbal angles, and RTK accuracy. It's marked as a thermal band (`Camera:BandName` = `LWIR`), so ODM
processes it as thermal.

Its XMP also records how it was measured, as dji-thermal-cli's own outputs do (namespace
`urn:dji-thermal-cli:xmp:1.0`):

| Tag | What it holds |
| --- | --- |
| `Distance` | the distance used, in metres |
| `DistanceSource` | `rangefinder`, `embedded` (as recorded) or `option` (set for all photos) |
| `Emissivity` | the emissivity used |
| `Humidity` | the relative humidity used, in % |
| `ReflectedTemperatureC` | the reflected temperature used, in °C |
| `AmbientTemperatureC` | the ambient temperature used, in °C |
| `Software` | what measured it: dji-thermal-cli's built-in port or DJI's own SDK |

## A workset's files

A workset writes the outputs chosen in its settings: temperature TIFFs in °C, °F or K, colour PNGs, 16-bit grey,
raw counts, DJI R-JPEGs and the others dji-thermal-cli writes. A WebODM task made from a workset uses its °C
temperature TIFFs. **Download all**, in the workset's menu, gives them all as a zip, with the mosaics.
