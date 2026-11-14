// A frame's preview: the frame at its full size over the whole page, for the frames windows' "Preview frame" (the photos
// that saw a spot, frames3d.js; a workset's frames that saw a point, frames.js), on WebODM's map and 3D pages and the
// Analyzer's mosaic viewer. The frame is fitted to the page, zoomed by the wheel, a pinch, the buttons or + and -,
// dragged to pan, stepped to the previous and next frame (the buttons, the arrow keys) and closed (the cross, Esc); the
// spot's mark stays on its pixel, and the temperature under the pointer is shown when the caller can read it.
(function (root) {
    var MAX_ZOOM = 16;          // times the frame's own pixels, at most (more when the page fits it larger)
    var STEP = 1.25;            // one notch of the wheel, one press of a zoom button
    var DOUBLE = 3;             // a double click zooms a fitted frame this much, and fits a zoomed one

    // The scale that fits a frame (w x h) in the stage (W x H)
    function fitScale(w, h, W, H) { return Math.min(W / w, H / h); }

    // A view ({scale, x, y}: the frame's first pixel at the stage's x, y) kept in the stage: centred where the frame is
    // smaller than it, else covering it
    function clampView(view, w, h, W, H) {
        var along = function (at, size, room) { return size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, at)); };
        return {scale: view.scale, x: along(view.x, w * view.scale, W), y: along(view.y, h * view.scale, H)};
    }

    function fitView(w, h, W, H) { return clampView({scale: fitScale(w, h, W, H), x: 0, y: 0}, w, h, W, H); }

    // A view zoomed by a factor about a point of the stage (px, py), which keeps its pixel; between the fitted scale and
    // MAX_ZOOM
    function zoomView(view, factor, px, py, w, h, W, H) {
        var fit = fitScale(w, h, W, H), scale = Math.max(fit, Math.min(Math.max(fit, MAX_ZOOM), view.scale * factor));
        var k = scale / view.scale;
        return clampView({scale: scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k}, w, h, W, H);
    }

    function barHtml() {
        var button = function (action, icon, label) {
            return '<button type="button" class="btn btn-default btn-sm" data-preview="' + action + '" title="' + label + '" aria-label="' +
                label + '"><i class="fa fa-' + icon + '"></i></button>';
        };
        return '<div class="dt-preview-bar"><span class="dt-preview-title"></span>' +
            button("prev", "chevron-left", "Previous frame (left arrow)") + button("next", "chevron-right", "Next frame (right arrow)") +
            '<span class="dt-preview-gap"></span>' +
            button("out", "search-minus", "Zoom out (-)") + button("in", "search-plus", "Zoom in (+)") +
            button("fit", "expand", "Fit to the page (0)") + '<span class="dt-preview-gap"></span>' +
            button("close", "times", "Close (Esc)") + "</div>" +
            '<div class="dt-preview-stage"><div class="dt-preview-frame"></div><span class="ta-pip-mark dt-preview-mark" hidden></span>' +
            '<span class="dt-preview-reading" hidden></span><div class="dt-preview-note" hidden></div></div>';
    }

    // The preview opened over doc's page. o: {count, at (the frame shown first), title(i) (the bar's words), item(i):
    // {name, width, height, mark ({x, y}: the spot's pixel, continuous, pixel centres at whole numbers) or null, and
    // either url (a picture) or paint(canvas) (a promise of true once drawn, or of the words to show in its place), read
    // (column, row): the text for the pixel under the pointer, or ""}, shown(i) (the frame shown changed), closed()}.
    // Answers {close, show(i), view(), element}
    function open(doc, o) {
        var win = doc.defaultView || root, opener = doc.activeElement;
        var el = doc.createElement("div");
        el.className = "dt-preview";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-label", "Frame preview");
        el.tabIndex = -1;
        el.innerHTML = barHtml();
        var stage = el.querySelector(".dt-preview-stage"), frame = el.querySelector(".dt-preview-frame");
        var mark = el.querySelector(".dt-preview-mark"), reading = el.querySelector(".dt-preview-reading"), note = el.querySelector(".dt-preview-note");
        var at = -1, item = null, view = null, fitted = true, seq = 0, closed = false;
        var pointers = {}, pinch = null;

        function size() { return {W: stage.clientWidth || win.innerWidth || 1, H: stage.clientHeight || win.innerHeight || 1}; }
        function place() {
            if (!item) return;
            frame.style.transform = "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
            mark.hidden = !item.mark || !note.hidden;
            if (item.mark) {
                mark.style.left = (view.x + (item.mark.x + 0.5) * view.scale) + "px";
                mark.style.top = (view.y + (item.mark.y + 0.5) * view.scale) + "px";
            }
        }
        function fit() {
            var s = size();
            view = fitView(item.width, item.height, s.W, s.H);
            fitted = true;
            place();
        }
        function zoom(factor, px, py) {
            if (!item) return;
            var s = size();
            if (px === undefined) { px = s.W / 2; py = s.H / 2; }
            view = zoomView(view, factor, px, py, item.width, item.height, s.W, s.H);
            fitted = view.scale <= fitScale(item.width, item.height, s.W, s.H);
            place();
        }
        function say(text) {
            note.textContent = text || "";
            note.hidden = !text;
            place();
        }

        function show(i) {
            i = Math.max(0, Math.min(o.count - 1, i));
            if (i === at) return;
            var mine = ++seq, changed = at >= 0;
            at = i;
            item = o.item(i);
            el.querySelector(".dt-preview-title").textContent = o.title ? o.title(i) : item.name || "";
            el.querySelector('[data-preview="prev"]').disabled = i === 0;
            el.querySelector('[data-preview="next"]').disabled = i === o.count - 1;
            reading.hidden = true;
            frame.innerHTML = "";
            frame.style.width = item.width + "px";
            frame.style.height = item.height + "px";
            fit();
            say("");
            if (item.url) {
                var img = doc.createElement("img");
                img.alt = item.name || "";
                img.draggable = false;
                img.onerror = function () { if (mine === seq) say("This frame couldn't be loaded."); };
                img.src = item.url;
                frame.appendChild(img);
            } else {
                var canvas = doc.createElement("canvas");
                canvas.width = item.width;
                canvas.height = item.height;
                canvas.setAttribute("aria-label", item.name || "");
                frame.appendChild(canvas);
                say("Loading…");
                item.paint(canvas).then(function (drawn) {
                    if (mine === seq) say(drawn === true ? "" : drawn || "This frame couldn't be loaded.");
                }, function () { if (mine === seq) say("This frame couldn't be loaded."); });
            }
            if (changed && o.shown) o.shown(i);
        }

        // Where an event is on the stage
        function point(e) {
            var r = stage.getBoundingClientRect();
            return {x: e.clientX - r.left, y: e.clientY - r.top};
        }
        function read(e) {
            var p = point(e), col = Math.floor((p.x - view.x) / view.scale), row = Math.floor((p.y - view.y) / view.scale);
            var inside = item && item.read && note.hidden && col >= 0 && row >= 0 && col < item.width && row < item.height;
            var text = inside ? item.read(col, row) : "";
            reading.textContent = text || "";
            reading.hidden = !text;
            if (text) {
                reading.style.left = (p.x + 14) + "px";
                reading.style.top = (p.y + 14) + "px";
            }
        }
        function spread() {
            var ids = Object.keys(pointers), a = pointers[ids[0]], b = pointers[ids[1]];
            return {distance: Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
        }

        stage.addEventListener("pointerdown", function (e) {
            if (!item || (e.pointerType === "mouse" && e.button !== 0)) return;
            pointers[e.pointerId] = point(e);
            if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a pointer already gone */ } }
            pinch = Object.keys(pointers).length === 2 ? spread() : null;
            reading.hidden = true;
            e.preventDefault();
        });
        stage.addEventListener("pointermove", function (e) {
            if (!item) return;
            var was = pointers[e.pointerId], p = point(e), s = size();
            if (!was) return read(e);
            pointers[e.pointerId] = p;
            if (pinch && Object.keys(pointers).length === 2) {
                var now = spread();
                view = zoomView({scale: view.scale, x: view.x + now.x - pinch.x, y: view.y + now.y - pinch.y}, now.distance / pinch.distance,
                                now.x, now.y, item.width, item.height, s.W, s.H);
                fitted = view.scale <= fitScale(item.width, item.height, s.W, s.H);
                pinch = now;
            } else if (Object.keys(pointers).length === 1) {
                view = clampView({scale: view.scale, x: view.x + p.x - was.x, y: view.y + p.y - was.y}, item.width, item.height, s.W, s.H);
            }
            el.classList.add("dt-preview-dragging");
            place();
        });
        var release = function (e) {
            delete pointers[e.pointerId];
            pinch = null;
            if (!Object.keys(pointers).length) el.classList.remove("dt-preview-dragging");
        };
        stage.addEventListener("pointerup", release);
        stage.addEventListener("pointercancel", release);
        stage.addEventListener("pointerleave", function () { reading.hidden = true; });
        stage.addEventListener("wheel", function (e) {
            e.preventDefault();
            var p = point(e);
            zoom(e.deltaY < 0 ? STEP : 1 / STEP, p.x, p.y);
            read(e);
        }, {passive: false});
        stage.addEventListener("dblclick", function (e) {
            if (!item) return;
            var p = point(e);
            if (fitted) zoom(DOUBLE, p.x, p.y);
            else fit();
        });

        el.addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("[data-preview]") : null, action = b && b.getAttribute("data-preview");
            if (!action || b.disabled) return;
            if (action === "close") api.close();
            else if (action === "prev") show(at - 1);
            else if (action === "next") show(at + 1);
            else if (action === "in") zoom(STEP);
            else if (action === "out") zoom(1 / STEP);
            else if (action === "fit") fit();
        });

        // The page's own keys (the map's, the 3D view's) stay out of it while it is open; Tab stays among its buttons
        function onKey(e) {
            var key = e.key, handled = true;
            if (key === "Escape" || key === "Esc") api.close();
            else if (key === "ArrowLeft" || key === "Left") show(at - 1);
            else if (key === "ArrowRight" || key === "Right") show(at + 1);
            else if (key === "+" || key === "=") zoom(STEP);
            else if (key === "-" || key === "_") zoom(1 / STEP);
            else if (key === "0") fit();
            else if (key === "Tab") {
                var buttons = Array.prototype.filter.call(el.querySelectorAll("button"), function (b) { return !b.disabled; });
                var i = buttons.indexOf(doc.activeElement), n = buttons.length;
                if (n) buttons[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
            } else handled = false;
            if (handled) e.preventDefault();
            e.stopPropagation();
        }
        function onResize() {
            if (!item) return;
            var s = size();
            if (fitted) fit();
            else { view = zoomView(view, 1, s.W / 2, s.H / 2, item.width, item.height, s.W, s.H); place(); }
        }

        var api = {
            close: function () {
                if (closed) return;
                closed = true;
                seq++;
                doc.removeEventListener("keydown", onKey, true);
                if (win.removeEventListener) win.removeEventListener("resize", onResize);
                if (el.parentNode) el.parentNode.removeChild(el);
                if (opener && opener.focus && doc.contains(opener)) opener.focus();
                if (o.closed) o.closed();
            },
            show: show,
            view: function () { return view; },
            at: function () { return at; },
            element: el
        };

        doc.body.appendChild(el);
        doc.addEventListener("keydown", onKey, true);
        if (win.addEventListener) win.addEventListener("resize", onResize);
        el.focus();
        show(o.at || 0);
        return api;
    }

    var api = {open: open, fitScale: fitScale, fitView: fitView, clampView: clampView, zoomView: zoomView, MAX_ZOOM: MAX_ZOOM, STEP: STEP};
    root.ThermalPreview = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
