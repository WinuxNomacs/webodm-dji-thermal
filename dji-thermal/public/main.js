// The Thermal Task button beside each project's "Select Images and GCP" (thermal/ThermalTaskButton.jsx, built by
// WebODM's webpack when the plugin is installed)
PluginsAPI.Dashboard.addNewTaskButton(
    ["dji-thermal/build/ThermalTaskButton.js", "dji-thermal/build/ThermalTaskButton.css"],
    function(args, ThermalTaskButton){
        return React.createElement(ThermalTaskButton, {
            projectId: args.projectId,
            onNewTaskAdded: args.onNewTaskAdded
        });
    }
);

// The Thermal Inspector on WebODM's 2D map (inspector.js, with frames.js's source frames window), with WebODM's Leaflet:
// its button shows when the map has a thermal orthophoto or the project has workset mosaics
PluginsAPI.Map.willAddControls(["leaflet", "dji-thermal/inspector.css", "dji-thermal/frames.css"], function(args, L){
    if (window.ThermalInspector) window.ThermalInspector.create(args, L);
});

// A Thermal dataset button on a task's expanded panel: on the dataset's own task (its hidden tag) and on a task linked
// to one (the tag naming the dataset, see conversion_tasks.py). A task made by the Thermal Task button (its tag), or
// one with a thermal orthophoto, that has none gets Create thermal dataset instead: the task becomes a dataset itself
// (api.py TaskDataset), then the dataset's page opens, to add the flight's photos.
PluginsAPI.Dashboard.addTaskActionButton(function(args){
    var task = args.task || {};
    var tags = task.tags || [];
    var id = null, thermal = false;
    for (var i = 0; i < tags.length; i++){
        if (tags[i] === ".dji-thermal-dataset") id = task.id;
        else if (tags[i].indexOf(".dji-thermal-from-") === 0 && !id) id = tags[i].slice(".dji-thermal-from-".length);
        else if (tags[i] === ".dji-thermal-task") thermal = true;
    }
    var bands = task.orthophoto_bands || [];
    if (bands[0] && String(bands[0].description || "").toLowerCase() === "lwir") thermal = true;
    if (!/^[0-9a-f-]{36}$/.test(id || "")) id = null;
    if (id){
        return React.createElement("a", {
            className: "btn btn-sm btn-primary",
            href: "/plugins/dji-thermal/dataset/" + id,
            title: "Open the thermal dataset in the DJI Thermal Analyzer"
        }, React.createElement("i", {className: "fa fa-thermometer-half fa-fw"}), " Thermal dataset");
    }
    if (!thermal || !task.id || task.project == null) return null;
    return React.createElement("button", {
        type: "button",
        className: "btn btn-sm btn-primary",
        title: "Make a dataset for this task in the DJI Thermal Analyzer, to hold the flight's photos, and open it",
        onClick: function(e){ window.DjiThermalTaskDataset.create(task, e.currentTarget); }
    }, React.createElement("i", {className: "fa fa-thermometer-half fa-fw"}), " Create thermal dataset");
});

window.DjiThermalTaskDataset = {
    open: function(url){ window.location.assign(url); },

    // Makes (or finds) the task's dataset, then opens its page; a refusal is said, and the button can be pressed again
    create: function(task, button){
        var self = this;
        var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie || "");
        button.disabled = true;
        return fetch("/api/plugins/dji-thermal/projects/" + task.project + "/tasks/" + task.id + "/dataset", {
            method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": m ? decodeURIComponent(m[1]) : ""}
        }).then(function(res){
            return res.json().catch(function(){ return {}; }).then(function(body){
                if (!res.ok || !body.id) throw new Error(body.detail || body[0] || "The server answered " + res.status);
                self.open("/plugins/dji-thermal/dataset/" + body.id);
            });
        }).catch(function(e){
            button.disabled = false;
            window.alert("Could not create the thermal dataset: " + e.message);
        });
    }
};

// The DJI Thermal page under Administration, after Plugins: WebODM shows that menu to staff only, and the page itself
// answers superusers only. WebODM's own menu hook would show it to every user.
(function(){
    function addAdminLink(){
        var plugins = document.querySelector('#side-menu a[href="/admin/app/plugin/"]');
        if (!plugins || document.getElementById("dji-thermal-admin-menu")) return;
        var item = document.createElement("li");
        item.id = "dji-thermal-admin-menu";
        var link = document.createElement("a");
        link.href = "/plugins/dji-thermal/sdk/";
        link.innerHTML = '<i class="fa fa-thermometer-half fa-fw"></i> ';
        link.appendChild(document.createTextNode("DJI Thermal"));
        item.appendChild(link);
        plugins.parentNode.parentNode.insertBefore(item, plugins.parentNode.nextSibling);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addAdminLink);
    else addAdminLink();
})();
