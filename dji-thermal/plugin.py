from app.plugins import PluginBase, logger

from . import converter


class Plugin(PluginBase):
    # The upload flow that converts a task's R-JPEGs comes in the next phase (upcoming-changes.md)

    def enable(self):
        ok, message = converter.decoder_status()
        if ok:
            logger.info("DJI Thermal: {}".format(message))
        else:
            logger.warning("DJI Thermal plugin enabled, but {}".format(message))
