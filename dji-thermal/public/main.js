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

// A Thermal dataset button on a task's expanded panel: on the dataset's own task (its hidden tag) and on a task made
// from one of its worksets (the tag naming the dataset, see conversion_tasks.py)
PluginsAPI.Dashboard.addTaskActionButton(function(args){
    var tags = (args.task && args.task.tags) || [];
    var id = null;
    for (var i = 0; i < tags.length; i++){
        if (tags[i] === ".dji-thermal-dataset") id = args.task.id;
        else if (tags[i].indexOf(".dji-thermal-from-") === 0 && !id) id = tags[i].slice(".dji-thermal-from-".length);
    }
    if (!/^[0-9a-f-]{36}$/.test(id || "")) return null;
    return React.createElement("a", {
        className: "btn btn-sm btn-primary",
        href: "/plugins/dji-thermal/dataset/" + id,
        title: "Open the thermal dataset in the Thermal Analyzer"
    }, React.createElement("i", {className: "fa fa-thermometer-half fa-fw"}), " Thermal dataset");
});

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
