# DJI Thermal plugin for WebODM

Process DJI radiometric thermal photos (R-JPEG) in WebODM and get temperature maps: the plugin converts each
R-JPEG into a temperature image (degrees Celsius) as it is uploaded, then WebODM processes them like any other
task.

**In development**: nothing is released yet. See [upcoming-changes.md](upcoming-changes.md) for the plan.

Temperatures are computed with [dji-thermal-cli](https://pypi.org/project/dji-thermal-cli/), a pure-Python
implementation of DJI's Thermal SDK: no native library and no outside service.

## License

[AGPL-3.0](LICENSE).
