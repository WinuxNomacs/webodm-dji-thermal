// The source frames window, shared by the Analyzer's mosaic viewer (viewer.js) and the Thermal Inspector on WebODM's map
// (inspector.js): the frames that saw a point (the Analyzer's API, mosaics/<tab>/frames), shown one at a time with a
// crosshair on the point, each drawn as a mosaic tab draws it (mosaics/<tab>/frames/<index>.png).
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
    // with a crosshair on the point
    function pipHtml(pick, url) {
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
            "</span></div>";
    }

    var api = {framesUrl: framesUrl, frameUrl: frameUrl, orthophotoFrames: orthophotoFrames, pipHtml: pipHtml};
    root.ThermalFrames = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
