// The picture viewer of the DJI Thermal Analyzer's pages: a picture drawn over the page, fitted to it, with zoom (the
// buttons, the mouse wheel where it points, a double click), dragging to pan, the previous and next pictures, Download
// and a close button. The zoom's sums are plain functions (DOM-free), so Jest can test them.
(function (root) {
    var ZOOM_STEP = 1.5;        // the zoom buttons' and keys' factor
    var WHEEL_RATE = 0.002;     // the wheel's zoom per pixel scrolled
    var DRAG_PX = 3;            // a press that moves less is a click

    // A picture (pic: {w, h}) fitted to a box ({w, h}) and centred in it: {scale, x, y}, x and y its top left corner
    function fitView(pic, box) {
        var scale = Math.min(box.w / pic.w, box.h / pic.h);
        return {scale: scale, x: (box.w - pic.w * scale) / 2, y: (box.h - pic.h * scale) / 2};
    }

    // How far it zooms: out to a quarter of the fit (or of 100%, when smaller), in to 16 times the fit (or 100%)
    function zoomLimits(pic, box) {
        var fit = fitView(pic, box).scale;
        return {min: Math.min(fit, 1) / 4, max: Math.max(fit, 1) * 16};
    }

    // A view zoomed by factor, the box's point (px, py) staying where it is, within the limits
    function zoomAt(view, factor, px, py, limits) {
        var scale = Math.min(limits.max, Math.max(limits.min, view.scale * factor));
        var k = scale / view.scale;
        return {scale: scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k};
    }

    // The zoom factor of a wheel event's deltaY (deltaMode: pixels, lines or pages): scrolling down zooms out
    function wheelFactor(deltaY, deltaMode) {
        return Math.exp(-deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1) * WHEEL_RATE);
    }

    // The viewer, opened at items[index] (items: [{name, path, src, download}], src the picture shown, download the
    // file's download URL); onShow(i) is called with each item shown, the first included. Returns {close}.
    function open(doc, opts) {
        var items = opts.items, index = opts.index;
        var before = doc.activeElement;
        var overflow = doc.documentElement.style.overflow;
        var el = doc.createElement("div");
        el.className = "ta-picture";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-label", "Picture viewer");
        el.tabIndex = -1;
        var button = function (act, title, inner) {
            return '<button type="button" class="btn btn-default btn-sm" data-act="' + act + '" title="' + title + '" aria-label="' + title + '">' + inner + "</button>";
        };
        el.innerHTML = '<div class="ta-picture-bar theme-secondary">' +
            '<span class="ta-picture-nav">' + button("prev", "Previous picture (←)", '<i class="fa fa-chevron-left"></i>') +
            '<span class="ta-picture-count"></span>' + button("next", "Next picture (→)", '<i class="fa fa-chevron-right"></i>') + "</span>" +
            '<strong class="ta-picture-name"></strong>' +
            '<span class="ta-picture-tools">' + button("zoom-out", "Zoom out (−)", '<i class="fa fa-search-minus"></i>') +
            '<span class="ta-picture-zoom"></span>' + button("zoom-in", "Zoom in (+)", '<i class="fa fa-search-plus"></i>') +
            button("fit", "Fit to the window (0)", "Fit") + button("actual", "Actual size, 100% (1)", "1:1") +
            '<a class="btn btn-default btn-sm ta-picture-download" title="Download the file as uploaded" aria-label="Download"><i class="fa fa-download"></i></a>' +
            button("close", "Close (Esc)", "&times;") + "</span></div>" +
            '<div class="ta-picture-stage"><div class="ta-picture-msg"></div></div>';
        doc.body.appendChild(el);      // not in the page's own layer, which WebODM's menus are above
        doc.documentElement.style.overflow = "hidden";
        var stage = el.querySelector(".ta-picture-stage"), msg = el.querySelector(".ta-picture-msg");
        var img = null, pic = null, view = null, fitted = true, drag = null;

        function box() { return {w: stage.clientWidth || 1, h: stage.clientHeight || 1}; }

        function draw() {
            var zoomable = !!pic;
            [].forEach.call(el.querySelectorAll('[data-act="zoom-out"], [data-act="zoom-in"], [data-act="fit"], [data-act="actual"]'), function (b) { b.disabled = !zoomable; });
            el.querySelector(".ta-picture-zoom").textContent = zoomable ? Math.round(view.scale * 100) + "%" : "";
            if (!zoomable) return;
            img.style.transform = "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
            img.classList.toggle("ta-picture-pixels", view.scale > 1);
        }

        function fit() {
            view = fitView(pic, box());
            fitted = true;
            draw();
        }

        // Zoomed around a point of the stage (its centre when none is given)
        function zoom(factor, px, py) {
            if (!pic) return;
            var b = box();
            view = zoomAt(view, factor, px === undefined ? b.w / 2 : px, py === undefined ? b.h / 2 : py, zoomLimits(pic, b));
            fitted = false;
            draw();
        }

        function show(i) {
            index = i;
            var item = items[i];
            if (img && img.parentNode) img.parentNode.removeChild(img);
            pic = null;
            img = doc.createElement("img");
            img.className = "ta-picture-img";
            img.alt = item.name;
            img.draggable = false;
            img.hidden = true;
            msg.textContent = "Loading…";
            msg.hidden = false;
            var shown = img;
            img.onload = function () {
                if (shown !== img) return;
                pic = {w: img.naturalWidth || 1, h: img.naturalHeight || 1};
                img.style.width = pic.w + "px";
                img.style.height = pic.h + "px";
                img.hidden = false;
                msg.hidden = true;
                fit();
            };
            img.onerror = function () {
                if (shown === img) msg.textContent = "Could not load the picture.";
            };
            stage.insertBefore(img, msg);
            img.src = item.src;
            el.querySelector(".ta-picture-count").textContent = (i + 1) + " of " + items.length;
            var name = el.querySelector(".ta-picture-name");
            name.textContent = item.name;
            name.title = item.path || item.name;
            el.querySelector('[data-act="prev"]').disabled = i === 0;
            el.querySelector('[data-act="next"]').disabled = i === items.length - 1;
            el.querySelector(".ta-picture-download").href = item.download;
            draw();
            if (opts.onShow) opts.onShow(i);
        }

        function step(d) {
            if (index + d >= 0 && index + d < items.length) show(index + d);
        }

        function close() {
            doc.removeEventListener("keydown", onKey, true);
            if (root.removeEventListener) root.removeEventListener("resize", onResize);
            if (el.parentNode) el.parentNode.removeChild(el);
            doc.documentElement.style.overflow = overflow;
            if (before && before.focus) before.focus();
        }

        // The viewer's keys, before the page's (its Escape unselects the file)
        function onKey(e) {
            var keys = {Escape: close, ArrowLeft: function () { step(-1); }, ArrowRight: function () { step(1); },
                        "+": function () { zoom(ZOOM_STEP); }, "=": function () { zoom(ZOOM_STEP); }, "-": function () { zoom(1 / ZOOM_STEP); },
                        "0": function () { if (pic) fit(); }, "1": function () { zoom(pic ? 1 / view.scale : 1); }};
            if (!keys[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            keys[e.key]();
        }

        function onResize() {
            if (pic && fitted) fit();
        }

        el.addEventListener("click", function (e) {
            var b = e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!b) return;
            ({prev: function () { step(-1); }, next: function () { step(1); }, "zoom-out": function () { zoom(1 / ZOOM_STEP); },
              "zoom-in": function () { zoom(ZOOM_STEP); }, fit: fit, actual: function () { zoom(1 / view.scale); }, close: close})[b.getAttribute("data-act")]();
        });

        stage.addEventListener("wheel", function (e) {
            e.preventDefault();
            var r = stage.getBoundingClientRect();
            zoom(wheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top);
        }, {passive: false});

        // Dragging pans; a click beside the picture closes the viewer
        stage.addEventListener("pointerdown", function (e) {
            if (e.button !== 0) return;
            drag = {id: e.pointerId, x: e.clientX, y: e.clientY, view: view, moved: false, onPicture: e.target === img};
            if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener("pointermove", function (e) {
            if (!drag || drag.id !== e.pointerId) return;
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
            drag.moved = true;
            stage.classList.add("ta-picture-dragging");
            if (!pic) return;
            view = {scale: drag.view.scale, x: drag.view.x + dx, y: drag.view.y + dy};
            fitted = false;
            draw();
        });
        var endDrag = function (e) {
            if (!drag || drag.id !== e.pointerId) return;
            var clicked = !drag.moved && !drag.onPicture && e.type === "pointerup";
            drag = null;
            stage.classList.remove("ta-picture-dragging");
            if (clicked) close();
        };
        stage.addEventListener("pointerup", endDrag);
        stage.addEventListener("pointercancel", endDrag);

        // A double click on the picture zooms in where it points (to 100% at least), or back to the fit
        stage.addEventListener("dblclick", function (e) {
            if (!pic || e.target !== img) return;
            if (!fitted) return fit();
            var r = stage.getBoundingClientRect();
            zoom(Math.max(1, view.scale * 2) / view.scale, e.clientX - r.left, e.clientY - r.top);
        });

        doc.addEventListener("keydown", onKey, true);
        if (root.addEventListener) root.addEventListener("resize", onResize);
        el.focus();
        show(index);
        return {close: close};
    }

    var api = {fitView: fitView, zoomLimits: zoomLimits, zoomAt: zoomAt, wheelFactor: wheelFactor, open: open};
    root.ThermalPictureViewer = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
