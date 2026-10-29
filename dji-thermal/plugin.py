from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from app.plugins import Menu, MountPoint, PluginBase, logger, signals

from . import analyzer_api, converter, datasets
from .analyzer_pages import dataset_page, datasets_page
from .api import Describe, TaskConvert
from .page import sdk_page

DATASET = r'datasets/(?P<pk>[0-9a-f-]{36})'


class Plugin(PluginBase):
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
            MountPoint('sdk/$', lambda request: sdk_page(request, template)),
        ]

    def include_js_files(self):
        return ['main.js']

    def build_jsx_components(self):
        return ['thermal/ThermalTaskButton.jsx']

    def api_mount_points(self):
        return [
            MountPoint('describe$', Describe.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)/convert$', TaskConvert.as_view()),
            MountPoint('datasets$', analyzer_api.DatasetListCreate.as_view()),
            MountPoint(DATASET + '$', analyzer_api.DatasetDetail.as_view()),
            MountPoint(DATASET + '/upload$', analyzer_api.DatasetUpload.as_view()),
            MountPoint(DATASET + '/analyze$', analyzer_api.DatasetAnalyze.as_view()),
            MountPoint(DATASET + '/cancel$', analyzer_api.DatasetCancel.as_view()),
            MountPoint(DATASET + '/thumbnail$', analyzer_api.DatasetThumbnail.as_view()),
        ]


@receiver(signals.task_removing, dispatch_uid="dji_thermal_task_removing")
def task_removing(sender, task_id, **kwargs):
    datasets.task_removing(task_id)
