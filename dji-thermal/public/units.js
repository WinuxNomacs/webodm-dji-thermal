// The temperature unit, °C or °F, for the whole of WebODM (loaded on every page): the user's own choice, saved with
// their account (the display preferences), else the administrator's default (the DJI Thermal page under
// Administration), else °C. It is linked to WebODM's units in each browser (metric is °C, imperial °F): picking one
// sets WebODM's, WebODM's switch saves the unit, and on load the user's choice sets this browser's WebODM units. A
// °C / °F menu in WebODM's top bar, beside the user icon, picks it. Anonymous viewers (a public map) get the
// administrator's default, with no menu, WebODM's units left as they are.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var CHANGED = "djiThermalUnitChanged";      // announced when the unit shown changes without WebODM's units
    var NAMES = {C: "Celsius", F: "Fahrenheit"};

    function systemUnit(system) { return system === "imperial" || system === "imperialUS" ? "F" : "C"; }
    function browserSystem(win) {
        try { return win.localStorage ? win.localStorage.getItem("unit_system") : null; } catch (e) { return null; }
    }

    // The unit to show once the preferences are read ({unit, default_unit}): the user's, else this browser's WebODM
    // units when they were set (WebODM saves them only when changed), else the administrator's default
    function resolve(prefs, system) {
        if (prefs && (prefs.unit === "C" || prefs.unit === "F")) return prefs.unit;
        if (system) return systemUnit(system);
        return prefs && prefs.default_unit === "F" ? "F" : "C";
    }

    // The top bar's menu: the unit shown, and the two to pick from
    function menuHtml(unit) {
        return '<a class="dropdown-toggle" data-toggle="dropdown" href="#" title="Temperature unit" aria-label="Temperature unit">' +
            "°" + unit + ' <i class="fa fa-caret-down"></i></a><ul class="dropdown-menu dropdown-menu-right">' +
            ["C", "F"].map(function (u) {
                return '<li' + (u === unit ? ' class="active"' : "") + '><a href="#" data-dt-unit="' + u + '">°' + u + " " + NAMES[u] + "</a></li>";
            }).join("") + "</ul>";
    }

    function create(win) {
        var doc = win.document;
        var fetchFn = win.fetch ? win.fetch.bind(win) : null;
        var prefs = null, anonymous = null, menu = null, loading = false;

        // The unit shown: an anonymous viewer's default, else WebODM's units in this browser
        function current() { return anonymous || systemUnit(browserSystem(win)); }

        // WebODM's units set to the unit, as its own selector does (saved in the browser, announced); imperial US
        // stays as it is for °F. True when they changed.
        function setSystem(unit) {
            var now = browserSystem(win);
            if (systemUnit(now) === unit) return false;
            var system = unit === "F" ? "imperial" : "metric";
            try { win.localStorage.setItem("unit_system", system); } catch (e) { return false; }
            doc.dispatchEvent(new win.CustomEvent("onUnitSystemChanged", {detail: system}));
            return true;
        }

        function csrf() {
            var m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(doc.cookie || "");
            return m ? decodeURIComponent(m[1]) : "";
        }

        // The unit saved as the user's choice; resolves once the server has it (or couldn't)
        function save(unit) {
            if (!prefs || prefs.unit === unit) return Promise.resolve();
            prefs.unit = unit;
            return fetchFn(API + "display", {method: "PUT", credentials: "same-origin",
                headers: {"Content-Type": "application/json", "X-CSRFToken": csrf()}, body: JSON.stringify({unit: unit})})
                .then(function () {}, function () {});
        }

        function drawMenu() {
            if (menu) menu.innerHTML = menuHtml(current());
        }

        // The menu, just left of the user icon (WebODM's single-user mode has no icon: the menu alone)
        function addMenu() {
            var links = doc.querySelector("#navbar-top .navbar-top-links");
            if (!links) {
                var header = doc.querySelector("#navbar-top .navbar-header");
                if (!header) return;
                links = doc.createElement("ul");
                links.className = "nav navbar-top-links navbar-right";
                var toggle = header.querySelector(".navbar-toggle");
                header.insertBefore(links, toggle ? toggle.nextSibling : header.firstChild);
            }
            menu = doc.createElement("li");
            menu.className = "dropdown dt-unit-menu";
            links.insertBefore(menu, links.firstChild);
            drawMenu();
            menu.addEventListener("click", function (e) {
                var a = e.target.closest ? e.target.closest("[data-dt-unit]") : null;
                if (!a) return;
                e.preventDefault();
                var unit = a.getAttribute("data-dt-unit");
                // Saved before WebODM's units change: a page that reloads on the change (the Analyzer's) keeps it
                save(unit).then(function () {
                    setSystem(unit);
                    drawMenu();
                });
            });
        }

        // WebODM's switch (or another part of the page) changed its units: the user's unit with them
        doc.addEventListener("onUnitSystemChanged", function (e) {
            if (anonymous || loading) return;
            save(systemUnit(e.detail || browserSystem(win)));
            drawMenu();
        });
        // and another tab did
        if (win.addEventListener) {
            win.addEventListener("storage", function (e) { if (e.key === "unit_system") drawMenu(); });
        }

        function start() {
            if (!fetchFn) return Promise.resolve();
            return fetchFn(API + "unit", {credentials: "same-origin"}).then(function (res) {
                if (!res.ok) throw new Error("unreadable");
                return res.json();
            }).then(function (data) {
                if (!data.logged_in) {
                    // The administrator's default, announced to what shows temperatures already
                    anonymous = data.default_unit === "F" ? "F" : "C";
                    if (anonymous !== systemUnit(browserSystem(win))) doc.dispatchEvent(new win.CustomEvent(CHANGED, {detail: anonymous}));
                    return;
                }
                prefs = {unit: data.unit || null, default_unit: data.default_unit};
                // Matching WebODM's units to the unit resolved isn't the user choosing it
                loading = true;
                try { setSystem(resolve(prefs, browserSystem(win))); } finally { loading = false; }
                addMenu();
            }, function () {});
        }

        return {current: current, start: start};
    }

    var api = {systemUnit: systemUnit, resolve: resolve, menuHtml: menuHtml, create: create, CHANGED: CHANGED};
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root.document && root.document.getElementById && typeof module === "undefined") {
        var units = create(root);
        api.current = units.current;
        root.DjiThermalUnits = api;
        if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", units.start);
        else units.start();
    }
})(typeof window !== "undefined" ? window : this);
