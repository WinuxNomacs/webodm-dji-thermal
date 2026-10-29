from app.plugins import MountPoint, PluginBase, logger

from . import converter
from .api import Describe, TaskConvert
from .page import sdk_page


class Plugin(PluginBase):
    def enable(self):
        ok, message = converter.decoder_status()
        if ok:
            logger.info("DJI Thermal: {}".format(message))
        else:
            logger.warning("DJI Thermal plugin enabled, but {}".format(message))

    def app_mount_points(self):
        # Superusers only, linked from the Administration menu by main.js (WebODM's menu hook shows to every user)
        template = self.template_path("sdk.html")
        return [MountPoint('$', lambda request: sdk_page(request, template))]

    def include_js_files(self):
        return ['main.js']

    def build_jsx_components(self):
        return ['thermal/ThermalTaskButton.jsx']

    def api_mount_points(self):
        return [
            MountPoint('describe$', Describe.as_view()),
            MountPoint(r'projects/(?P<project_pk>\d+)/tasks/(?P<pk>[^/.]+)/convert$', TaskConvert.as_view()),
        ]
