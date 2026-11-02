// The source frames window, shared by the Analyzer's mosaic viewer (viewer.js) and the Thermal Inspector on WebODM's map
// (inspector.js): the frames that saw a point (the Analyzer's API, mosaics/<tab>/frames), shown one at a time with a
// crosshair on the point, each drawn as a mosaic tab draws it (mosaics/<tab>/frames/<index>.png), and dragged over the
// map by its heading (movable, which the Inspector's panel and legend use too).
(function (root) {
    function escapeHtml(t) {
        return String(t === null || t === undefined ? "" : t).replace(/[&<>"']/g, function (c) {
            return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
        });
    }

    // The frames that saw a point (base: the workset's API URL) and one of them as a tab draws it (query: its palette,
    // range and the rest, as the tab's tiles take them)
    function framesUrl(base, tab, latlng) {
        return base + "/mosaics/" + tab + "/frames?lon=" + latlng.lng + "&lat=" + latlng.lat;
    }
    function frameUrl(base, tab, index, query) {
        return base + "/mosaics/" + tab + "/frames/" + index + ".png?" + query;
    }

    // A frame's page in the Analyzer (frame.html), from the workset's API URL (base) and the frame's file
    function framePageUrl(base, file) {
        return base.replace("/api/plugins/dji-thermal/datasets/", "/plugins/dji-thermal/dataset/").replace("/conversions/", "/conversion/") +
            "/frame?frame=" + encodeURIComponent(file);
    }

    // The frames as a WebODM orthophoto made from the workset's TIFFs shows them: ODM blended them, so none is the
    // pixel's own, and they come from the one that saw the point closest to straight down
    function orthophotoFrames(frames) {
        return (frames || []).map(function (f) {
            var copy = {};
            for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) copy[k] = f[k];
            copy.source = false;
            return copy;
        }).sort(function (a, b) { return a.view_angle - b.view_angle; });
    }

    // The window of the frames that saw a point (pick: {frames, models, at: the one shown, orthophoto: on a WebODM
    // orthophoto, where the frames are placed from their GPS and gimbal, not ODM's cameras}), the frame drawn from url
    // with a crosshair on the point; base (the workset's API URL): a link to the frame's page
    function pipHtml(pick, url, base) {
        var close = '<button type="button" class="btn btn-link btn-sm" data-pip="close" title="Close" aria-label="Close">' +
            '<i class="fa fa-times"></i></button>';
        var frames = pick.frames || [];
        if (!frames.length) {
            return '<div class="ta-pip-head"><span class="ta-pip-title">Source frame</span>' + close + "</div>" +
                '<div class="ta-message">' + (pick.models ? "No frame saw this point." :
                "These mosaics were built without their frames' positions: build them again to see the frames.") + "</div>";
        }
        var f = frames[pick.at], n = frames.length;
        var nav = function (action, icon, label, disabled) {
            return '<button type="button" class="btn btn-default btn-sm" data-pip="' + action + '" title="' + label + '" aria-label="' +
                label + '"' + (disabled ? " disabled" : "") + '><i class="fa fa-' + icon + '"></i></button>';
        };
        var left = ((f.x + 0.5) / f.width * 100).toFixed(2), top = ((f.y + 0.5) / f.height * 100).toFixed(2);
        var angle = typeof f.view_angle === "number" ? Number(f.view_angle).toFixed(1) + "°" : "";
        return '<div class="ta-pip-head"><span class="ta-pip-title">Frame ' + (pick.at + 1) + " of " + n + " that saw this point</span>" +
            nav("prev", "chevron-left", "Previous frame", pick.at === 0) + nav("next", "chevron-right", "Next frame", pick.at === n - 1) +
            close + "</div>" +
            '<div class="ta-pip-image" style="aspect-ratio: ' + f.width + " / " + f.height + ';"><img src="' + escapeHtml(url) +
            '" alt="' + escapeHtml(f.file) + '"><span class="ta-pip-mark" style="left: ' + left + "%; top: " + top + '%;"></span></div>' +
            '<div class="ta-pip-foot">' + escapeHtml(f.file) + '<br><span class="ta-message">' +
            (f.source ? "The mosaic's pixel here comes from this frame; " : "") + "seen " + escapeHtml(angle) + " from straight down" +
            (pick.orthophoto ? ". Placed from the frames' GPS and gimbal, not ODM's cameras: the point may be a little off." : "") +
            "</span>" + (base ? '<br><a href="' + escapeHtml(framePageUrl(base, f.file)) + '" target="_blank" rel="noopener" data-pip="open" ' +
                'title="The frame on its own page: measure it, or measure it again with other parameters"><i class="fa fa-external-link-alt"></i> Open this frame</a>' : "") +
            "</div>";
    }

    // A box (the Inspector's panel and legend, a frames window) dragged over the map: moved by an offset (a CSS
    // translate) that keeps it inside area (the map's element); grabs(target) says whether a press there starts a drag
    // (not on a link or a field); moved(offset, dragged) follows each move, dragged when the user moved it. The box grabbed last is drawn over the map's other controls (its Leaflet corner
    // raised) until it is back in its place. reset puts it back
    function movable(box, area, grabs, moved, doc) {
        var offset = {x: 0, y: 0}, drag = null;
        doc = doc || box.ownerDocument;
        function corner() { return box.closest(".leaflet-top, .leaflet-bottom") || box; }
        function set(x, y) {
            offset = {x: x, y: y};
            box.style.transform = x || y ? "translate(" + x + "px, " + y + "px)" : "";
            if (!x && !y) corner().style.zIndex = "";
            if (moved) moved(offset, !!drag);
        }
        function place(x, y) {
            var r = box.getBoundingClientRect(), a = area.getBoundingClientRect();
            var left = r.left - offset.x, top = r.top - offset.y;       // where it is unmoved
            // Inside the area; a box wider or taller than the area keeps its left or top edge in it
            x = Math.max(a.left - left, Math.min(x, a.right - (left + r.width)));
            y = Math.max(a.top - top, Math.min(y, a.bottom - (top + r.height)));
            set(Math.round(x) || 0, Math.round(y) || 0);
        }
        function onMove(e) {
            if (!drag) return;
            e.preventDefault();
            place(drag.x + e.clientX - drag.startX, drag.y + e.clientY - drag.startY);
        }
        function onUp() {
            drag = null;
            box.classList.remove("dt-moving");
            doc.removeEventListener("pointermove", onMove);
            doc.removeEventListener("pointerup", onUp);
            doc.removeEventListener("pointercancel", onUp);
        }
        box.addEventListener("pointerdown", function (e) {
            if ((e.button && e.button !== 0) || !grabs(e.target)) return;
            e.preventDefault();
            e.stopPropagation();        // not the map's own dragging
            drag = {x: offset.x, y: offset.y, startX: e.clientX, startY: e.clientY};
            corner().style.zIndex = String(++movedOnTop);
            box.classList.add("dt-moving");
            doc.addEventListener("pointermove", onMove);
            doc.addEventListener("pointerup", onUp);
            doc.addEventListener("pointercancel", onUp);
        });
        return {
            reset: function () { onUp(); set(0, 0); },
            to: function (o) { set(o.x, o.y); },        // moved along with another box (not clamped)
            keep: function () { if (offset.x || offset.y) place(offset.x, offset.y); },     // after the area or the box changed size
            offset: function () { return offset; }
        };
    }
    var movedOnTop = 1000;      // Leaflet's corners are at 1000: the box grabbed last goes over them

    var api = {movable: movable, framesUrl: framesUrl, frameUrl: frameUrl, framePageUrl: framePageUrl, orthophotoFrames: orthophotoFrames, pipHtml: pipHtml};
    root.ThermalFrames = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
