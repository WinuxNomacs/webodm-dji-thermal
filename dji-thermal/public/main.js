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
