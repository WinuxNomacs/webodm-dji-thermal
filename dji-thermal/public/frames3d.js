// The photos that saw a spot of the 3D model, for the 3D Thermal Inspector (inspector3d.js): the server places the
// spot in each of the task's photos with the cameras ODM refined (frames3d.py: inspector/model/frames), and this leaves
// out those the model hides the spot from (a ray from the spot to the camera, through the mesh index), ranks the rest
// by how squarely they faced the surface (the server's order), and shows them one at a time beside the panel, each
// photo coloured in the palette as the model is, with a crosshair on the spot, its temperature there, the model's,
// and what all the photos read there. The window's markup and styles are the 2D source frames window's (frames.css).
//
// The Thermal Inspector on WebODM's map (inspector.js) shows the same window for a point of a thermal orthophoto: the
// server places it at the surface model's height (inspector/frames), leaves out the photos the surface hides it from
// and says how many, and reads the orthophoto there; the URLs and the window's words are the caller's (create's deps).
//
// Which photo ODM coloured the model from isn't kept, and can't be told from the textures: so no photo is singled out.
(function (root) {
    var API = "/api/plugins/dji-thermal/";
    var OFF_SURFACE = 0.05;             // metres: a ray to a camera starts this far off the surface, so it doesn't meet it
    var Recolour = root.ThermalRecolour || (typeof require !== "undefined" ? require("./recolour.js") : null);
    var Frames = root.ThermalFrames || (typeof require !== "undefined" ? require("./frames.js") : null);

    function escapeHtml(t) {
        return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, function (c) {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }

    function framesUrl(task, point, normal) {
        var q = "?x=" + point.x + "&y=" + point.y + "&z=" + point.z;
        if (normal) q += "&nx=" + normal.x + "&ny=" + normal.y + "&nz=" + normal.z;
        return API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/model/frames" + q;
    }
    function valuesUrl(task, index) {
        return API + "projects/" + task.project + "/tasks/" + task.id + "/inspector/model/frames/" + index + "/values";
    }
    // The Analyzer's frame page of a photo, when the task came from a workset (workset: {dataset, workset})
    function framePage(workset, frame) {
        if (!workset || !frame || !Frames) return "";
        return Frames.framePageUrl(API + "datasets/" + workset.dataset + "/conversions/" + workset.workset, frame, "");
    }

    // The normal (unit length) of the triangle a hit of the mesh index is on, or null
    function surfaceNormal(index, hit) {
        if (!index || !hit || typeof hit.triangle !== "number") return null;
        var p = index.tris.positions, i = hit.triangle * 9;
        var ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
        var vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
        var n = {x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx};
        var length = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        return length > 0 ? {x: n.x / length, y: n.y / length, z: n.z / length} : null;
    }

    // Whether the model hides a point (with its surface's normal, or null) from a camera ([x, y, z]): something on the
    // way from just off the surface, on the camera's side, to the camera
    function hidden(index, raycast, point, normal, camera) {
        var d = {x: camera[0] - point.x, y: camera[1] - point.y, z: camera[2] - point.z};
        var n = normal || {x: 0, y: 0, z: 0}, side = n.x * d.x + n.y * d.y + n.z * d.z < 0 ? -1 : 1;
        var length = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
        // Off the surface along its normal, or towards the camera without one
        var off = normal ? {x: side * n.x, y: side * n.y, z: side * n.z} : {x: d.x / length, y: d.y / length, z: d.z / length};
        var origin = {x: point.x + off.x * OFF_SURFACE, y: point.y + off.y * OFF_SURFACE, z: point.z + off.z * OFF_SURFACE};
        var to = {x: camera[0] - origin.x, y: camera[1] - origin.y, z: camera[2] - origin.z};
        var hit = raycast(index, origin, to);
        return !!hit && hit.distance < 1;          // in the ray's lengths: met before the camera
    }

    // The photos the model doesn't hide the point from, in the server's order, and how many it does: {seen, hidden}
    function inView(frames, index, raycast, point, normal) {
        var seen = [], count = 0;
        (frames || []).forEach(function (f) {
            if (index && hidden(index, raycast, point, normal, f.camera)) count++;
            else seen.push(f);
        });
        return {seen: seen, hidden: count};
    }

    // What the photos read at the point (°C, before Manual Corrections, which format applies): {count, low, high,
    // median}, or null
    function spread(frames) {
        var v = frames.filter(function (f) { return typeof f.temperature === "number"; })
            .map(function (f) { return f.temperature; }).sort(function (a, b) { return a - b; });
        if (!v.length) return null;
        var mid = v.length >> 1;
        return {count: v.length, low: v[0], high: v[v.length - 1], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2};
    }

    // The window (pick: {frames, hidden, at, workset, model (the model's temperature there, °C, or null), normal, spread,
    // error, loading}); format(celsius): a temperature as shown (corrected, in the user's unit); words: what the spot
    // is on, {surface: its row's name, hides: what hides it from a photo} (the model's when not given)
    function windowHtml(pick, format, words) {
        words = words || WORDS;
        var close = '<button type="button" class="btn btn-link btn-sm" data-pip="close" title="Close" aria-label="Close">' +
            '<i class="fa fa-times"></i></button>';
        var title = function (t) { return '<div class="ta-pip-head"><span class="ta-pip-title">' + escapeHtml(t) + "</span>"; };
        if (pick.loading) return title("Photos that saw this spot") + close + '</div><div class="ta-message">Finding the photos…</div>';
        if (pick.error) return title("Photos that saw this spot") + close + '</div><div class="ta-message">' + escapeHtml(pick.error) + "</div>";
        var frames = pick.frames, n = frames.length;
        var hiddenNote = pick.hidden ? '<div class="ta-message">' + pick.hidden + (pick.hidden === 1 ? " more photo" : " more photos") +
            " had it in view, but " + escapeHtml(words.hides) + " hides it from " + (pick.hidden === 1 ? "that one" : "them") + ".</div>" : "";
        if (!n) return title("Photos that saw this spot") + close + '</div><div class="ta-message">No photo saw this spot.</div>' + hiddenNote;
        var f = frames[pick.at];
        var nav = function (action, icon, label, disabled) {
            return '<button type="button" class="btn btn-default btn-sm" data-pip="' + action + '" title="' + label + '" aria-label="' +
                label + '"' + (disabled ? " disabled" : "") + '><i class="fa fa-' + icon + '"></i></button>';
        };
        var left = ((f.x + 0.5) / f.width * 100).toFixed(2), top = ((f.y + 0.5) / f.height * 100).toFixed(2);
        var angle = Number(f.view_angle).toFixed(0) + "° from " + (pick.normal ? "square on" : "straight down");
        var s = pick.spread, page = framePage(pick.workset, f.frame);
        var rows = [["This photo", typeof f.temperature === "number" ? format(f.temperature) : f.available ? "No temperature here" : "Not on the server"],
                    [words.surface, typeof pick.model === "number" ? format(pick.model) : "No temperature here"]];
        return title("Photo " + (pick.at + 1) + " of " + n + " that saw this spot") +
            nav("prev", "chevron-left", "Previous photo", pick.at === 0) + nav("next", "chevron-right", "Next photo", pick.at === n - 1) + close + "</div>" +
            '<div class="ta-pip-image" style="aspect-ratio: ' + f.width + " / " + f.height + ';"><canvas class="dt-frames3d-canvas" width="' + f.width +
            '" height="' + f.height + '" aria-label="' + escapeHtml(f.file) + '"></canvas>' +
            '<span class="ta-pip-mark" style="left: ' + left + "%; top: " + top + '%;"></span></div>' +
            '<div class="ta-pip-foot">' + escapeHtml(f.file) +
            '<table class="table table-condensed dt-frames3d-figures"><tbody>' + rows.map(function (r) {
                return "<tr><td>" + escapeHtml(r[0]) + '</td><td class="text-right">' + escapeHtml(r[1]) + "</td></tr>";
            }).join("") + "</tbody></table>" +
            '<div class="ta-message">Seen ' + escapeHtml(angle) + ", " + Number(f.distance).toFixed(1) + " m away." +
            (s && s.count > 1 ? " The " + s.count + " photos read " + escapeHtml(format(s.low)) + " to " + escapeHtml(format(s.high)) +
                " here (median " + escapeHtml(format(s.median)) + ")." : "") + "</div>" + hiddenNote +
            (page ? '<a href="' + escapeHtml(page) + '" target="_blank" rel="noopener" data-pip="open" ' +
                'title="The frame on its own page in the Analyzer: measure it, or measure it again with other parameters">' +
                '<i class="fa fa-external-link-alt"></i> Open this frame</a>' : "") + "</div>";
    }

    var WORDS = {surface: "The model", hides: "the model"};
    // How many photos' temperatures the window keeps (each about 1.3 MB), the ones shown longest ago dropped first
    var KEPT = 24;

    // The window on box (an element over the 3D view, or WebODM's map). deps: {fetchFn, task, raycast
    // (MeshIndex.raycast), index() (the mesh index, or null; not given: the server leaves the hidden photos out),
    // style() (the sources' style, or null), corrected(celsius) (Manual Corrections), format(celsius) (as shown, in the
    // user's unit), changed(shown, open) (the photo shown changed: {camera, point, frame} to mark, or null when there
    // is none; open: the window is), and, when they aren't the 3D model's: framesUrl(point, normal),
    // valuesUrl(index), words (windowHtml's)}
    function create(box, deps) {
        var fetchFn = deps.fetchFn || root.fetch.bind(root), doc = box.ownerDocument;
        var pick = null, seq = 0, tiles = {}, order = [];
        var framesAt = deps.framesUrl || function (point, normal) { return framesUrl(deps.task, point, normal); };
        var valuesOf = deps.valuesUrl || function (index) { return valuesUrl(deps.task, index); };

        function draw() {
            var canvas = box.querySelector(".dt-frames3d-canvas"), f = pick && pick.frames && pick.frames[pick.at];
            if (!canvas || !f) return;
            var style = deps.style(), url = valuesOf(f.index), tile = tiles[url];
            if (!style) return;
            order = order.filter(function (u) { return u !== url; }).concat(url);
            while (order.length > KEPT) delete tiles[order.shift()];
            if (!tile) {
                tiles[url] = "loading";
                Recolour.fetchValues(url, fetchFn).then(function (t) {
                    if (tiles[url] !== "loading") return;       // dropped meanwhile
                    tiles[url] = t || "none";
                    draw();
                }, function () { if (tiles[url] === "loading") delete tiles[url]; });     // asked for again when shown again
                return;
            }
            if (typeof tile === "string") return;
            canvas.width = tile.width;
            canvas.height = tile.height;
            var ctx = canvas.getContext("2d"), image = ctx.createImageData(tile.width, tile.height);
            Recolour.colour(tile, style, image.data);
            if (style.isothermPaint) Recolour.paintIsotherm(tile.values, image.data, style.isothermPaint);
            ctx.putImageData(image, 0, 0);
        }
        function render() {
            if (!pick) { box.hidden = true; box.innerHTML = ""; return; }
            box.hidden = false;
            box.innerHTML = windowHtml(pick, function (c) { return deps.format(deps.corrected(c)); }, deps.words);
            draw();
        }
        function shownChanged() {
            var f = pick && pick.frames && pick.frames[pick.at];
            if (deps.changed) deps.changed(f ? {camera: f.camera, point: pick.point, frame: f} : null, !!pick);
        }

        box.addEventListener("click", function (e) {
            var b = e.target.closest("[data-pip]"), action = b && b.getAttribute("data-pip");
            if (!action || action === "open" || !pick) return;
            if (action === "close") return api.close();
            pick.at = Math.max(0, Math.min(pick.frames.length - 1, pick.at + (action === "next" ? 1 : -1)));
            render();
            shownChanged();
        });

        var api = {
            // The photos that saw a point ({x, y, z}) of the model, on a surface of that normal (or null); model: its
            // temperature there (°C, before Manual Corrections), or null. A point of the map is the caller's own
            // (framesUrl's), its temperature the server's (orthophoto)
            show: function (point, normal, model) {
                var mine = ++seq;
                pick = {point: point, normal: normal, model: model, loading: true, frames: [], at: 0};
                render();
                shownChanged();
                return fetchFn(framesAt(point, normal), {credentials: "same-origin"}).then(function (r) {
                    return r.json().then(function (data) { return {ok: r.ok, data: data}; });
                }).then(function (r) {
                    if (mine !== seq || !pick) return;
                    pick.loading = false;
                    if (!r.ok) pick.error = (r.data && (r.data.error || r.data.detail)) || "Could not find the photos here.";
                    else {
                        var found = inView(r.data.frames, deps.index ? deps.index() : null, deps.raycast, point, normal);
                        pick.frames = found.seen;
                        pick.hidden = found.hidden + (r.data.hidden || 0);
                        if (r.data.orthophoto !== undefined) pick.model = r.data.orthophoto;
                        pick.workset = r.data.workset;
                        pick.spread = spread(found.seen);
                    }
                    render();
                    shownChanged();
                }, function () {
                    if (mine !== seq || !pick) return;
                    pick.loading = false;
                    pick.error = "Could not find the photos here.";
                    render();
                });
            },
            // The window saying why there are no photos to show (a point it can't place)
            note: function (text) {
                seq++;
                pick = {error: text, frames: [], at: 0};
                render();
                shownChanged();
            },
            // Drawn again: the palette, range, isotherm or a correction changed (restyle), or the unit (refresh)
            restyle: draw,
            refresh: render,
            close: function () {
                seq++;
                pick = null;
                render();
                shownChanged();
            },
            pick: function () { return pick; },
            element: box,
            document: doc
        };
        return api;
    }

    var api = {create: create, framesUrl: framesUrl, valuesUrl: valuesUrl, framePage: framePage, surfaceNormal: surfaceNormal,
               hidden: hidden, inView: inView, spread: spread, windowHtml: windowHtml, OFF_SURFACE: OFF_SURFACE, KEPT: KEPT};
    root.ThermalFrames3D = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
