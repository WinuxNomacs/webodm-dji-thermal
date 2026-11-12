// A divider on a Leaflet map that shows layers on one side of it only, for comparing them with what lies beneath: a
// line and a round handle, dragged (mouse or touch), upright or across (a right-click on the handle, or turn()), each
// layer on the side it is given ("after": right of an upright divider, below one across; "before": left, or above).
// It clips each layer's container (its style.clip, in the map's layer pixels, as leaflet-side-by-side does), so the
// layers keep their own panes and order; it shows while it has layers, and takes its clips away when they leave.
//
// Shared: it needs only Leaflet (passed in) and split.css, and knows nothing of the plugin around it, so another
// WebODM plugin can take both files as they are. ES5, loaded as a script (window.SplitDivider) or required.
//
//   var split = SplitDivider.create(L, map, {vertical: true, at: 0.5});
//   split.add(layer, "after");             // or "before"; again to change its side (setSide does too)
//   split.on("change", function (e) {});   // e: {reason: "move" | "turn" | "side" | "layers", vertical, at}
//   split.turn(); split.setPosition(0.3); split.remove(layer); split.destroy();
//
// Options: vertical (true), at (0.5: the share of the map's width, or height, where it is), className (added to its
// element), title (the handle's), handleHtml(vertical) (the handle's content: by default Font Awesome 5's grip lines),
// turnOnRightClick (true), doc (the document).
(function (root) {
    var SIDES = {after: true, before: true};

    // The clip of a layer on one side: "rect(top, right, bottom, left)" in layer pixels. nw, se: the map's view corners
    // in layer pixels; px: the divider's distance from the view's left (upright) or top (across), in pixels
    function clip(nw, se, px, vertical, side) {
        var before = side === "before", x = nw.x + px, y = nw.y + px;
        var r = vertical ? (before ? [nw.y, x, se.y, nw.x] : [nw.y, se.x, se.y, x]) : (before ? [nw.y, se.x, y, nw.x] : [y, se.x, se.y, nw.x]);
        return "rect(" + r.join("px, ") + "px)";
    }

    // The side's name as a user reads it
    function sideName(side, vertical) {
        return vertical ? (side === "before" ? "Left" : "Right") : (side === "before" ? "Above" : "Below");
    }

    function defaultHandle(vertical) {
        return '<i class="fa ' + (vertical ? "fa-grip-lines-vertical" : "fa-grip-lines") + '"></i>';
    }

    function create(L, map, options) {
        var opts = options || {};
        var doc = opts.doc || root.document;
        var vertical = opts.vertical !== false, at = typeof opts.at === "number" ? opts.at : 0.5;
        var layers = [], listeners = {}, el = null, line = null, handle = null, dragging = null, destroyed = false;

        function fire(type, reason) {
            (listeners[type] || []).slice().forEach(function (f) { f({reason: reason, vertical: vertical, at: at}); });
        }
        function containerOf(layer) { return layer && layer.getContainer ? layer.getContainer() : null; }
        function find(layer) {
            for (var i = 0; i < layers.length; i++) if (layers[i].layer === layer) return layers[i];
            return null;
        }

        function update() {
            if (destroyed) return;
            if (!layers.length) return hide();
            if (!el) build();
            var size = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
            var px = (vertical ? size.x : size.y) * at;
            el.className = "split-divider " + (vertical ? "split-divider-vertical" : "split-divider-across") + (opts.className ? " " + opts.className : "");
            line.style.left = handle.style.left = vertical ? px + "px" : "";
            line.style.top = handle.style.top = vertical ? "" : px + "px";
            var content = (opts.handleHtml || defaultHandle)(vertical);
            if (handle.innerHTML !== content) handle.innerHTML = content;
            layers.forEach(function (l) {
                var c = containerOf(l.layer);
                if (c) c.style.clip = clip(nw, se, px, vertical, l.side);
            });
        }
        function hide() {
            if (!el) return;
            if (el.parentNode) el.parentNode.removeChild(el);
            el = line = handle = null;
        }
        function unclip(layer) {
            var c = containerOf(layer);
            if (c) c.style.clip = "";
        }

        function build() {
            el = L.DomUtil.create("div", "split-divider", map.getContainer());
            line = L.DomUtil.create("div", "split-divider-line", el);
            handle = L.DomUtil.create("div", "split-divider-handle", el);
            handle.title = opts.title || "Drag to move the divider; right-click to turn it horizontal or vertical";
            handle.addEventListener("mousedown", startDrag);
            handle.addEventListener("touchstart", startDrag, {passive: false});
            handle.addEventListener("contextmenu", function (e) {
                if (opts.turnOnRightClick === false) return;
                e.preventDefault();
                e.stopPropagation();
                api.turn();
            });
            // Not the map's clicks
            ["click", "dblclick", "mousedown", "touchstart", "wheel"].forEach(function (type) {
                handle.addEventListener(type, function (e) { e.stopPropagation(); });
            });
        }

        function moveTo(e) {
            var p = e.touches ? e.touches[0] : e, box = map.getContainer().getBoundingClientRect();
            var share = vertical ? (p.clientX - box.left) / (box.width || 1) : (p.clientY - box.top) / (box.height || 1);
            at = Math.min(1, Math.max(0, share));
            update();
            if (e.cancelable) e.preventDefault();
            fire("change", "move");
        }
        function endDrag(e) {
            doc.removeEventListener("mousemove", moveTo);
            doc.removeEventListener("mouseup", endDrag);
            doc.removeEventListener("touchmove", moveTo);
            doc.removeEventListener("touchend", endDrag);
            if (dragging && dragging.pan && map.dragging) map.dragging.enable();
            if (dragging && e && e.type === "mouseup") swallowClick();
            dragging = null;
        }
        // The click a browser sends after a mouse button let go off the handle (to the element holding both the handle
        // and where it was let go: the map) isn't the map's: a drag of the divider never clicks what lies under it.
        // The click comes in the same task as the mouseup, so the listener goes after it either way
        function swallowClick() {
            var win = doc.defaultView || root;
            function stop(e) {
                e.stopPropagation();
                e.preventDefault();
                off();
            }
            function off() { win.removeEventListener("click", stop, true); }
            win.addEventListener("click", stop, true);
            setTimeout(off, 0);
        }
        function startDrag(e) {
            if (e.button !== undefined && e.button !== 0) return;
            // The map isn't panned meanwhile
            dragging = {pan: !!(map.dragging && map.dragging.enabled && map.dragging.enabled())};
            if (dragging.pan) map.dragging.disable();
            if (e.cancelable) e.preventDefault();
            doc.addEventListener(e.touches ? "touchmove" : "mousemove", moveTo, {passive: false});
            doc.addEventListener(e.touches ? "touchend" : "mouseup", endDrag);
        }

        // Its place on the view kept as the map moves, and a layer of its put back on the map (a new container) clipped
        var MAP_EVENTS = "move zoomend viewreset resize layeradd";
        map.on(MAP_EVENTS, update);

        var api = {
            // A layer shown on a side of it ("after" by default); again with another side, moved there
            add: function (layer, side) {
                if (destroyed) return api;
                var l = find(layer), s = SIDES[side] ? side : "after";
                if (l) l.side = s;
                else layers.push({layer: layer, side: s});
                update();
                fire("change", l ? "side" : "layers");
                return api;
            },
            remove: function (layer) {
                var l = find(layer);
                if (!l) return api;
                layers.splice(layers.indexOf(l), 1);
                unclip(layer);
                update();
                fire("change", "layers");
                return api;
            },
            has: function (layer) { return !!find(layer); },
            sideOf: function (layer) { var l = find(layer); return l ? l.side : null; },
            setSide: function (layer, side) { return find(layer) ? api.add(layer, side) : api; },
            layers: function () { return layers.map(function (l) { return {layer: l.layer, side: l.side}; }); },
            isVertical: function () { return vertical; },
            setVertical: function (v) {
                if (!!v === vertical) return api;
                vertical = !!v;
                update();
                fire("change", "turn");
                return api;
            },
            turn: function () { return api.setVertical(!vertical); },
            position: function () { return at; },
            setPosition: function (share) {
                at = Math.min(1, Math.max(0, Number(share) || 0));
                update();
                fire("change", "move");
                return api;
            },
            element: function () { return el; },
            update: update,
            on: function (type, f) { (listeners[type] = listeners[type] || []).push(f); return api; },
            off: function (type, f) { listeners[type] = (listeners[type] || []).filter(function (g) { return g !== f; }); return api; },
            // Gone from the map, its layers unclipped
            destroy: function () {
                endDrag();
                layers.forEach(function (l) { unclip(l.layer); });
                layers = [];
                hide();
                if (map.off) map.off(MAP_EVENTS, update);
                destroyed = true;
            }
        };
        return api;
    }

    var exported = {create: create, clip: clip, sideName: sideName};
    root.SplitDivider = exported;
    if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof window !== "undefined" ? window : {});
