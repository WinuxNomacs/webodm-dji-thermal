from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from app.plugins import Menu, MountPoint, PluginBase, logger, signals

from . import analyzer_api, converter, datasets, inspector_api
from .analyzer_pages import dataset_page, datasets_page, version, viewer_page
from .api import Describe, TaskConvert
from .page import sdk_page

DATASET = r'datasets/(?P<pk>[0-9a-f-]{36})'
CONVERSION = DATASET + r'/conversions/(?P<cid>[0-9a-f]{12})'
TASK = r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)'


class Plugin(PluginBase):
    def check_requirements(self):
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
            logger.warning("DJI Thermal plugin enabled, but {}".format(message))

    def main_menu(self):
        return [Menu(_("Thermal Analyzer"), self.public_url(""), "fa fa-thermometer-half fa-fw")]

    def app_mount_points(self):
        # The SDK page is for superusers only, linked from the Administration menu by main.js (WebODM's menu hook
        # shows to every user)
        template = self.template_path("sdk.html")
        return [
            MountPoint('$', datasets_page(self)),
            MountPoint(r'dataset/(?P<dataset_id>[0-9a-f-]{36})$', dataset_page(self)),
            MountPoint(r'dataset/(?P<dataset_id>[0-9a-f-]{36})/conversion/(?P<cid>[0-9a-f]{12})$', viewer_page(self)),
            MountPoint('sdk/$', lambda request: sdk_page(request, template)),
        ]

    def include_js_files(self):
        # WebODM only turns these into URLs: versioned like the Analyzer's pages' (analyzer_pages.version)
        v = version(self.get_path("public"))
        return [name + "?v=" + v for name in ['main.js', 'scale.js', 'regions.js', 'inspector.js']]

    def build_jsx_components(self):
        # Leaflet: WebODM's own, for the mosaic viewer (see thermal/Leaflet.js)
        return ['thermal/ThermalTaskButton.jsx', 'thermal/Leaflet.js']

    def api_mount_points(self):
        return [
            MountPoint('describe$', Describe.as_view()),
            MountPoint(TASK + '/inspector/point$', inspector_api.InspectorPoint.as_view()),
            MountPoint(TASK + '/inspector/region$', inspector_api.InspectorRegion.as_view()),
            MountPoint(TASK + r'/inspector/tiles/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)$', inspector_api.InspectorTiles.as_view()),
            MountPoint(TASK + r'/inspector/isotherm/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)$', inspector_api.InspectorIsotherm.as_view()),
            MountPoint(TASK + '/inspector/palette$', inspector_api.InspectorPalette.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)/convert$', TaskConvert.as_view()),
            MountPoint('datasets$', analyzer_api.DatasetListCreate.as_view()),
            MountPoint(DATASET + '$', analyzer_api.DatasetDetail.as_view()),
            MountPoint(DATASET + '/upload$', analyzer_api.DatasetUpload.as_view()),
            MountPoint(DATASET + '/analyze$', analyzer_api.DatasetAnalyze.as_view()),
            MountPoint(DATASET + '/cancel$', analyzer_api.DatasetCancel.as_view()),
            MountPoint(DATASET + '/thumbnail$', analyzer_api.DatasetThumbnail.as_view()),
            MountPoint(DATASET + '/files$', analyzer_api.DatasetFiles.as_view()),
            MountPoint(DATASET + '/conversions$', analyzer_api.ConversionListCreate.as_view()),
            MountPoint(CONVERSION + '$', analyzer_api.ConversionDetail.as_view()),
            MountPoint(CONVERSION + '/cancel$', analyzer_api.ConversionCancel.as_view()),
            MountPoint(CONVERSION + '/download$', analyzer_api.ConversionDownload.as_view()),
            MountPoint(CONVERSION + '/task$', analyzer_api.ConversionTask.as_view()),
            MountPoint(CONVERSION + '/parent$', analyzer_api.ConversionParent.as_view()),
            MountPoint(CONVERSION + '/mosaics$', analyzer_api.Mosaics.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/tiles/(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)\.png$',
                       analyzer_api.MosaicTile.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/point$', analyzer_api.MosaicPoint.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/frames$', analyzer_api.MosaicFrames.as_view()),
            MountPoint(CONVERSION + r'/mosaics/(?P<tab>[a-z_]+)/frames/(?P<index>\d+)\.png$',
                       analyzer_api.MosaicFrame.as_view()),
            MountPoint('preferences$', analyzer_api.Preferences.as_view()),
            MountPoint('display$', analyzer_api.Display.as_view()),
        ]


@receiver(signals.task_removing, dispatch_uid="dji_thermal_task_removing")
def task_removing(sender, task_id, **kwargs):
    datasets.task_removing(task_id)
