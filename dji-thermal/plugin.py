import os

from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from app.plugins import Menu, MountPoint, PluginBase, logger, signals

from . import analyzer_api, converter, datasets, frames_api, inspector_api
from .analyzer_pages import dataset_page, datasets_page, frame_page, version, viewer_page
from .api import Describe, TaskConvert, TaskDataset, TaskWorkset, TaskWorksetStart
from .page import sdk_page

DATASET = r'datasets/(?P<pk>[0-9a-f-]{36})'
CONVERSION = DATASET + r'/conversions/(?P<cid>[0-9a-f]{12})'
TASK = r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)'


class Plugin(PluginBase):
    def check_requirements(self):
        # Packages installed for another Python (WebODM upgraded from 3.x to 4.0.0): without the file of what was
        # installed, WebODM installs them again for this one (see converter)
        packages = self.get_python_packages_path()
        if converter.built_for_another_python(packages):
            logger.info("DJI Thermal: its packages were installed for another Python: installing them again")
            try:
                os.remove(os.path.join(packages, "install_md5"))
            except OSError:
                pass
        # After WebODM installs the requirements: the old versions' metadata pip leaves (see converter)
        super().check_requirements()
        try:
            removed = converter.remove_stale_metadata(self.get_python_packages_path(), self.get_path("requirements.txt"))
        except OSError as e:
            logger.warning("DJI Thermal: could not tidy its packages' metadata: {}".format(e))
            return
        if removed:
            logger.info("DJI Thermal: removed the metadata of versions no longer pinned: {}".format(", ".join(removed)))

    def enable(self):
        ok, message = converter.decoder_status()
        if ok:
            logger.info("DJI Thermal: {}".format(message))
        else:
            logger.warning("DJI Thermal Analyzer plugin enabled, but {}".format(message))

    def main_menu(self):
        return [Menu(_("DJI Thermal Analyzer"), self.public_url(""), "fa fa-thermometer-half fa-fw")]

    def app_mount_points(self):
        # The SDK page is for superusers only, linked from the Administration menu by main.js (WebODM's menu hook
        # shows to every user)
        template = self.template_path("sdk.html")
        return [
            MountPoint('$', datasets_page(self)),
            MountPoint(r'dataset/(?P<dataset_id>[0-9a-f-]{36})$', dataset_page(self)),
            MountPoint(r'dataset/(?P<dataset_id>[0-9a-f-]{36})/conversion/(?P<cid>[0-9a-f]{12})$', viewer_page(self)),
            MountPoint(r'dataset/(?P<dataset_id>[0-9a-f-]{36})/conversion/(?P<cid>[0-9a-f]{12})/frame$', frame_page(self)),
            MountPoint('sdk/$', lambda request: sdk_page(request, template)),
        ]

    def include_js_files(self):
        # On every page. WebODM only turns these into URLs: versioned like the Analyzer's pages' (analyzer_pages.version).
        # The Thermal Inspector's scripts are loaded by main.js on map pages only, at the same version.
        v = version(self.get_path("public"))
        return [name + "?v=" + v for name in ['units.js', 'main.js']]

    def build_jsx_components(self):
        # WorksetProgress: in a task's panel (main.js); Leaflet: WebODM's own, for the mosaic viewer (see thermal/Leaflet.js)
        return ['thermal/ThermalTaskButton.jsx', 'thermal/WorksetProgress.jsx', 'thermal/Leaflet.js']

    def api_mount_points(self):
        return [
            MountPoint('describe$', Describe.as_view()),
            MountPoint(TASK + '/inspector/point$', inspector_api.InspectorPoint.as_view()),
            MountPoint(TASK + '/inspector/region$', inspector_api.InspectorRegion.as_view()),
            MountPoint(TASK + r'/inspector/tiles/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)$', inspector_api.InspectorTiles.as_view()),
            MountPoint(TASK + r'/inspector/isotherm/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)$', inspector_api.InspectorIsotherm.as_view()),
            MountPoint(TASK + r'/inspector/values/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)$', inspector_api.InspectorValues.as_view()),
            MountPoint(TASK + '/inspector/curve$', inspector_api.InspectorCurve.as_view()),
            MountPoint(TASK + '/inspector/palette$', inspector_api.InspectorPalette.as_view()),
            MountPoint(TASK + '/inspector/measurements$', inspector_api.InspectorMeasurements.as_view()),
            MountPoint(TASK + r'/inspector/measurements/(?P<mid>[0-9a-f]{12})$', inspector_api.InspectorMeasurement.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/inspector/mosaics$', inspector_api.InspectorMosaics.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/inspector/palette$', inspector_api.InspectorProjectPalette.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)/convert$', TaskConvert.as_view()),
            MountPoint(TASK + '/dataset$', TaskDataset.as_view()),
            MountPoint(TASK + '/workset$', TaskWorkset.as_view()),
            MountPoint(TASK + '/workset/start$', TaskWorksetStart.as_view()),
            MountPoint('datasets$', analyzer_api.DatasetListCreate.as_view()),
            MountPoint(DATASET + '$', analyzer_api.DatasetDetail.as_view()),
            MountPoint(DATASET + '/upload$', analyzer_api.DatasetUpload.as_view()),
            MountPoint(DATASET + '/remove$', analyzer_api.DatasetRemoveFiles.as_view()),
            MountPoint(DATASET + '/analyze$', analyzer_api.DatasetAnalyze.as_view()),
            MountPoint(DATASET + '/cancel$', analyzer_api.DatasetCancel.as_view()),
            MountPoint(DATASET + '/thumbnail$', analyzer_api.DatasetThumbnail.as_view()),
            MountPoint(DATASET + '/files$', analyzer_api.DatasetFiles.as_view()),
            MountPoint(DATASET + '/conversions$', analyzer_api.ConversionListCreate.as_view()),
            MountPoint(CONVERSION + '$', analyzer_api.ConversionDetail.as_view()),
            MountPoint(CONVERSION + '/cancel$', analyzer_api.ConversionCancel.as_view()),
            MountPoint(CONVERSION + '/figures$', analyzer_api.ConversionFigures.as_view()),
            MountPoint(CONVERSION + '/remove$', analyzer_api.ConversionRemoveFrames.as_view()),
            MountPoint(CONVERSION + '/download$', analyzer_api.ConversionDownload.as_view()),
            MountPoint(CONVERSION + '/task$', analyzer_api.ConversionTask.as_view()),
            MountPoint(CONVERSION + '/parent$', analyzer_api.ConversionParent.as_view()),
            MountPoint(CONVERSION + '/mosaics$', analyzer_api.Mosaics.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/tiles/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)\.png$',
                       analyzer_api.MosaicTile.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<kind>[a-z_]+)/preview$', analyzer_api.MosaicPreview.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/point$', analyzer_api.MosaicPoint.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/values/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)\.png$',
                       analyzer_api.MosaicValues.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/curve$', analyzer_api.MosaicCurve.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/region$', analyzer_api.MosaicRegion.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/isotherm/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)\.png$',
                       analyzer_api.MosaicIsotherm.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/frames$', analyzer_api.MosaicFrames.as_view()),
            MountPoint(CONVERSION + '/measurements$', analyzer_api.MosaicMeasurements.as_view()),
            MountPoint(CONVERSION + r'/measurements/(?P<mid>[0-9a-f]{12})$', analyzer_api.MosaicMeasurement.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/frames/(?P<index>\d+)\.png$',
                       analyzer_api.MosaicFrame.as_view()),
            MountPoint(CONVERSION + '/frames$', frames_api.WorksetFrames.as_view()),
            MountPoint(CONVERSION + '/frame$', frames_api.WorksetFrame.as_view()),
            MountPoint(CONVERSION + '/frame/values$', frames_api.WorksetFrameValues.as_view()),
            MountPoint(CONVERSION + '/frame/region$', frames_api.WorksetFrameRegion.as_view()),
            MountPoint(CONVERSION + '/frame/download$', frames_api.WorksetFrameDownload.as_view()),
            MountPoint(CONVERSION + '/frame/measurements$', frames_api.WorksetFrameMeasurements.as_view()),
            MountPoint(CONVERSION + r'/frame/measurements/(?P<mid>[0-9a-f]{12})$', frames_api.WorksetFrameMeasurement.as_view()),
            MountPoint('preferences$', analyzer_api.Preferences.as_view()),
            MountPoint('display$', analyzer_api.Display.as_view()),
            MountPoint('unit$', analyzer_api.Unit.as_view()),
        ]


@receiver(signals.task_removing, dispatch_uid="dji_thermal_task_removing")
def task_removing(sender, task_id, **kwargs):
    datasets.task_removing(task_id)
