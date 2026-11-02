// A thermal dataset's page: what dji-thermal-cli found in it (an overview, then tabs: the files, the problems,
// the WebODM plan and its conversions, see conversions.js), with adding images, analyzing again and sharing its link.
(function (root) {
    var core = root.ThermalAnalyzerCore || (typeof require !== "undefined" ? require("./analyzer_core") : null);
    var conversionsModule = root.ThermalAnalyzerConversions || (typeof require !== "undefined" ? require("./conversions") : null);
    var pictureViewer = root.ThermalPictureViewer || (typeof require !== "undefined" ? require("./picture_viewer") : null);
    var esc = function (t) { return core.escapeHtml(t); };
    var POLL_MS = 2000;
    var FILES_SHOWN = 12;     // files listed under a problem before "and N more"
    var THUMBS_KEY = "thermalAnalyzer.thumbnails";     // the Files tab's Thumbnails box, remembered per browser
    var HOVER_KEY = "thermalAnalyzer.hoverDetail";     // and its Hover for Detail box

    // EXIF's "2026:10:12 18:29:50" as "2026-10-12 18:29:50"
    function captureTime(t) { return t ? String(t).replace(/^(\d{4}):(\d{2}):/, "$1-$2-") : ""; }

    var blank = function (x) { return x === null || x === undefined; };

    // A thermal frame's camera, as the analysis groups them: model, serial and image size
    function cameraKey(f) { return [f.model || "", f.serial || "", f.width || "", f.height || ""].join("|"); }

    // "2026-10-12 18:29:50" to "2026-10-12 18:37:01" as "7 min 11 s"
    function duration(first, last) {
        var parse = function (t) { var m = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/.exec(t || ""); return m ? Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) : NaN; };
        var s = Math.round((parse(last) - parse(first)) / 1000);
        if (!(s > 0)) return "";
        if (s < 60) return s + " s";
        if (s < 3600) return Math.floor(s / 60) + " min" + (s % 60 ? " " + s % 60 + " s" : "");
        return Math.floor(s / 3600) + " h " + ("0" + Math.floor(s % 3600 / 60)).slice(-2) + " min";
    }

    // The figures of some thermal frames: count, temperatures, capture times, heights, GPS, size
    function stats(thermal) {
        var out = {frames: thermal.length};
        var pick = function (k) { return thermal.map(function (f) { return f[k]; }).filter(function (x) { return !blank(x); }); };
        var mins = pick("tmin"), maxs = pick("tmax"), alts = pick("alt"), sizes = pick("size");
        if (mins.length) out.tmin = Math.min.apply(null, mins);
        if (maxs.length) out.tmax = Math.max.apply(null, maxs);
        out.tmean = core.median(pick("tmean"));
        var times = thermal.map(function (f) { return captureTime(f.time); }).filter(function (t) { return t; }).sort();
        if (times.length) { out.first = times[0]; out.last = times[times.length - 1]; }
        out.altitude = core.median(alts);
        if (alts.length) { out.altMin = Math.min.apply(null, alts); out.altMax = Math.max.apply(null, alts); }
        out.gps = thermal.filter(function (f) { return !blank(f.lat); }).length;
        out.size = sizes.length ? sizes.reduce(function (a, b) { return a + b; }, 0) : null;
        return out;
    }

    // The figures above the tabs, from the analysis
    function overview(a) {
        var thermal = (a.files || []).filter(function (f) { return f.kind === "thermal"; });
        return Object.assign(stats(thermal), {other: (a.files || []).length - thermal.length});
    }

    // The summary's rows: one per camera, most frames first, with the figures of its frames
    function summaryRows(a) {
        var thermal = (a.files || []).filter(function (f) { return f.kind === "thermal"; });
        var cams = a.cameras || [];
        return cams.map(function (c) {
            var key = cameraKey(c);
            return Object.assign(stats(cams.length === 1 ? thermal : thermal.filter(function (f) { return cameraKey(f) === key; })),
                                 {key: key, model: c.model, serial: c.serial, width: c.width, height: c.height});
        });
    }

    function cameraLabel(c) { return (c.model || "Unknown camera") + (c.serial ? " " + c.serial : ""); }

    // A summary cell's figure that opens the Files tab sorted by it (for the row's camera when it has one)
    function sortLink(text, sort, desc, camera, title) {
        return '<button type="button" class="ta-summary-link" data-files-sort="' + sort + '"' + (desc ? ' data-desc="1"' : "") +
            (camera ? ' data-camera="' + esc(camera) + '"' : "") + ' title="' + esc(title) + '">' + text + "</button>";
    }

    // The temperatures' span on the dataset's scale, with the frames' median mean marked
    function rangeBar(r, scale) {
        if (blank(r.tmin) || blank(r.tmax) || !(scale.max > scale.min)) return "";
        var at = function (v) { return Math.max(0, Math.min(100, (v - scale.min) / (scale.max - scale.min) * 100)).toFixed(1) + "%"; };
        return '<div class="ta-range" aria-hidden="true"><span class="ta-range-span" style="left: ' + at(r.tmin) + "; right: calc(100% - " + at(r.tmax) + ')"></span>' +
            (blank(r.tmean) ? "" : '<span class="ta-range-mean" style="left: ' + at(r.tmean) + '"></span>') + "</div>";
    }

    function summaryRowHtml(r, scale, all) {
        var camera = all ? "" : r.key;
        var scope = all ? "these frames" : "this camera's frames";
        var cells = [];
        cells.push(["Camera", all ? "<strong>All frames</strong>" + '<div class="ta-sub">' + esc(r.cameras) + " cameras</div>" :
            "<strong>" + esc(r.model || "Unknown camera") + "</strong>" + '<div class="ta-sub">' +
            esc([r.width ? r.width + "×" + r.height : "", r.serial ? "SN " + r.serial : ""].filter(function (x) { return x; }).join(" · ")) + "</div>"]);
        var gpsPct = r.frames ? Math.round(r.gps / r.frames * 100) : 0;
        var gpsText = r.gps === r.frames ? '<i class="fa fa-check"></i> GPS on all' : r.gps + " of " + r.frames + " with GPS";
        cells.push(["Frames", '<span class="ta-figure">' + r.frames + "</span>" + '<div class="ta-sub">' +
            (r.gps === r.frames ? '<span class="ta-gps-ok">' + gpsText + "</span>" :
                '<button type="button" class="ta-summary-link ta-gps-missing" data-nogps="1"' + (camera ? ' data-camera="' + esc(camera) + '"' : "") +
                ' title="Show the frames without GPS">' + gpsText + "</button>") +
            '</div><div class="ta-meter" aria-hidden="true"><span style="width: ' + gpsPct + '%"></span></div>', "ta-num"]);
        cells.push(["Temperatures", blank(r.tmin) ? '<span class="text-muted">-</span>' :
            sortLink('<span class="ta-figure">' + esc(core.formatTemp(r.tmin, "C", 1)) + ' <span class="ta-to">to</span> ' + esc(core.formatTemp(r.tmax, "C", 1)) + "</span>",
                     "tmax", true, camera, "Show " + scope + ", hottest first") +
            rangeBar(r, scale) + (blank(r.tmean) ? "" : '<div class="ta-sub">median frame mean ' + esc(core.formatTemp(r.tmean, "C", 1)) + "</div>")]);
        cells.push(["Captured", !r.first ? '<span class="text-muted">-</span>' :
            sortLink('<span class="ta-figure">' + esc(r.first.split(" ")[0]) + "</span>", "time", false, camera, "Show " + scope + " in the order they were taken") +
            '<div class="ta-sub">' + esc(r.first.split(" ")[1] + (r.last !== r.first ? " – " + (r.last.split(" ")[0] === r.first.split(" ")[0] ? r.last.split(" ")[1] : r.last) : "")) +
            (duration(r.first, r.last) ? " · " + esc(duration(r.first, r.last)) : "") + "</div>"]);
        cells.push(["Height", blank(r.altitude) ? '<span class="text-muted">-</span>' :
            sortLink('<span class="ta-figure">' + esc(core.formatNumber(r.altitude, 1, " m")) + "</span>", "alt", true, camera, "Show " + scope + ", highest first") +
            '<div class="ta-sub">median' + (r.altMax > r.altMin ? ", " + esc(core.formatNumber(r.altMin, 1, "") + " – " + core.formatNumber(r.altMax, 1, " m")) : "") + "</div>", "ta-num"]);
        cells.push(["Size", blank(r.size) ? '<span class="text-muted">-</span>' : '<span class="ta-figure">' + esc(core.formatBytes(r.size)) + "</span>", "ta-num"]);
        return "<tr" + (all ? ' class="ta-summary-total"' : ' class="ta-summary-row" data-camera="' + esc(r.key) + '" tabindex="0" title="Show ' +
            esc(cameraLabel(r)) + "'s frames on the Files tab\"") + ">" + cells.map(function (c) {
            return '<td data-label="' + c[0] + '"' + (c[2] ? ' class="' + c[2] + '"' : "") + ">" + c[1] + "</td>";
        }).join("") + "</tr>";
    }

    // The summary above the tabs: a row per camera (and all of them when there are several), each figure a way into
    // the Files tab; below it, the files not analyzed and the analysis
    function overviewHtml(d) {
        var a = d.analysis || {};
        if (!a.files) return "";
        var o = overview(a);
        var rows = summaryRows(a);
        var scale = {min: o.tmin, max: o.tmax};
        var body = rows.map(function (r) { return summaryRowHtml(r, scale, false); }).join("");
        if (rows.length > 1) body += summaryRowHtml(Object.assign({}, o, {cameras: rows.length}), scale, true);
        if (!rows.length) body = '<tr><td colspan="6" class="text-muted">No thermal frames in this dataset.</td></tr>';
        var notes = [];
        if (o.other) notes.push(o.other + " other file" + (o.other === 1 ? "" : "s") + ", not thermal frames");
        notes.push(core.formatBytes(d.size) + " stored, worksets and mosaics included");
        if (d.analyzed_at) notes.push("Analyzed " + core.formatDate(d.analyzed_at) + (a.version ? " with dji-thermal-cli " + a.version : ""));
        return '<div class="ta-summary"><table class="ta-summary-table"><thead><tr><th>Camera</th><th class="ta-num">Frames</th>' +
            '<th>Temperatures</th><th>Captured</th><th class="ta-num">Height</th><th class="ta-num">Size</th></tr></thead><tbody>' + body +
            '</tbody></table><div class="ta-summary-notes">' + notes.map(esc).join(" · ") + "</div></div>";
    }

    // The problems each file is named in: {path: [finding, ...]}
    function flagsByFile(findings) {
        var out = {};
        (findings || []).forEach(function (f) {
            (f.files || []).forEach(function (p) { (out[p] = out[p] || []).push(f); });
        });
        return out;
    }

    var FILE_COLUMNS = [
        {key: "path", label: "File"},
        {key: "kind", label: "Kind"},
        {key: "time", label: "Captured"},
        {key: "alt", label: "Height", unit: " m", digits: 1, title: "Above the take-off point"},
        {key: "pitch", label: "Pitch", unit: "°", digits: 1, title: "Gimbal pitch (-90° looks straight down)"},
        {key: "tmin", label: "Min", temperature: true, digits: 1},
        {key: "tmax", label: "Max", temperature: true, digits: 1},
        {key: "tmean", label: "Mean", temperature: true, digits: 1},
        {key: "distance", label: "Distance", unit: " m", digits: 1, title: "Object distance embedded in the image / the rangefinder's"},
        {key: "emissivity", label: "Emissivity", digits: 2}
    ];

    function cell(row, col) {
        var v = row[col.key];
        if (col.key === "kind") return esc(core.kindLabel(v));
        if (col.key === "time") return esc(captureTime(v));
        if (col.key === "distance") {
            var embedded = core.formatNumber(v, 1, " m");
            return esc(embedded + (row.lrf !== null && row.lrf !== undefined ? " / " + core.formatNumber(row.lrf, 1, " m") : ""));
        }
        if (col.temperature) return esc(core.formatTemp(v, "C", col.digits));
        if (col.digits !== undefined) return esc(core.formatNumber(v, col.digits, col.unit));
        return esc(v);
    }

    // The Files tab's rows: shown as all / thermal / flagged, filtered by name (every word in the path), sorted
    function fileRows(a, view) {
        var flags = flagsByFile(a.findings);
        var words = String(view.filter || "").toLowerCase().split(/\s+/).filter(function (w) { return w; });
        var rows = (a.files || []).filter(function (f) {
            var path = String(f.path).toLowerCase();
            if (!words.every(function (w) { return path.indexOf(w) >= 0; })) return false;
            if (view.camera && (f.kind !== "thermal" || ((a.cameras || []).length > 1 && cameraKey(f) !== view.camera))) return false;
            if (view.nogps && (f.kind !== "thermal" || !blank(f.lat))) return false;
            if (view.show === "thermal") return f.kind === "thermal";
            if (view.show === "flagged") return !!flags[f.path] || f.kind !== "thermal" && f.kind !== "not_thermal" || (f.warnings || []).length;
            return true;
        });
        return core.sortRows(rows, view.sort || "path", !!view.desc);
    }

    // The table under the Files tab's bar: a click on a row selects it (view.selected, paths). view.frames (the newest
    // ready conversion's frame page) makes thermal frames' names links to their frame; view.thumbs (the thumbnail URL
    // without the file) adds a small picture of each image.
    function filesTableHtml(a, view) {
        var rows = fileRows(a, view);
        var selected = view.selected || [];
        var html = '<div class="ta-table-scroll"><table class="table table-condensed ta-files"><thead><tr>' + (view.thumbs ? "<th></th>" : "") + FILE_COLUMNS.map(function (c) {
            var arrow = (view.sort || "path") === c.key ? ' <i class="fa fa-caret-' + (view.desc ? "down" : "up") + '"></i>' : "";
            return '<th data-sort="' + c.key + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" + esc(c.label) + arrow + "</th>";
        }).join("") + "</tr></thead><tbody>";
        html += rows.map(function (r) {
            var href = view.frames && r.kind === "thermal" ? view.frames + "?frame=" + encodeURIComponent(r.path) : null;
            var thumb = view.thumbs ? '<td class="ta-thumb">' + (core.isImage({name: r.path}) ?
                '<img loading="lazy" alt="" src="' + esc(view.thumbs + encodeURIComponent(r.path)) + '">' : "") + "</td>" : "";
            return '<tr class="ta-kind-' + esc(r.kind) + (selected.indexOf(r.path) >= 0 ? " ta-selected" : "") + '" data-path="' + esc(r.path) + '">' + thumb +
                FILE_COLUMNS.map(function (c) {
                    return "<td>" + (href && c.key === "path" ? '<a href="' + esc(href) + '" title="Open the frame">' + cell(r, c) + "</a>" : cell(r, c)) + "</td>";
                }).join("") + "</tr>";
        }).join("");
        return {html: html + "</tbody></table></div>", count: rows.length};
    }

    // What the summary narrowed the Files tab to (a camera, the frames without GPS), with a way back to all files
    function scopeHtml(a, view) {
        var parts = [];
        if (view.camera) {
            var c = (a.cameras || []).filter(function (x) { return cameraKey(x) === view.camera; })[0];
            parts.push(esc(c ? cameraLabel(c) : "One camera"));
        }
        if (view.nogps) parts.push("without GPS");
        if (!parts.length) return "";
        return '<span class="ta-files-scope">' + parts.join(", ") +
            ' <button type="button" class="close" data-act="scope-clear" title="Show every camera\'s files" aria-label="Clear">&times;</button></span>';
    }

    // The Files tab: a bar (all / thermal / flagged, a name filter, thumbnails), then the table
    function filesHtml(a, view) {
        view = view || {};
        var table = filesTableHtml(a, view);
        var shows = [["all", "All files"], ["thermal", "Thermal frames"], ["flagged", "With problems"]];
        return '<div class="ta-files-bar">' + shows.map(function (s) {
                return '<label class="radio-inline"><input type="radio" name="ta-files-show" value="' + s[0] + '"' +
                    ((view.show || "all") === s[0] ? " checked" : "") + "> " + s[1] + "</label>";
            }).join("") +
            '<input type="search" class="form-control input-sm ta-files-filter" placeholder="Filter by name" value="' + esc(view.filter || "") + '">' +
            '<label class="checkbox-inline"><input type="checkbox" class="ta-files-thumbs"' + (view.thumbs ? " checked" : "") + "> Thumbnails</label>" +
            '<label class="checkbox-inline" title="The detail pane follows the image under the mouse, while none is selected"><input type="checkbox" class="ta-files-hover"' +
            (view.hover ? " checked" : "") + "> Hover for Detail</label>" +
            scopeHtml(a, view) +
            '<span class="text-muted ta-files-shown">' + table.count + " shown</span></div>" +
            '<div class="ta-files-layout"><div class="ta-files-table">' + table.html + '</div><aside class="ta-file-detail" hidden></aside></div>';
    }

    // What the detail pane shows of one file, as [label, value] (values as shown, empty ones left out)
    function detailRows(r, notes) {
        var temp = function (v) { return core.formatTemp(v, "C", 1); };
        var num = function (v, digits, unit) { return core.formatNumber(v, digits, unit); };
        var rows = [["Kind", core.kindLabel(r.kind)], ["Captured", captureTime(r.time)],
            ["Camera", [r.model, r.serial ? "SN " + r.serial : ""].filter(Boolean).join(" · ")],
            ["Image size", r.width && r.height ? r.width + " × " + r.height + " px" : ""], ["File size", core.formatBytes(r.size)],
            ["Latitude", num(r.lat, 7)], ["Longitude", num(r.lon, 7)], ["Height", num(r.alt, 1, " m")],
            ["Altitude", num(r.abs_alt, 1, " m")], ["GPS", r.gps], ["Gimbal pitch", num(r.pitch, 1, "°")], ["Gimbal yaw", num(r.yaw, 1, "°")],
            ["Min", temp(r.tmin)], ["Max", temp(r.tmax)], ["Mean", temp(r.tmean)], ["Distance", num(r.distance, 1, " m")],
            ["Rangefinder", num(r.lrf, 1, " m")], ["Emissivity", num(r.emissivity, 2)], ["Humidity", num(r.humidity, 0, " %")],
            ["Reflected", temp(r.reflection)], ["Ambient", temp(r.ambient)], ["Palette", r.palette], ["Reason", r.kind !== "thermal" ? r.reason : ""]];
        (r.warnings || []).forEach(function (w) { rows.push(["Warning", w]); });
        (notes || []).forEach(function (f) { rows.push([f.code, f.message]); });
        return rows.filter(function (row) { return row[1] !== "" && row[1] !== null && row[1] !== undefined; });
    }

    // What the picture viewer shows of a file: a thermal frame in the user's preferred DJI palette (as the detail pane
    // draws it), any other image as uploaded, at its own size (urls as detailHtml's)
    function viewerSrc(r, urls) {
        if (r.kind !== "thermal") return urls.files + encodeURIComponent(r.path);
        return urls.picture + "?size=large&" + (urls.palette ? "palette=" + encodeURIComponent(urls.palette) + "&" : "") + "file=" + encodeURIComponent(r.path);
    }

    // The picture viewer's pictures: the images among the files the table shows, in its order
    function viewerItems(a, view, urls) {
        return fileRows(a, view).filter(function (r) { return core.isImage({name: r.path}); }).map(function (r) {
            return {name: r.path.split("/").pop(), path: r.path, src: viewerSrc(r, urls), download: urls.files + encodeURIComponent(r.path) + "&download=1"};
        });
    }

    // The frame page of the dataset's newest workset that converted (the Files tab's frames open there), or null
    function framePage(publicUrl, d) {
        var ready = (d.conversions || []).filter(function (c) { return c.status === "ready"; });
        if (!ready.length) return null;
        var newest = ready.reduce(function (a, b) { return String(b.created_at || "") > String(a.created_at || "") ? b : a; });
        return publicUrl + "dataset/" + d.id + "/conversion/" + newest.id + "/frame";
    }

    // A link from the frame page's "New workset with these" (?from=<workset>&emissivity=…): {id, changes}, or null
    function fromQuery(search) {
        var q = new root.URLSearchParams(search), id = q.get("from");
        if (!id) return null;
        var changes = {};
        ["distance", "humidity", "emissivity", "reflected_temp", "ambient_temp"].forEach(function (k) {
            var v = parseFloat(q.get(k));
            if (q.get(k) !== null && !isNaN(v)) changes[k] = v;
        });
        return {id: id, changes: changes};
    }

    // The detail pane's button removing the files shown from the dataset (n of them), for those who can change it;
    // disabled with why while that can't be done (busy: why, or "")
    function removeFilesHtml(n, busy) {
        return '<div class="ta-file-detail-remove"><button type="button" class="btn btn-default btn-xs text-danger" data-act="remove-files"' +
            (busy ? ' disabled title="' + esc(busy) + '"' : ' title="Delete ' + (n === 1 ? "it" : "them") + ' from the dataset, and from its worksets"') +
            '><i class="fa fa-trash"></i> ' + (n === 1 ? "Remove from dataset" : "Remove " + n + " from dataset") + "</button></div>";
    }

    // Why files can't be removed from a dataset now ("" when they can): an analysis or a workset running
    function removeBusy(d) {
        if (d.status === "analyzing") return "Wait for the analysis to finish, or cancel it";
        var c = (d.conversions || []).filter(function (x) { return x.status === "converting" || x.mosaic_status === "building"; })[0];
        return c ? "Wait for " + c.name + (c.status === "converting" ? " to finish converting" : "'s mosaics to be built") + ", or cancel it" : "";
    }

    // The detail pane of the files selected, or of the one under the mouse (urls: {files: the source file's URL
    // without the file, picture: the thumbnail URL, frames: the frame page or null, palette: the user's preferred DJI
    // palette or "", remove: why files can't be removed now, "" when they can, null for those who can't change the
    // dataset}); "" when there is none. A thermal frame is drawn in that palette (the server draws it in its own when
    // it isn't one of DJI's).
    function detailHtml(a, paths, selected, urls) {
        if (!paths.length) return "";
        var close = selected ? '<button type="button" class="close" data-act="detail-close" title="Unselect" aria-label="Unselect">&times;</button>' : "";
        var remove = urls.remove === null || urls.remove === undefined ? "" : removeFilesHtml(paths.length, urls.remove);
        if (paths.length > 1) {
            return '<div class="ta-file-detail-head"><strong>' + paths.length + " images selected</strong>" + close + "</div>" +
                '<button type="button" class="btn btn-primary btn-sm" data-act="download-selected"><i class="fa fa-download"></i> Download ' +
                paths.length + " images</button>" +
                '<p class="text-muted ta-files-hint">As a zip, each at its path in the dataset. Ctrl/Cmd-click adds or removes an image, Shift-click a range.</p>' + remove;
        }
        var r = (a.files || []).filter(function (f) { return f.path === paths[0]; })[0];
        if (!r) return "";
        var src = urls.files + encodeURIComponent(r.path);
        var palette = urls.palette;
        var picture = urls.picture + "?size=large&" + (palette ? "palette=" + encodeURIComponent(palette) + "&" : "") + "file=" + encodeURIComponent(r.path);
        var frame = urls.frames && r.kind === "thermal" ? urls.frames + "?frame=" + encodeURIComponent(r.path) : null;
        return '<div class="ta-file-detail-head"><strong title="' + esc(r.path) + '">' + esc(r.path.split("/").pop()) + "</strong>" + close + "</div>" +
            (core.isImage({name: r.path}) ? '<a href="' + esc(viewerSrc(r, urls)) + '" target="_blank" rel="noopener" data-act="view-picture" data-path="' + esc(r.path) +
                '" title="View the picture"><img class="ta-file-detail-img" alt="" src="' +
                esc(picture) + '"></a>' : "") +
            '<div class="ta-file-detail-actions"><a class="btn btn-primary btn-xs" href="' + esc(src + "&download=1") + '"><i class="fa fa-download"></i> Download</a>' +
            (frame ? ' <a class="btn btn-default btn-xs" href="' + esc(frame) + '"><i class="fa fa-th-large"></i> Open frame</a>' : "") + "</div>" +
            '<table class="table table-condensed ta-file-detail-table"><tbody>' + detailRows(r, flagsByFile(a.findings)[r.path]).map(function (row) {
                return "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td></tr>";
            }).join("") + "</tbody></table>" + remove;
    }

    // dji-thermal-cli's options, as the Workset Creation Settings name them, for its findings and notes (which are
    // written for its command line); then its "deg" as degrees
    var SETTING_NAMES = [
        [/--(?:mosaic-)?normalize\b/g, "Normalize and Harmonize"],
        [/--(?:mosaic-)?max-pitch(?: DEG)?/g, "\u201cOnly frames with a gimbal pitch at or below\u201d"],
        [/--ambient-temp and --reflected-temp/g, "an Ambient and a Reflected temperature"],
        [/--ambient-temp\b/g, "Ambient temperature"], [/--reflected-temp\b/g, "Reflected temperature"],
        [/--emissivity\b/g, "Emissivity"], [/--humidity\b/g, "Relative humidity"],
        [/--distance lrf \(the default\)/g, "Distance to the target, Laser rangefinder (the default),"],
        [/--distance embedded/g, "Distance to the target, As recorded,"], [/--distance METRES/g, "a Distance to the target in metres"],
        [/--distance\b/g, "Distance to the target"],
        [/--replace-above\/--replace-above-value \(or --replace-below\/\.\.\.\)/g, "Replace temperatures above (or below), in the settings' Adjustments,"],
        [/--replace-(above|below) TEMP --replace-(?:above|below)-value TEMP/g, "Replace temperatures $1, in the settings' Adjustments"],
        [/--range-min\/--range-max/g, "a Colour range"], [/--gimbal-pitch DEG/g, "a Gimbal override (Adjustments)"],
        [/--strip-location\b/g, "Strip location"],
        [/(\d) deg C\b/g, "$1 \u00b0C"], [/\bdeg C\b/g, "\u00b0C"], [/(\d) deg\b/g, "$1\u00b0"]
    ];
    function settingsWords(text) {
        return SETTING_NAMES.reduce(function (t, r) { return t.replace(r[0], r[1]); }, text || "");
    }

    // What addresses the findings the plugin knows, in its words, with the settings a button sets in the form
    // (dji-thermal-cli's own suggestion, in the settings' words, for the others)
    var FINDING_FIXES = [
        {code: /_varies$/, text: "Tick Normalize in the Workset Creation Settings: one ambient and reflected temperature for every " +
            "frame (Harmonize also removes each frame's drift against its neighbours).", set: {normalize: true}, label: "Normalize"},
        {code: /^oblique$/, text: "The mosaics leave them out. For an orthophoto, leave them out of the workset too, as the WebODM " +
            "plan does: \u201cOnly frames with a gimbal pitch at or below\u201d \u221280\u00b0. Keep them for a 3D model.",
            set: {max_pitch: -80}, label: "Only frames at or below \u221280\u00b0"},
        {code: /^temperature_(max|min)_outlier$/, text: "Hot or cold spots such as sun glint: Replace temperatures above (or below), " +
            "in the settings' Adjustments, blanks or replaces them; a Colour range gives a fixed colour scale."},
        {code: /^rangefinder_distance$/, text: "The workset measures with the rangefinder's distance (the default). To use the " +
            "distance recorded in each photo instead, choose As recorded in Distance to the target."},
        {code: /^rangefinder_invalid$/, text: "Their recorded distance is used instead. If that's wrong, give a Distance to the " +
            "target in metres."},
        {code: /^rangefinder_outlier$/, text: "The laser hit something nearer or farther (a roof, a tree, the horizon). To use one " +
            "distance for every photo, give a Distance to the target in metres."}
    ];
    function findingFix(f) {
        return FINDING_FIXES.filter(function (x) { return x.code.test(f.code); })[0] || null;
    }

    // A finding's message in the settings' words, without the files and values it lists (shown as the files' links,
    // the values in their tooltips): {text, values: {path: value}}
    function findingMessage(f) {
        var values = {};
        var text = String(f.message || "").replace(/: ((?:[^\s,;:]+\.jpe?g -?[\d.]+(?: m)?(?:, |(?=;|$)))+)/i, function (all, list) {
            list.split(", ").forEach(function (item) {
                var i = item.lastIndexOf(" ", item.slice(-2) === " m" ? item.length - 3 : item.length);
                values[item.slice(0, i)] = item.slice(i + 1) + (/^temperature_/.test(f.code) ? " \u00b0C" : "");
            });
            return "";
        });
        var m = /^the embedded object distance is ([\d.]+) m but the rangefinder reads ([\d.]+) m \(median\)/.exec(text);
        if (m && f.code === "rangefinder_distance") text = "each photo records an object distance of " + m[1] + " m, but its rangefinder read " + m[2] + " m (median)";
        return {text: settingsWords(text), values: values};
    }

    // The way through an analyzed dataset, under its summary: check, a workset, a task, the map; each step done (✓) or
    // a link to where it is done, the first not done marked
    function stepsHtml(d) {
        var a = d.analysis || {};
        if (!a.files) return "";
        var serious = (a.findings || []).filter(function (f) { return f.severity !== "info"; });
        var errors = serious.filter(function (f) { return f.severity === "error"; }).length;
        var ready = (d.conversions || []).filter(function (c) { return c.status === "ready"; });
        var tasks = [];
        (d.conversions || []).forEach(function (c) { tasks = tasks.concat(c.tasks || []); });
        if (d.parent && d.parent.images_count) tasks.unshift(d.parent);
        var processed = tasks.filter(function (t) { return t.status === 40; })[0];
        var dashboard = function (t) { return "/dashboard/?project_task_open=" + t.project + "&project_task_expanded=" + t.id; };
        var tabLink = function (t, text, act) {
            return '<a href="#' + t + '" data-step-tab="' + t + '"' + (act ? ' data-step-act="' + act + '"' : "") + ">" + esc(text) + "</a>";
        };
        var steps = [
            // Checked once a workset is made: its warnings may well be accepted
            serious.length ? {done: !!ready.length, html: tabLink("problems", (ready.length ? "Checked: " : "Check the problems: ") +
                [errors ? core.count(errors, "error", "errors") : "", serious.length > errors ? core.count(serious.length - errors, "warning", "warnings") : ""]
                    .filter(Boolean).join(", "))} : {done: true, html: "Checked: no problems"},
            ready.length ? {done: true, html: tabLink("convert", core.count(ready.length, "workset", "worksets"))} :
                {html: "Create a workset, starting from " + (d.can_change && (a.webodm || {}).process_args ?
                    tabLink("convert", "the WebODM plan's settings", "plan") : "the WebODM plan's settings")},
            tasks.length ? {done: true, html: '<a href="' + esc(dashboard(tasks[0])) + '">In a task</a>'} :
                {html: ready.length ? tabLink("convert", "Create a task from a workset") : "Create a task from a workset"},
            processed ? {html: '<a href="/map/project/' + esc(processed.project) + "/task/" + esc(processed.id) + '/">Measure on the map</a>'} :
                {html: "Measure on the map, once the task is processed"}
        ];
        var current = steps.filter(function (x) { return !x.done; })[0];
        return '<ol class="ta-steps">' + steps.map(function (x) {
            return '<li class="' + (x.done ? "ta-step-done" : x === current ? "ta-step-current" : "") + '">' +
                (x.done ? '<i class="fa fa-check"></i> ' : "") + x.html + "</li>";
        }).join("") + "</ol>";
    }

    // The Problems tab: the findings, most severe first, each with what addresses it (and a button setting it in the
    // form, canConvert) and the files it names (each a link to the Files tab filtered to it)
    function problemsHtml(a, canConvert) {
        var findings = a.findings || [];
        if (!findings.length) return '<p class="text-success ta-none"><i class="fa fa-check"></i> dji-thermal-cli found no problems in this dataset.</p>';
        return findings.map(function (f) {
            var cls = {error: "danger", warning: "warning", info: "info"}[f.severity] || "default";
            var files = f.files || [];
            var message = findingMessage(f), fix = findingFix(f);
            var listed = files.slice(0, FILES_SHOWN).map(function (p) {
                var name = p.split("/").pop(), value = message.values[name] || message.values[p];
                return '<a href="#files" data-file="' + esc(p) + '" title="' + (value ? esc(value) + ": " : "") + 'Show it on the Files tab"><code>' + esc(p) + "</code></a>";
            }).join(" ");
            if (files.length > FILES_SHOWN) listed += ' <span class="text-muted">and ' + (files.length - FILES_SHOWN) + " more</span>";
            var suggestion = fix ? fix.text : settingsWords(f.suggestion);
            var button = fix && fix.set && canConvert ? ' <button type="button" class="btn btn-default btn-xs" data-set="' + esc(JSON.stringify(fix.set)) +
                '" data-label="' + esc(fix.label) + '" title="Set it in the Workset Creation Settings, on the Worksets tab"><i class="fa fa-magic"></i> ' +
                esc(fix.label) + "</button>" : "";
            return '<div class="ta-finding alert alert-' + cls + '" title="' + esc(f.code) + '">' +
                '<div><span class="label label-' + cls + '">' + esc(core.severityLabel(f.severity)) + "</span> " + esc(message.text) + "</div>" +
                (suggestion ? '<div class="ta-suggestion"><i class="fa fa-lightbulb"></i> ' + esc(suggestion) + button + "</div>" : "") +
                (files.length ? '<div class="ta-finding-files">' + listed + "</div>" : "") +
                "</div>";
        }).join("");
    }

    function optionsTable(options) {
        var keys = Object.keys(options || {});
        if (!keys.length) return '<p class="text-muted">None.</p>';
        return '<table class="table table-condensed ta-options"><thead><tr><th>Option</th><th>Value</th><th>Why</th></tr></thead><tbody>' +
            keys.map(function (k) {
                var o = options[k];
                return "<tr><td>" + core.optionHtml(k) + "</td><td>" + esc(o.value) + "</td><td>" + esc(o.reason) + "</td></tr>";
            }).join("") + "</tbody></table>";
    }

    // The plan's ODM options, [{name, value, reason, recommended}]: the recommended ones first (conversion_tasks.plan_options)
    function planOptions(p) {
        var out = [];
        [["recommended", true], ["consider", false]].forEach(function (g) {
            Object.keys((p && p[g[0]]) || {}).forEach(function (name) {
                var o = p[g[0]][name];
                out.push({name: name, value: o.value, reason: o.reason || "", recommended: g[1]});
            });
        });
        return out;
    }

    // The options of a preset made from the plan: the plan's, then those of WebODM's Default preset (defaults: its
    // options, [{name, value}]) the plan doesn't set, ticked, so that picking the preset loses none of them
    function presetOptions(p, defaults) {
        var out = planOptions(p);
        (defaults || []).forEach(function (o) {
            if (out.some(function (x) { return x.name === o.name; })) return;
            out.push({name: o.name, value: o.value, reason: "in WebODM's Default preset", recommended: true});
        });
        return out;
    }

    // The Save as a WebODM preset panel (info: {name, options}; draft: the fields as they were, to keep across a redraw)
    function presetHtml(info, draft) {
        var d = draft || {};
        return '<div class="ta-task-head"><strong>New WebODM preset</strong>: pick it in a task\'s Options, in place of Default</div>' +
            conversionsModule.optionsFormHtml(info.options, d.options) +
            '<div class="ta-task-actions"><input type="text" class="form-control input-sm" name="preset-name" maxlength="255" value="' +
            esc(d.name !== undefined ? d.name : info.name) + '" placeholder="Name" aria-label="Preset name">' +
            '<button type="button" class="btn btn-primary btn-xs" data-act="preset-save"><i class="fa fa-save"></i> Save preset</button> ' +
            '<button type="button" class="btn btn-default btn-xs" data-act="preset-close">Close</button></div><div class="ta-task-message"></div>';
    }

    // The preset panel's fields: {draft (presetHtml's), data ({name, options}, to send), problem (what stops it, or null)}
    function readPresetForm(el, info) {
        var name = el.querySelector('[name="preset-name"]').value;
        var o = conversionsModule.readOptions(el, info.options);
        var problem = o.problem || (name.trim() ? null : "Give the preset a name.") || (o.options.length ? null : "Tick at least one option.");
        return {draft: {name: name, options: o.draft}, data: {name: name.trim(), options: o.options}, problem: problem};
    }

    // The WebODM plan tab: how well the frames cover the ground, the task options to use and how to prepare the images
    // (canConvert: a button opens the Convert tab with the plan's settings)
    function planHtml(a, canConvert) {
        var p = a.webodm;
        if (!p) return '<p class="text-muted">No plan: the dataset has no thermal frames to plan with.</p>';
        var c = p.coverage || {};
        var figures = [
            ["Frames used", c.frames],
            ["Ground sample distance", c.gsd_m ? core.formatNumber(c.gsd_m * 100, 1, " cm/px") : ""],
            ["Area", c.area_m2 ? core.formatNumber(c.area_m2, 0, " m²") : ""],
            ["Frames per ground point (median)", c.images_per_point_median],
            ["Area seen by 3 or more frames", c.area_seen_by_3_or_more_pct !== undefined ? core.formatNumber(c.area_seen_by_3_or_more_pct, 0, " %") : ""],
            ["Equivalent overlap", c.equivalent_overlap_pct !== undefined ? core.formatNumber(c.equivalent_overlap_pct, 0, " %") : ""]
        ].filter(function (f) { return f[1] !== undefined && f[1] !== null && f[1] !== ""; });
        var copy = function (what, text) {
            return '<button type="button" class="btn btn-default btn-xs ta-copy" data-copy="' + esc(text) + '" title="Copy ' + what + '">' +
                '<i class="fa fa-copy"></i> Copy</button>';
        };
        var args = (p.odm_arguments || []).join(" ");
        return '<h4>Coverage</h4><dl class="ta-figures">' + figures.map(function (f) {
                return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
            }).join("") + "</dl>" +
            "<h4>Recommended task options</h4>" +
            '<p class="text-muted">In WebODM, a task\'s <em>Options</em> &gt; <em>Edit</em> lists these by name, in the sections shown above them. ' +
            "Create task, on a workset, sets them for you, and so does a preset saved from here.</p>" + optionsTable(p.recommended) +
            (args ? '<p class="ta-odm-args"><code>' + esc(args) + "</code> " + copy("the options", args) + "</p>" : "") +
            "<h4>To consider</h4>" + optionsTable(p.consider) +
            (planOptions(p).length ? '<p><button type="button" class="btn btn-default btn-xs" id="ta-plan-preset" title="Save these options as a preset, to pick in a new task\'s Options">' +
                '<i class="fa fa-save"></i> Save as a WebODM preset</button></p><div class="ta-conversion-task" id="ta-plan-preset-panel"></div>' : "") +
            "<h4>Preparing the images</h4>" +
            "<p>Create a workset with these settings before processing the frames." +
            (p.process_args && canConvert ? ' <button type="button" class="btn btn-primary btn-xs" id="ta-plan-convert" title="Open the Worksets tab with these settings">' +
                '<i class="fa fa-magic"></i> Use these settings</button>' : "") + "</p>" +
            (p.process_command ? '<details class="ta-plan-command"><summary>As a dji-thermal-cli command</summary><div class="ta-command-row"><pre class="ta-command">' +
                esc(p.process_command) + "</pre>" + copy("the command", p.process_command) + "</div></details>" : "") +
            ((p.notes || []).length ? "<h4>Notes</h4><ul>" + p.notes.map(function (n) { return "<li>" + esc(settingsWords(n)) + "</li>"; }).join("") + "</ul>" : "");
    }

    function sharingHtml(s) {
        if (!s) return "";
        var who = [];
        if (s.everyone) who.push("everyone (the Default group)");
        s.groups.filter(function (g) { return g !== "Default"; }).forEach(function (g) { who.push("group " + g); });
        s.users.filter(function (u) { return u !== s.owner; }).forEach(function (u) { who.push(u); });
        return '<i class="fa fa-users"></i> Visible to ' + esc(s.owner) + " (the project's owner)" +
            (who.length ? ", " + esc(who.join(", ")) : " only") +
            '. <span class="text-muted">Change who can see it in the project\'s permissions, on the Dashboard.</span>';
    }

    function init(doc, fetchFn, nav) {
        var page = doc.getElementById("ta-dataset");
        if (!page) return;
        nav = nav || function (url) { root.location.href = url; };

        var API = page.getAttribute("data-api");
        var publicUrl = page.getAttribute("data-public");
        var id = page.getAttribute("data-id");
        var url = API + "datasets/" + id;
        var csrf = (page.querySelector("input[name=csrfmiddlewaretoken]") || {}).value;
        // Thumbnails: thermal frames in the user's preferred DJI palette when they have one, else each image's own
        var palette = core.preferences().palette;
        var thumbsUrl = url + "/thumbnail?" + (palette ? "palette=" + encodeURIComponent(palette) + "&" : "") + "file=";
        var $ = function (i) { return doc.getElementById(i); };
        var dataset = null, view = {show: "all", sort: "path", desc: false, filter: ""}, tab = "convert", tabChosen = false, timer = null, uploading = false;
        var filesKey = null;
        var planShown = null, preset = null;    // the WebODM plan tab as drawn; its preset panel, when open: {info, draft}
        try { view.thumbs = root.localStorage && root.localStorage.getItem(THUMBS_KEY) === "1" ? thumbsUrl : null; } catch (e) { view.thumbs = null; }
        try { view.hover = !!root.localStorage && root.localStorage.getItem(HOVER_KEY) === "1"; } catch (e) { view.hover = false; }
        view.selected = [];
        var anchor = null, hovered = null;      // the last row clicked (Shift-click's range starts there); the row under the mouse
        // A link to a tab (#convert, as the mosaic viewer's way back) opens it
        var linked = ((root.location && root.location.hash) || "").replace(/[^a-z]/g, "");
        if (linked && page.querySelector('#ta-tabs a[data-tab="' + linked + '"]')) { tab = linked; tabChosen = true; }
        var conversions = conversionsModule.init({doc: doc, fetchFn: fetchFn, api: API, publicUrl: publicUrl, csrf: csrf, datasetId: id,
                                                  from: fromQuery((root.location && root.location.search) || ""),
                                                  onChange: function () { return load(); }});

        function send(u, method, data) {
            var opts = {method: method, credentials: "same-origin", headers: {"X-CSRFToken": csrf}};
            if (data !== undefined) {
                opts.headers["Content-Type"] = "application/json";
                opts.body = JSON.stringify(data);
            }
            return fetchFn(u, opts).then(core.readJson, core.unreachable);
        }

        function status(text, cls) {
            $("ta-status").className = "ta-status" + (cls ? " " + cls : "");
            $("ta-status").innerHTML = text || "";
        }

        function renderStatus(d) {
            if (d.status === "analyzing") {
                var pct = Math.round((d.progress || 0) * 100);
                status('<div class="progress"><div class="progress-bar progress-bar-striped active" style="width: ' + pct + '%;">' +
                    pct + "%</div></div> " + (d.stage === "summary" ? "Analyzing: working out the flight's coverage and the WebODM plan…" :
                    "Analyzing " + d.file_count + " file(s)…"));
            } else if (d.status === "failed") {
                status('<i class="fa fa-exclamation-triangle"></i> The analysis failed: ' + esc(d.error), "text-danger");
            } else if (d.status === "canceled") {
                status("The analysis was canceled.", "text-muted");
            } else if (d.status === "new") {
                status(d.file_count ? (d.analyzed ? "Images were added since the last analysis: analyze again to include them." :
                    d.file_count + " file(s), not analyzed yet.") : "No images yet: add the flight's R-JPEGs.", "text-muted");
            } else {
                status("");
            }
        }

        function renderTabs() {
            [].forEach.call(page.querySelectorAll("#ta-tabs li"), function (li) {
                li.classList.toggle("active", li.querySelector("a").getAttribute("data-tab") === tab);
            });
            [].forEach.call(page.querySelectorAll(".ta-tab"), function (el) { el.hidden = el.getAttribute("data-tab") !== tab; });
        }

        // The WebODM task the dataset is kept in, when it is a task of its own (a DJI Thermal Task's) or holds a
        // workset's TIFFs: its name, linked to it on the Dashboard
        function taskLink(d) {
            var t = d.parent;
            if (!t || !(d.in_task || t.images_count)) return "";
            var url = "/dashboard/?project_task_open=" + t.project + "&project_task_expanded=" + t.id;
            return ' · WebODM task <a href="' + esc(url) + '" title="Open the task on WebODM\'s Dashboard">' +
                '<i class="fa fa-tasks"></i> ' + esc(t.name) + "</a>";
        }

        function render(d) {
            dataset = d;
            $("ta-name").textContent = d.name;
            doc.title = d.name + " - DJI Thermal Analyzer";
            $("ta-subtitle").innerHTML = "Project <strong>" + esc(d.project.name) + "</strong>" + taskLink(d) +
                (d.created_by ? " · created by " + esc(d.created_by) : "") + " · " + esc(core.formatDate(d.created_at));
            var analyzing = d.status === "analyzing";
            $("ta-add").hidden = !d.can_change || analyzing || uploading;
            $("ta-analyze").hidden = !d.can_change || analyzing || uploading;
            $("ta-analyze").innerHTML = d.analyzed ? '<i class="fa fa-sync"></i> Analyze again' : '<i class="fa fa-play"></i> Analyze';
            $("ta-cancel").hidden = !d.can_change || !analyzing;
            $("ta-rename").hidden = !d.can_change;
            $("ta-delete").hidden = !d.can_delete;
            $("ta-sharing").hidden = !d.sharing;
            $("ta-sharing").innerHTML = sharingHtml(d.sharing);
            renderStatus(d);

            var a = d.analysis || {};
            $("ta-overview").innerHTML = overviewHtml(d);
            $("ta-steps").innerHTML = stepsHtml(d);
            // Converting needs no analysis: the tabs show as soon as there are images (or conversions)
            $("ta-tabs").hidden = !a.files && !d.file_count && !(d.conversions || []).length;
            // Before the analysis only the Worksets tab has something to show; the page opens on it unless a tab was chosen
            [].forEach.call(page.querySelectorAll("#ta-tabs a[data-tab]"), function (link) {
                if (link.getAttribute("data-tab") !== "convert") link.parentNode.hidden = !a.files;
            });
            if (!a.files || !tabChosen) tab = "convert";
            conversions.update(d);
            view.frames = framePage(publicUrl, d);
            if (a.files) {
                $("ta-files-count").textContent = a.files.length;
                var serious = (a.findings || []).filter(function (f) { return f.severity !== "info"; }).length;
                $("ta-problems-count").textContent = serious || "";
                // Polling redraws the rest: the Files tab only when it would change, not to lose the filter's focus
                var key = [d.analyzed_at, a.files.length, view.frames].join("|");
                if (key !== filesKey) renderFiles();
                filesKey = key;
                $("ta-tab-problems").innerHTML = problemsHtml(a, d.can_change);
                // Redrawn only when it changes, not to lose the preset panel's fields
                var plan = planHtml(a, d.can_change);
                if (plan !== planShown) {
                    $("ta-tab-webodm").innerHTML = plan;
                    planShown = plan;
                    preset = null;
                }
            } else {
                ["files", "problems", "webodm"].forEach(function (t) { $("ta-tab-" + t).innerHTML = ""; });
                filesKey = null;
                planShown = null;
                preset = null;
            }
            renderTabs();

            if (timer && root.clearTimeout) root.clearTimeout(timer);
            var converting = (d.conversions || []).some(function (c) { return c.status === "converting" || c.mosaic_status === "building"; });
            timer = (analyzing || converting) && root.setTimeout ? root.setTimeout(load, POLL_MS) : null;
        }

        function renderFiles() {
            $("ta-tab-files").innerHTML = filesHtml(dataset.analysis, view);
            renderDetail();
        }

        // Only the table and its count, while typing in the filter
        function renderFilesTable() {
            var table = filesTableHtml(dataset.analysis, view);
            page.querySelector(".ta-files-table").innerHTML = table.html;
            page.querySelector(".ta-files-shown").textContent = table.count + " shown";
        }

        // The detail pane: the files selected, else (with Hover for Detail) the one under the mouse
        function detailUrls() {
            return {files: url + "/files?file=", picture: url + "/thumbnail", palette: palette || "", frames: view.frames || null,
                    remove: dataset.can_change ? removeBusy(dataset) : null};
        }

        function renderDetail() {
            var pane = page.querySelector(".ta-file-detail");
            if (!pane) return;
            var paths = view.selected.length ? view.selected : view.hover && hovered ? [hovered] : [];
            var html = detailHtml(dataset.analysis, paths, view.selected.length > 0, detailUrls());
            pane.hidden = !html;
            if (pane.innerHTML !== html) pane.innerHTML = html;
        }

        // The selection changed: the rows marked (the table kept as it is, scrolled where it was) and the pane
        function selectionChanged() {
            [].forEach.call(page.querySelectorAll(".ta-files tbody tr[data-path]"), function (tr) {
                tr.classList.toggle("ta-selected", view.selected.indexOf(tr.getAttribute("data-path")) >= 0);
            });
            renderDetail();
        }

        // A click on a row: it alone selected (unselected when it was), Ctrl/Cmd adds or removes it, Shift the range
        // from the last one clicked, in the table's order
        function select(path, e) {
            if (e.shiftKey && anchor !== null) {
                var order = fileRows(dataset.analysis, view).map(function (r) { return r.path; });
                var i = order.indexOf(anchor), j = order.indexOf(path);
                if (i >= 0 && j >= 0) {
                    view.selected = order.slice(Math.min(i, j), Math.max(i, j) + 1);
                    if (root.getSelection) root.getSelection().removeAllRanges();
                    return selectionChanged();
                }
            }
            if (e.ctrlKey || e.metaKey) {
                view.selected = view.selected.indexOf(path) >= 0 ? view.selected.filter(function (p) { return p !== path; }) : view.selected.concat([path]);
            } else {
                view.selected = view.selected.length === 1 && view.selected[0] === path ? [] : [path];
            }
            anchor = path;
            selectionChanged();
        }

        // The picture viewer, opened at a file's picture: the file shown is the one selected, its row scrolled to
        function viewPicture(path) {
            var items = viewerItems(dataset.analysis, view, detailUrls());
            var index = items.map(function (it) { return it.path; }).indexOf(path);
            if (index < 0) return;
            pictureViewer.open(doc, {items: items, index: index, onShow: function (i) {
                var shown = items[i].path;
                anchor = shown;
                if (view.selected.length === 1 && view.selected[0] === shown) return;
                view.selected = [shown];
                selectionChanged();
                var tr = [].filter.call(page.querySelectorAll(".ta-files tbody tr[data-path]"), function (row) { return row.getAttribute("data-path") === shown; })[0];
                if (tr && tr.scrollIntoView) tr.scrollIntoView({block: "nearest"});
            }});
        }

        // The selected files as a zip: a form posted, so the browser downloads it however many there are
        function downloadSelected() {
            var form = doc.createElement("form");
            form.method = "POST";
            form.action = url + "/files";
            form.hidden = true;
            [["csrfmiddlewaretoken", csrf]].concat(view.selected.map(function (p) { return ["file", p]; })).forEach(function (f) {
                var input = doc.createElement("input");
                input.type = "hidden";
                input.name = f[0];
                input.value = f[1];
                form.appendChild(input);
            });
            doc.body.appendChild(form);
            form.submit();
            doc.body.removeChild(form);
        }

        // The files the detail pane shows (those selected, else the one under the mouse) removed from the dataset and
        // its worksets, once confirmed: the page then drawn from what the server answers
        function removeFiles() {
            var paths = view.selected.length ? view.selected : view.hover && hovered ? [hovered] : [];
            if (!paths.length) return;
            var one = paths.length === 1;
            var text = ["Remove " + (one ? paths[0].split("/").pop() : paths.length + " files") + " from " + dataset.name + "?",
                (one ? "Its file is deleted from the server. The worksets that converted it lose it too: its files there, and the measurements saved on it, " :
                    "Their files are deleted from the server. The worksets that converted them lose them too: their files there, and the measurements saved on them, ") +
                    "are deleted, and mosaics built with " + (one ? "it" : "them") + " are marked out of date. The tasks made before keep their images.",
                "The analysis is kept: Analyze again to bring the summary, problems and plan up to date.", "This cannot be undone."];
            return core.ask(doc, "Remove from dataset", text, "Remove", "danger").then(function (yes) {
                return yes && send(url + "/remove", "POST", {files: paths});
            }).then(function (r) {
                if (!r) return;
                if (!r.ok) return status(esc(core.errorText(r.data, "Could not remove the files.")), "text-danger");
                view.selected = [];
                hovered = null;
                anchor = null;
                render(r.data);
                status('<i class="fa fa-check"></i> ' + esc(core.count(r.data.files_removed, "file", "files")) +
                    " removed. Analyze again to bring the summary, problems and plan up to date.", "text-success");
            });
        }

        function showTab(t) {
            tab = t;
            tabChosen = true;
            renderTabs();
        }

        // A reload that failed while a job runs is tried again, less often: one dropped request must not leave the
        // page showing the job as it was
        function retry() {
            if (timer && root.setTimeout) timer = root.setTimeout(load, POLL_MS * 5);
        }

        function load() {
            return fetchFn(url, {credentials: "same-origin"})
                .then(core.readJson)
                .then(function (r) {
                    if (!r.ok) {
                        retry();
                        return status("Could not load the dataset.", "text-danger");
                    }
                    // Loaded, but the page failed drawing it: said apart from a failed request, and logged
                    try { render(r.data); } catch (e) {
                        if (root.console) root.console.error(e);
                        status("Could not show the dataset (" + esc(e.message) + "). Reload the page, bypassing the browser's cache (Ctrl+Shift+R).", "text-danger");
                    }
                }, function () {
                    retry();
                    status("Could not load the dataset.", "text-danger");
                });
        }

        function action(u, failure) {
            return send(u, "POST", {}).then(function (r) {
                if (!r.ok) return status(esc(core.errorText(r.data, failure)), "text-danger");
                render(r.data);
            });
        }

        $("ta-tabs").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-tab]") : null;
            if (!a) return;
            e.preventDefault();
            showTab(a.getAttribute("data-tab"));
        });

        $("ta-tab-files").addEventListener("click", function (e) {
            if (!dataset || !e.target.closest) return;
            if (e.target.closest('[data-act="scope-clear"]')) {
                view.camera = null;
                view.nogps = false;
                return renderFiles();
            }
            var th = e.target.closest("th[data-sort]");
            if (th) {
                var key = th.getAttribute("data-sort");
                view.desc = view.sort === key ? !view.desc : false;
                view.sort = key;
                return renderFilesTable();
            }
            if (e.target.closest('[data-act="detail-close"]')) {
                view.selected = [];
                return selectionChanged();
            }
            if (e.target.closest('[data-act="download-selected"]')) return downloadSelected();
            if (e.target.closest('[data-act="remove-files"]')) return removeFiles();
            // The detail pane's picture opens the viewer (Ctrl/Cmd-click, or the middle button, still opens a tab)
            var picture = e.target.closest('[data-act="view-picture"]');
            if (picture && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) {
                e.preventDefault();
                return viewPicture(picture.getAttribute("data-path"));
            }
            // A click on a row (not on its name's link) selects it
            var tr = e.target.closest(".ta-files tbody tr[data-path]");
            if (tr && !e.target.closest("a")) select(tr.getAttribute("data-path"), e);
        });

        $("ta-tab-files").addEventListener("mouseover", function (e) {
            if (!dataset || !view.hover || view.selected.length || !e.target.closest) return;
            var tr = e.target.closest(".ta-files tbody tr[data-path]");
            if (!tr || tr.getAttribute("data-path") === hovered) return;
            hovered = tr.getAttribute("data-path");
            renderDetail();
        });

        doc.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && view.selected.length && tab === "files") {
                view.selected = [];
                selectionChanged();
            }
        });

        $("ta-tab-files").addEventListener("change", function (e) {
            if (!dataset) return;
            if (e.target.name === "ta-files-show") {
                view.show = e.target.value;
                renderFilesTable();
            } else if (e.target.classList.contains("ta-files-thumbs")) {
                view.thumbs = e.target.checked ? thumbsUrl : null;
                try { root.localStorage.setItem(THUMBS_KEY, e.target.checked ? "1" : "0"); } catch (err) { /* not remembered */ }
                renderFilesTable();
            } else if (e.target.classList.contains("ta-files-hover")) {
                view.hover = e.target.checked;
                hovered = null;
                try { root.localStorage.setItem(HOVER_KEY, e.target.checked ? "1" : "0"); } catch (err) { /* not remembered */ }
                renderDetail();
            }
        });

        $("ta-tab-files").addEventListener("input", function (e) {
            if (!dataset || !e.target.classList.contains("ta-files-filter")) return;
            view.filter = e.target.value;
            renderFilesTable();
        });

        // A file named by a problem: the Files tab, filtered to it
        // The summary: a camera's row, or a figure in it, opens the Files tab narrowed and sorted to match
        function openFiles(camera, sort, desc, nogps) {
            if (!dataset || !dataset.analysis) return;
            view.camera = camera || null;
            view.nogps = !!nogps;
            view.show = "all";
            view.filter = "";
            view.sort = sort || "path";
            view.desc = !!desc;
            renderFiles();
            showTab("files");
            var tabs = $("ta-tabs");
            if (tabs.scrollIntoView) tabs.scrollIntoView({behavior: "smooth", block: "start"});
        }

        $("ta-overview").addEventListener("click", function (e) {
            if (!e.target.closest) return;
            var link = e.target.closest(".ta-summary-link");
            if (link) {
                return openFiles(link.getAttribute("data-camera"), link.getAttribute("data-files-sort"), link.hasAttribute("data-desc"),
                                 link.hasAttribute("data-nogps"));
            }
            var row = e.target.closest("tr[data-camera]");
            if (row) openFiles(row.getAttribute("data-camera"));
        });

        $("ta-overview").addEventListener("keydown", function (e) {
            var row = e.target.matches && e.target.matches("tr[data-camera]") ? e.target : null;
            if (!row || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            openFiles(row.getAttribute("data-camera"));
        });

        $("ta-tab-problems").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-file]") : null;
            if (!a || !dataset) return;
            e.preventDefault();
            view.filter = a.getAttribute("data-file");
            view.show = "all";
            view.camera = null;
            view.nogps = false;
            renderFiles();
            showTab("files");
        });

        // The steps' links: to a tab, the WebODM plan's settings put in the form on the way
        $("ta-steps").addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[data-step-tab]") : null;
            if (!a) return;
            e.preventDefault();
            if (a.getAttribute("data-step-act") === "plan") conversions.usePlan();
            showTab(a.getAttribute("data-step-tab"));
        });

        // A finding's button: its settings in the form, on the Worksets tab
        $("ta-tab-problems").addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button[data-set]") : null;
            if (b && conversions.useSettings(JSON.parse(b.getAttribute("data-set")), b.getAttribute("data-label"))) {
                showTab("convert");
                if ($("ta-convert-settings").scrollIntoView) $("ta-convert-settings").scrollIntoView();
            }
        });

        $("ta-tab-webodm").addEventListener("click", function (e) {
            if (!e.target.closest) return;
            var button = e.target.closest("button[data-copy]");
            if (button) return copyText(button.getAttribute("data-copy"), button, "Copy");
            if (e.target.closest("#ta-plan-preset")) return openPreset();
            var act = (e.target.closest("button[data-act]") || {getAttribute: function () { return null; }}).getAttribute("data-act");
            if (act === "preset-save") return savePreset();
            if (act === "preset-close") {
                preset = null;
                return renderPreset();
            }
            if (e.target.closest("#ta-plan-convert") && conversions.usePlan()) {
                showTab("convert");
                if ($("ta-convert-settings").scrollIntoView) $("ta-convert-settings").scrollIntoView();
            }
        });

        // Save as a WebODM preset: a panel of the plan's options and those of WebODM's Default preset, saved through
        // WebODM's presets API, replacing (once asked) a preset of the user's with the same name
        var PRESETS = API.replace(/plugins\/.*$/, "presets/");

        function renderPreset() {
            var el = $("ta-plan-preset-panel");
            if (el) el.innerHTML = !preset ? "" : preset.info ? presetHtml(preset.info, preset.draft) : '<p class="text-muted">Loading…</p>';
        }

        function presetMessage(text, cls) {
            var m = $("ta-plan-preset-panel") && $("ta-plan-preset-panel").querySelector(".ta-task-message");
            if (!m) return;
            m.className = "ta-task-message" + (cls ? " " + cls : "");
            m.innerHTML = text;
        }

        function openPreset() {
            var plan = (dataset.analysis || {}).webodm;
            preset = {info: null, draft: null};
            renderPreset();
            return fetchFn(PRESETS, {credentials: "same-origin"}).then(core.readJson, core.unreachable).then(function (r) {
                if (!preset) return;
                if (!r.ok || !Array.isArray(r.data)) {
                    preset = null;
                    $("ta-plan-preset-panel").innerHTML = '<p class="text-danger">' + esc(core.errorText(r.data, "Could not read WebODM's presets.")) + "</p>";
                    return;
                }
                var defaults = r.data.filter(function (x) { return x.system && x.name === "Default"; })[0];
                preset.info = {name: "DJI Thermal: " + dataset.name, options: presetOptions(plan, defaults ? defaults.options : [])};
                renderPreset();
            });
        }

        function savePreset() {
            var el = $("ta-plan-preset-panel");
            if (!el || !preset || !preset.info) return;
            var form = readPresetForm(el, preset.info);
            preset.draft = form.draft;
            if (form.problem) return presetMessage(esc(form.problem), "text-danger");
            var btn = el.querySelector('[data-act="preset-save"]');
            btn.disabled = true;
            return fetchFn(PRESETS, {credentials: "same-origin"}).then(core.readJson, core.unreachable).then(function (r) {
                if (!r.ok || !Array.isArray(r.data)) return r;
                var same = r.data.filter(function (x) { return !x.system && x.name === form.data.name; })[0];
                if (!same) return send(PRESETS, "POST", form.data);
                return core.ask(doc, "Replace the preset?", 'You already have a preset named "' + form.data.name + '". Replace its options with these?',
                                "Replace", "danger").then(function (yes) {
                    return yes ? send(PRESETS + same.id + "/", "PATCH", {options: form.data.options}) : null;
                });
            }).then(function (r) {
                btn.disabled = false;
                if (!r) return;
                if (!r.ok) return presetMessage(esc(core.errorText(r.data, "Could not save the preset.")), "text-danger");
                presetMessage('<i class="fa fa-check"></i> Saved &ldquo;' + esc(r.data.name) + "&rdquo;: pick it in a new task's <em>Options</em>.", "text-success");
            });
        }

        // To the clipboard, the button saying so (an icon's tick for a moment); without one (or refused), a dialog to
        // copy it from
        function copyText(text, button, title) {
            var done = function () {
                if (!button.classList.contains("ta-icon")) {
                    button.innerHTML = '<i class="fa fa-check"></i> Copied';
                    return;
                }
                var before = button.innerHTML;
                button.innerHTML = '<i class="fa fa-check"></i>';
                root.setTimeout(function () { button.innerHTML = before; }, 1500);
            };
            var show = function () {
                core.dialog(doc, {title: title, text: "Copy this:", field: {value: text, readonly: true},
                                  buttons: [{label: "Close", value: true, style: "primary"}]});
                var field = $("ta-ask-field");
                if (field && field.select) field.select();
            };
            if (root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(text).then(done, show);
            else show();
        }

        $("ta-analyze").addEventListener("click", function () { action(url + "/analyze", "Could not start the analysis."); });
        $("ta-cancel").addEventListener("click", function () { action(url + "/cancel", "Could not cancel the analysis."); });

        $("ta-rename").addEventListener("click", function () {
            core.askName(doc, "Rename dataset", dataset.name).then(function (name) {
                if (!name) return;
                return send(url, "PATCH", {name: name}).then(function (r) {
                    if (!r.ok) return status(esc(core.errorText(r.data, "Could not rename the dataset.")), "text-danger");
                    render(r.data);
                });
            });
        });

        $("ta-delete").addEventListener("click", function () {
            core.ask(doc, "Delete dataset", core.deleteText(dataset), "Delete", "danger").then(function (yes) {
                if (!yes) return;
                return send(url, "DELETE").then(function (r) {
                    if (!r.ok) return status(esc(core.errorText(r.data, "Could not delete the dataset.")), "text-danger");
                    nav(publicUrl);
                });
            });
        });

        $("ta-copy-link").addEventListener("click", function () {
            var link = root.location ? root.location.origin + publicUrl + "dataset/" + id : publicUrl + "dataset/" + id;
            copyText(link, $("ta-copy-link"), "Copy link");
        });

        // Adding images: the images sent are kept when the upload is canceled (the dataset exists already); those that
        // did not arrive (failed, or never sent) can be sent again
        var controller = null, unsent = [];
        function addImages(files) {
            uploading = true;
            unsent = [];
            $("ta-add-failed").hidden = true;
            render(dataset);
            var bar = $("ta-add-progress");
            bar.querySelector(".progress-bar").style.width = "0%";
            $("ta-add-progress-text").textContent = "";
            $("ta-add-cancel").disabled = false;
            bar.hidden = false;
            controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            return core.uploadFiles(fetchFn, url + "/upload", csrf, files, function (p) {
                var pct = p.bytesTotal ? Math.round(p.bytesSent / p.bytesTotal * 100) : 0;
                bar.querySelector(".progress-bar").style.width = pct + "%";
                $("ta-add-progress-text").textContent = "Uploading " + p.sent + " of " + p.total + " images (" + pct + "%)";
            }, null, {signal: controller && controller.signal}).then(function (u) {
                uploading = false;
                controller = null;
                bar.hidden = true;
                unsent = u.failed;
                return (u.saved && !u.canceled ? action(url + "/analyze", "Could not start the analysis.") : load()).then(function () {
                    if (!unsent.length) return;
                    $("ta-add-failed-text").textContent = u.canceled ?
                        "Upload canceled: " + core.count(u.saved, "image was", "images were") + " sent and kept (analyze again to include them), " +
                        core.count(unsent.length, "image was", "images were") + " not sent." :
                        core.failedText(unsent);
                    $("ta-add-failed").hidden = false;
                });
            });
        }

        $("ta-add-files").addEventListener("change", function (e) {
            var files = [].slice.call(e.target.files || []);
            e.target.value = "";
            if (!files.filter(core.isImage).length) return status("Choose JPEG images (the flight's R-JPEGs).", "text-danger");
            addImages(files);
        });

        $("ta-add-cancel").addEventListener("click", function () {
            if (!controller) return;
            $("ta-add-cancel").disabled = true;
            $("ta-add-progress-text").textContent = "Canceling…";
            controller.abort();
        });

        $("ta-add-retry").addEventListener("click", function () {
            if (unsent.length && !uploading) addImages(unsent);
        });

        // Leaving the page would stop the upload half way
        if (root.addEventListener) root.addEventListener("beforeunload", function (e) {
            if (!uploading) return;
            e.preventDefault();
            e.returnValue = "";
        });

        return load();
    }

    var api = {planOptions: planOptions, presetOptions: presetOptions, presetHtml: presetHtml, readPresetForm: readPresetForm,
               captureTime: captureTime, median: core.median, overview: overview, summaryRows: summaryRows, duration: duration, overviewHtml: overviewHtml, flagsByFile: flagsByFile,
               framePage: framePage, fromQuery: fromQuery, sortRows: core.sortRows, fileRows: fileRows, detailRows: detailRows, viewerSrc: viewerSrc, viewerItems: viewerItems, detailHtml: detailHtml, filesHtml: filesHtml, stepsHtml: stepsHtml, settingsWords: settingsWords, findingMessage: findingMessage, problemsHtml: problemsHtml, planHtml: planHtml, sharingHtml: sharingHtml, init: init};
    root.ThermalAnalyzerDataset = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});

if (typeof window !== "undefined" && window.document && window.fetch) {
    window.ThermalAnalyzerDataset.init(document, window.fetch.bind(window));
}
