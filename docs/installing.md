# Installing

The plugin needs WebODM 3.3.2 or later, installed any of the ways WebODM is:

- **Docker**, on Linux, Windows or macOS. WebODM's macOS installer is a manager for Docker, so it's the same.
- **WebODM's native Windows installer**.

Both have been checked end to end: Docker on Linux, and the native installer on Windows.

## From WebODM's plugin list

Once the plugin is in WebODM's plugin directory: **Administration > Plugins**, find **DJI Thermal** and install it.

## From a release

1. Download `dji-thermal-X.Y.Z.zip` from the
   [releases](https://github.com/WinuxNomacs/webodm-dji-thermal/releases). Its sha256 is given there.
2. In WebODM: **Administration > Plugins > Load Plugin (.zip)**, and choose the zip.

The zip includes the plugin's built scripts, so WebODM needs no build tools of its own (the native Windows install
has none).

## What it installs

WebODM installs the plugin's requirements in the plugin's own folder: dji-thermal-cli, with numpy and Pillow at
WebODM's own versions. This needs an internet connection the first time. Restart WebODM if it asks you to.

The plugin calls no outside service: photos are converted, analyzed and mosaicked on your WebODM server. The maps'
base layers are WebODM's own, loaded by your browser as on WebODM's other maps.

## Notes by system

- **Native Windows, WebODM 3.3.2**: WebODM logs "Failed to install requirements.txt" for the plugin at each start
  and runs pip again, although the packages are installed and the plugin works. It's a WebODM bug that affects
  every plugin with requirements; it's fixed in WebODM releases after 3.3.2.
- **ARM servers** (such as Docker on an Apple Silicon Mac): everything works with the built-in port of DJI's SDK.
  [DJI's own Thermal SDK](dji-sdk.md) is built for x64 and x86 processors only, so it can't be used there.
