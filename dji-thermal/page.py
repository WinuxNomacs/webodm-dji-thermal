"""
The plugin's DJI Thermal page, under Administration, for superusers only: which SDK computes the temperatures,
uploading or updating DJI's own SDK, checking it and removing it (see sdk).
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import redirect, render
from django.utils.translation import gettext as _

from . import api, sdk

ACTIONS = ('upload', 'check', 'remove')


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
                messages.success(request, {'upload': _upload, 'check': _check, 'remove': _remove}[action](request))
            except sdk.SdkError as e:
                messages.error(request, str(e))
        return redirect(request.path)

    return render(request, template, {'title': _("DJI Thermal"), 'status': sdk.status(), 'env': sdk.ENV})
