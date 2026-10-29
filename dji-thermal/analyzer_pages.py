"""
The Thermal Analyzer's pages, at the root of WebODM's menu for every user: the datasets of the projects they can
view, and a dataset's page. Their content comes from the Analyzer's API (analyzer_api), drawn by the scripts in
public/.
"""

from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import render
from django.utils.translation import gettext as _

from app.models import Task

from . import datasets


def common(plugin):
    return {'title': _("Thermal Analyzer"), 'public': plugin.public_url(""),
            'api': "/api/plugins/{}/".format(plugin.get_name())}


def datasets_page(plugin):
    @login_required
    def view(request):
        return render(request, plugin.template_path("datasets.html"), common(plugin))
    return view


def dataset_page(plugin):
    @login_required
    def view(request, dataset_id):
        try:
            task = datasets.get(request.user, dataset_id)
        except Task.DoesNotExist:
            raise Http404("No such dataset") from None
        return render(request, plugin.template_path("dataset.html"),
                      dict(common(plugin), dataset={'id': str(task.id), 'name': datasets.name_of(task)}))
    return view
