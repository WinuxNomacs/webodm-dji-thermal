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

// The plugin's scripts a page needs, loaded only there (WebODM loads include_js_files on every page), in order (each
// uses those before it), at main.js's own version (plugin.py include_js_files), each once whichever page asks for it.
// Resolves once they ran.
window.DjiThermalScripts = (function(){
    var me = document.currentScript && document.currentScript.src || "";
    var base = me ? me.replace(/main\.js(\?.*)?$/, "") : "/plugins/dji-thermal/";
    var query = (/\?v=[^&]*/.exec(me) || [""])[0];
    var loaded = {};
    function one(name){
        if (!loaded[name]){
            loaded[name] = new Promise(function(resolve, reject){
                var s = document.createElement("script");
                s.src = load.url(name);
                s.onload = resolve;
                s.onerror = function(){ reject(new Error("Could not load " + name)); };
                document.head.appendChild(s);
            });
            loaded[name].catch(function(){ delete loaded[name]; });
        }
        return loaded[name];
    }
    var load = function(names){
        return names.reduce(function(p, name){ return p.then(function(){ return one(name); }); }, Promise.resolve());
    };
    load.url = function(name){ return base + name + query; };
    return load;
})();

// The Thermal Inspector's (2D map), and the 3D one's after them (it uses their helpers)
var NAMES = ["scale.js", "recolour.js", "regions.js", "split.js", "preview.js", "frames.js", "frames3d.js", "inspector.js"];
var NAMES_3D = ["mesh_index.js", "model3d.js", "pointcloud3d.js", "inspector3d.js"];
window.DjiThermalMapScripts = function(){ return window.DjiThermalScripts(NAMES); };

// The Thermal Inspector on WebODM's 2D map (inspector.js, with frames.js's source frames window and frames3d.js's
// photos that saw a point), with WebODM's Leaflet:
// its button shows when the map has a thermal orthophoto or the project has workset mosaics
PluginsAPI.Map.willAddControls(["leaflet", "dji-thermal/inspector.css", "dji-thermal/split.css", "dji-thermal/frames.css"], function(args, L){
    window.DjiThermalMapScripts().then(function(){
        if (window.ThermalInspector) window.ThermalInspector.create(args, L);
    }, function(e){
        if (window.console) window.console.warn("DJI Thermal: the Thermal Inspector is not available: " + e.message);
    });
});

// The 3D Thermal Inspector on WebODM's 3D page (inspector3d.js; the model as temperatures: model3d.js): the model
// coloured from its temperatures as soon as it's shown, and the panel's button, once the server says the page's
// model holds them. WebODM's trigger takes the first answer only (ApiFactory.js; another plugin's button answers at
// once): the button is given at once, with no dependencies to wait for, and shows itself when it can; its
// stylesheets are added here. The 2D Inspector's scripts come first: the 3D one uses their helpers.
window.DjiThermal3DScripts = function(){
    ["inspector.css", "frames.css", "inspector3d.css"].forEach(function(name){
        var href = window.DjiThermalScripts.url(name);
        if (document.querySelector('link[href="' + href + '"]')) return;
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
    });
    return window.DjiThermalMapScripts().then(function(){ return window.DjiThermalScripts(NAMES_3D); });
};
PluginsAPI.ModelView.addActionButton(function(args){
    function Button(props){
        React.Component.call(this, props);
        this.state = {inspector: null};
    }
    Button.prototype = Object.create(React.Component.prototype);
    Button.prototype.constructor = Button;
    Button.prototype.componentDidMount = function(){
        var self = this;
        window.DjiThermal3DScripts().then(function(){
            return window.ThermalInspector3D.create(args.viewer);
        }).then(function(inspector){
            if (inspector && !self.unmounted) self.setState({inspector: inspector});
        }, function(e){
            if (window.console) window.console.warn("DJI Thermal: the 3D Thermal Inspector is not available: " + e.message);
        });
    };
    Button.prototype.componentWillUnmount = function(){
        this.unmounted = true;
        if (this.state.inspector) this.state.inspector.detach();
    };
    Button.prototype.render = function(){
        var inspector = this.state.inspector;
        if (!inspector || !inspector.toggle) return null;
        return React.createElement("button", {type: "button", className: "btn btn-sm btn-secondary dt-inspector3d-button",
            title: "Thermal Inspector", onClick: function(){ inspector.toggle(); }},
            React.createElement("i", {className: "fa fa-thermometer-half"}));
    };
    return React.createElement(Button);
});

// A component of the plugin's built bundles (public/build), loaded once it is shown. A task panel's button can't wait
// for its dependencies: WebODM's trigger stops listening after the first answer (ApiFactory.js), which the buttons
// below give at once
window.DjiThermalLazy = function(bundle){
    function Lazy(props){
        React.Component.call(this, props);
        this.state = {component: null};
    }
    Lazy.prototype = Object.create(React.Component.prototype);
    Lazy.prototype.constructor = Lazy;
    Lazy.prototype.componentDidMount = function(){
        var self = this;
        return PluginsAPI.SystemJS.import(bundle).then(function(m){
            if (!self.unmounted) self.setState({component: m["default"] || m});
        });
    };
    Lazy.prototype.componentWillUnmount = function(){ this.unmounted = true; };
    Lazy.prototype.render = function(){
        return this.state.component ? React.createElement(this.state.component, this.props) : null;
    };
    return Lazy;
};

// A DJI Thermal Task's photos being normalized or harmonized in a workset: its progress in the task's panel until the
// task starts, so a refreshed page still shows it (thermal/WorksetProgress.jsx). Added before the Thermal dataset
// button, so it comes first in the panel
var DjiThermalWorksetProgress = window.DjiThermalLazy("dji-thermal/build/WorksetProgress.js");
PluginsAPI.Dashboard.addTaskActionButton(function(args){
    var task = args.task || {};
    if (!task.partial || !task.id || task.project == null || (task.tags || []).indexOf(".dji-thermal-task") === -1) return null;
    return React.createElement(DjiThermalWorksetProgress, {projectId: task.project, taskId: task.id});
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
