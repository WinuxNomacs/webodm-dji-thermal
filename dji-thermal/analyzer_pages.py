"""
The Thermal Analyzer's pages, at the root of WebODM's menu for every user: the datasets of the projects they can
view, a dataset's page, and a conversion's mosaics on a map (with WebODM's base layers). Their content comes from the Analyzer's API (analyzer_api), drawn by the scripts in
public/.
"""

from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import render
from django.utils.translation import gettext as _

from app.models import Basemap, Task

from . import conversions, datasets


def common(plugin, request):
    # display: the user's preferences (conversions.display), read by analyzer_core.js
    return {'title': _("Thermal Analyzer"), 'public': plugin.public_url(""),
            'api': "/api/plugins/{}/".format(plugin.get_name()), 'display': conversions.display(request.user)}


def datasets_page(plugin):
    @login_required
    def view(request):
        return render(request, plugin.template_path("datasets.html"), common(plugin, request))
    return view


def dataset_page(plugin):
    @login_required
    def view(request, dataset_id):
        try:
            task = datasets.get(request.user, dataset_id)
        except Task.DoesNotExist:
            raise Http404("No such dataset") from None
        return render(request, plugin.template_path("dataset.html"),
                      dict(common(plugin, request), dataset={'id': str(task.id), 'name': datasets.name_of(task)}))
    return view


def viewer_page(plugin):
    @login_required
    def view(request, dataset_id, cid):
        try:
            task = datasets.get(request.user, dataset_id)
        except Task.DoesNotExist:
            raise Http404("No such dataset") from None
        record = conversions.record(task, cid)
        if not record:
            raise Http404("No such workset")
        return render(request, plugin.template_path("viewer.html"), dict(
            common(plugin, request), dataset={'id': str(task.id), 'name': datasets.name_of(task)},
            conversion={'id': cid, 'name': record.get('name') or cid}, basemaps=Basemap.get_cached_basemaps()))
    return view
