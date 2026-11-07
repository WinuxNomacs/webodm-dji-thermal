"""
The plugin's DJI Thermal page, under Administration, for superusers only: the default temperature unit, which SDK
computes the temperatures, uploading or updating DJI's own SDK, checking it and removing it (see sdk).
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import redirect, render
from django.utils.translation import gettext as _
from django.utils.translation import gettext_lazy

from . import api, conversions, sdk

ACTIONS = ('upload', 'check', 'remove', 'unit')
UNIT_NAMES = {'C': gettext_lazy("Celsius (°C)"), 'F': gettext_lazy("Fahrenheit (°F)")}


def _unit(request):
    try:
        conversions.set_default_unit(request.POST.get('default_unit'))
    except ValueError as e:
        raise sdk.SdkError(str(e)) from None
    return _("Temperatures are now shown in %(unit)s to users who haven't chosen a unit") % {
        'unit': UNIT_NAMES[conversions.default_unit()]}


def _upload(request):
    upload = request.FILES.get('sdk_zip')
    if upload is None:
        raise sdk.SdkError(_("Choose DJI's Thermal SDK zip to upload"))
    with api.work_folder() as folder:
        info = sdk.install(api.save_upload(upload, folder), zip_name=upload.name, user=request.user.username)
    return _("DJI's Thermal SDK %(version)s is installed (API revisions %(revisions)s): it now computes every "
             "photo's temperatures") % {'version': info['sdk_version'],
                                        'revisions': ', '.join(map(str, info['api_revisions']))}


def _check(request):
    found = sdk.check()
    return _("DJI's Thermal SDK %(version)s measured %(count)d sample images (API revisions %(revisions)s)") % {
        'version': found['sdk_version'], 'count': len(found['measured']),
        'revisions': ', '.join(map(str, found['api_revisions']))}


def _remove(request):
    sdk.remove()
    return _("DJI's Thermal SDK is removed: temperatures come from the built-in port again")


@login_required
def sdk_page(request, template):
    if not request.user.is_superuser:
        return HttpResponseForbidden()
    if request.method == 'POST':
        action = request.POST.get('action')
        if action in ACTIONS:
            try:
                messages.success(request, {'upload': _upload, 'check': _check, 'remove': _remove,
                                           'unit': _unit}[action](request))
            except sdk.SdkError as e:
                messages.error(request, str(e))
        return redirect(request.path)

    return render(request, template, {'title': _("DJI Thermal"), 'status': sdk.status(), 'env': sdk.ENV,
                                      'default_unit': conversions.default_unit(), 'units': UNIT_NAMES.items()})
