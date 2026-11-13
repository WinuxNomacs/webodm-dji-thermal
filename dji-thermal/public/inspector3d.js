// The 3D Thermal Inspector, on WebODM's 3D page of a task whose model holds temperatures (a DJI Thermal Task's, or a
// workset's): the model (model3d.js) and, later, the point cloud are *sources* of temperatures, each coloured in the
// user's palette from them, as the 2D map colours the orthophoto (recolour.js); the panel's tools read them.
// main.js adds it through PluginsAPI.ModelView.addActionButton, which hands it WebODM's Potree viewer; the task is the
// page's (its data-modelview element's data-task). The 2D Inspector's pure helpers (inspector.js's exports: the
// palette list, the temperature unit, corrections...) are used as they are.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var DEFAULT_PALETTE = "magma";      // WebODM's own for a thermal orthophoto, without the user's or the task's
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);
    var Model3D = root.ThermalModel3D || (typeof require !== "undefined" ? require("./model3d.js") : null);
    var Inspector = root.ThermalInspector || (typeof require !== "undefined" ? require("./inspector.js") : null);

    // The page's task ({id, project, available_assets, epsg, ...}), from WebODM's 3D page, or null
    function taskOf(doc) {
        var el = doc && doc.querySelector("[data-modelview]");
        try {
            var task = el && JSON.parse(el.getAttribute("data-task"));
            return task && task.id && task.project != null ? task : null;
        } catch (e) {
            return null;
        }
    }

    // The palette the model opens in: the user's (the Analyzer's preference), else the task's (chosen in DJI Thermal
    // Task), else WebODM's for a thermal orthophoto; each only if it's one the plugin draws (display: the preferences,
    // with the palette lists, or null on a public page)
    function openingPalette(display, description) {
        var names = Inspector.paletteOptions(display).map(function (o) { return o[0]; });
        var known = function (name) { return !!name && (!display || names.indexOf(name) !== -1); };
        if (display && known(display.palette)) return display.palette;
        if (known(description && description.palette)) return description.palette;
        return DEFAULT_PALETTE;
    }

    // How the sources are coloured, as recolour.js takes it, from the look ({colors, range: [low, high] (°C), adjust});
    // null until the palette's colours have come
    function styleOf(look) {
        if (!look.colors || !look.range) return null;
        var adjust = look.adjust || {};
        return {colors: look.colors, range: look.range, shares: Recolour.drawnShares(look.range[0], look.range[1], adjust),
                steps: null, sharpen: 0, isotherm: null, seams: false};
    }

    // The 3D Inspector on a viewer. deps: {fetchFn, document, THREE, path, setInterval, clearInterval}. A Promise of
    // the inspector ({sources, look, restyle(), detach()}), or null when the page's model doesn't hold temperatures
    function create(viewer, deps) {
        deps = deps || {};
        var doc = deps.document || root.document, fetchFn = deps.fetchFn || root.fetch.bind(root);
        var task = taskOf(doc);
        if (!task) return Promise.resolve(null);
        var publicPage = /^\/public\//.test((deps.path !== undefined ? deps.path : root.location && root.location.pathname) || "");
        var sourceDeps = {fetchFn: fetchFn, THREE: deps.THREE, document: doc, task: task,
                          setInterval: deps.setInterval, clearInterval: deps.clearInterval};
        var model = Model3D.source(viewer, sourceDeps);
        var sources = [model];
        var look = {palette: "", colors: null, range: null, adjust: {}};

        function readJson(r) { return r.json().then(function (data) { return {ok: r.ok, data: data}; }); }

        function restyle() {
            var style = styleOf(look);
            if (style) sources.forEach(function (s) { s.restyle(style); });
        }

        // A palette's colours (the 2D Inspector's palette endpoint), then the sources coloured in it
        function usePalette(name) {
            look.palette = name;
            return fetchFn(API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/palette?name=" +
                           encodeURIComponent(name), {credentials: "same-origin"}).then(readJson).then(function (r) {
                if (!r.ok || look.palette !== name) return;
                look.colors = r.data.color_map;
                restyle();
            });
        }

        // The user's preferences, never asked for on a public page (its viewer may not be logged in)
        function display() {
            if (publicPage) return Promise.resolve(null);
            return fetchFn(API + "display", {credentials: "same-origin"}).then(readJson).then(function (r) {
                return r.ok ? r.data : null;
            }, function () { return null; });
        }

        return model.ready.then(function (description) {
            if (!description) return null;
            look.range = [description.range.low, description.range.high];
            var inspector = {
                task: task, sources: sources, look: look, description: description,
                restyle: restyle, usePalette: usePalette,
                detach: function () { sources.forEach(function (s) { s.detach(); }); }
            };
            return display().then(function (d) {
                inspector.display = d;
                return usePalette(openingPalette(d, description));
            }).then(function () { return inspector; });
        });
    }

    var api = {create: create, taskOf: taskOf, openingPalette: openingPalette, styleOf: styleOf, DEFAULT_PALETTE: DEFAULT_PALETTE};
    root.ThermalInspector3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
