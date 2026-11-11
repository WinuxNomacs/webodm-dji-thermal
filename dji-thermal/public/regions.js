// Drawing the Thermal Inspector's regions on WebODM's map (inspector.js): a rectangle or a circle (press, drag,
// release: the circle grows from its centre), a polygon (click the corners; double-click, Enter or a click on the
// first corner finishes; Backspace removes the last corner; Esc cancels), a line (as a polygon, without closing it)
// or a ΔT (two clicks: the first spot, then the second, which finishes it), as GeoJSON polygons or lines in lon/lat. While it draws, it takes over the map's panning and double-click zoom.
// WebODM's 2D map has no drawing tool a plugin can use.
(function (root) {
    var STYLE = {color: "#ff9800", weight: 2, opacity: 0.95, fillColor: "#ff9800", fillOpacity: 0.12};
    var GUIDE_STYLE = {color: "#ff9800", weight: 2, opacity: 0.9, dashArray: "4 4", interactive: false};
    var MIN_DRAG_PX = 4;            // a shorter drag is a stray click
    var CLOSE_DISTANCE_PX = 10;     // a click this near the first corner closes a polygon
    var EARTH_RADIUS = 6371000;     // Leaflet's: a ring made here matches the circle it draws
    var CIRCLE_SEGMENTS = 64;
    // The measuring tools, as the Thermal Inspector (inspector.js) and the frame page (frame.js) show them: {icon,
    // name}. Each page lists them in its own order; a shape the server saves is in measurements.SHAPES too.
    var TOOLS = {pin: {icon: "fa fa-map-pin", name: "Pin"}, line: {icon: "fa fa-route", name: "Line"},
                 rectangle: {icon: "far fa-square", name: "Rectangle"}, circle: {icon: "far fa-circle", name: "Circle"},
                 polygon: {icon: "fa fa-draw-polygon", name: "Polygon"},
                 // Two spots, each a pixel, and their difference: the second's temperature less the first's
                 delta: {icon: "fa fa-arrows-alt-h", name: "ΔT"}};

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i] || {};
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
    }

    // Points are Leaflet's {lat, lng}; rings GeoJSON's [[lng, lat], ...], closed (the first point repeated last)
    function closeRing(points) {
        var ring = points.map(function (p) { return [p.lng, p.lat]; });
        ring.push(ring[0].slice());
        return ring;
    }

    function rectangleRing(a, b) {
        var w = Math.min(a.lng, b.lng), e = Math.max(a.lng, b.lng), s = Math.min(a.lat, b.lat), n = Math.max(a.lat, b.lat);
        return closeRing([{lat: n, lng: w}, {lat: n, lng: e}, {lat: s, lng: e}, {lat: s, lng: w}]);
    }

    function polygonRing(points) { return closeRing(points); }

    // A circle of radius metres around a point, its shape on the ground whatever the latitude
    function circleRing(center, radius, segments) {
        segments = segments || CIRCLE_SEGMENTS;
        var rad = Math.PI / 180, lat1 = center.lat * rad, lng1 = center.lng * rad, d = radius / EARTH_RADIUS;
        var points = [];
        for (var i = 0; i < segments; i++) {
            var bearing = 2 * Math.PI * i / segments;
            var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
            var lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
            points.push({lat: lat2 / rad, lng: ((lng2 / rad + 540) % 360) - 180});
        }
        return closeRing(points);
    }

    function ringToGeometry(ring) { return {type: "Polygon", coordinates: [ring]}; }

    // A drawn line is usable with two distinct points: its GeoJSON, or null
    function lineGeometry(points) {
        var line = points.filter(function (p, i) { return i === 0 || !sameLatLng(p, points[i - 1]); });
        return line.length >= 2 ? {type: "LineString", coordinates: line.map(function (p) { return [p.lng, p.lat]; })} : null;
    }

    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    function onSegment(p, q, r) {
        return Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
    }
    function segmentsIntersect(p1, p2, p3, p4) {
        var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        return (d1 === 0 && onSegment(p3, p1, p4)) || (d2 === 0 && onSegment(p3, p2, p4)) ||
               (d3 === 0 && onSegment(p1, p3, p2)) || (d4 === 0 && onSegment(p1, p4, p2));
    }
    function signedArea(pts) {
        var s = 0;
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i], b = pts[(i + 1) % pts.length];
            s += a[0] * b[1] - b[0] * a[1];
        }
        return s / 2;
    }

    // A drawn polygon is usable with three distinct corners, some area and no edge crossing another: {valid, reason}
    function validatePolygon(points) {
        var seen = {};
        var pts = points.filter(function (p) {
            var k = p.lat + "," + p.lng;
            if (seen[k]) return false;
            seen[k] = true;
            return true;
        }).map(function (p) { return [p.lng, p.lat]; });
        if (pts.length < 3) return {valid: false, reason: "too_few_points"};
        // Crossings first: a symmetric bow tie's lobes cancel out to no area
        var n = pts.length;
        for (var i = 0; i < n; i++) {
            for (var j = i + 1; j < n; j++) {
                if (j === i + 1 || (i === 0 && j === n - 1)) continue;      // neighbouring edges share a corner
                if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return {valid: false, reason: "self_intersecting"};
            }
        }
        if (signedArea(pts) === 0) return {valid: false, reason: "no_area"};
        return {valid: true};
    }

    function sameLatLng(a, b) { return a.lat === b.lat && a.lng === b.lng; }

    // A shape being drawn: opts {shape: "rectangle" | "circle" | "polygon" | "line" | "delta", onFinish({geometry, layer, circle}),
    // onCancel(), onInvalid(reason)}. The finished layer is the caller's; circle is {lat, lng, radius} for circles.
    function DrawTool(L, map, opts) {
        var self = this;
        var doc = opts.doc || root.document;
        var active = false, guides = [], vertices = [], polyGuides = [], origin = null, drawn = null, saved = {};
        var clicked = opts.shape === "polygon" || opts.shape === "line" || opts.shape === "delta";     // drawn a click per point
        var two = opts.shape === "delta";       // finished by its second point, not a double-click or Enter

        function addGuide(layer) { layer.addTo(map); guides.push(layer); return layer; }
        function dropGuide(layer) {
            map.removeLayer(layer);
            guides = guides.filter(function (g) { return g !== layer; });
        }
        function primary(e) { return !(e.originalEvent && e.originalEvent.button !== undefined && e.originalEvent.button !== 0); }
        // The release may be outside the map: read it from the DOM event
        function releasedAt(e) { return e && e.clientX !== undefined ? map.mouseEventToLatLng(e) : origin; }

        function finish(layer, geometry, extra) {
            guides = guides.filter(function (g) { return g !== layer; });
            self.stop();
            opts.onFinish(assign({geometry: geometry, layer: layer}, extra));
        }

        function onKey(e) {
            if (e.key === "Escape") self.cancel();
            else if (clicked && !two && e.key === "Enter") onPolyFinish();
            else if (clicked && e.key === "Backspace") {
                e.preventDefault();
                vertices.pop();
                redrawPolygon();
            }
        }

        // A rectangle or a circle: press, drag, release
        function onDown(e) {
            if (!primary(e)) return;
            origin = e.latlng;
            drawn = addGuide(opts.shape === "circle" ?
                L.circle(e.latlng, assign({interactive: false, radius: 0.001}, STYLE)) :
                L.rectangle([e.latlng, e.latlng], assign({interactive: false}, STYLE)));
            map.on("mousemove", onDrag);
            doc.addEventListener("mouseup", onUp);
        }
        function onDrag(e) {
            if (!drawn) return;
            if (opts.shape === "circle") drawn.setRadius(Math.max(0.001, map.distance(origin, e.latlng)));
            else drawn.setBounds(L.latLngBounds(origin, e.latlng));
        }
        function onUp(e) {
            doc.removeEventListener("mouseup", onUp);
            map.off("mousemove", onDrag);
            if (!drawn) return;
            var end = releasedAt(e);
            var a = map.latLngToContainerPoint(origin), b = map.latLngToContainerPoint(end);
            var layer = drawn;
            drawn = null;
            if (opts.shape === "circle") {
                var radius = map.distance(origin, end);
                if (a.distanceTo(b) < MIN_DRAG_PX || !(radius > 0)) return dropGuide(layer);
                layer.setRadius(radius);
                return finish(layer, ringToGeometry(circleRing(origin, radius)), {circle: {lat: origin.lat, lng: origin.lng, radius: radius}});
            }
            if (Math.abs(a.x - b.x) < MIN_DRAG_PX || Math.abs(a.y - b.y) < MIN_DRAG_PX) return dropGuide(layer);
            layer.setBounds(L.latLngBounds(origin, end));
            finish(layer, ringToGeometry(rectangleRing(origin, end)));
        }

        // A polygon or a line: a click per point
        function onPolyClick(e) {
            var last = vertices[vertices.length - 1];
            if (last && sameLatLng(last, e.latlng)) return;     // a double-click's second click
            if (opts.shape === "polygon" && vertices.length >= 3 && map.latLngToContainerPoint(vertices[0]).distanceTo(map.latLngToContainerPoint(e.latlng)) <= CLOSE_DISTANCE_PX) {
                return onPolyFinish();
            }
            vertices.push(e.latlng);
            if (two && vertices.length === 2) return onPolyFinish();
            redrawPolygon();
        }
        function onPolyMove(e) { if (vertices.length) redrawPolygon(e.latlng); }
        function redrawPolygon(cursor) {
            polyGuides.forEach(dropGuide);
            polyGuides = [];
            if (!vertices.length) return;
            polyGuides.push(addGuide(L.polyline(vertices.concat(cursor ? [cursor] : []), GUIDE_STYLE)));
            vertices.forEach(function (v) {
                polyGuides.push(addGuide(L.circleMarker(v, {radius: 4, interactive: false, color: STYLE.color, weight: 2, fillColor: "#fff", fillOpacity: 1})));
            });
        }
        function onPolyFinish() {
            // A double-click ends with the same point twice
            var points = vertices.filter(function (p, i) { return i === 0 || !sameLatLng(p, vertices[i - 1]); });
            if (opts.shape === "line" || two) {
                var line = lineGeometry(points);
                if (!line) return (opts.onInvalid || function () {})("line_too_short");
                return finish(addGuide(L.polyline(points, assign({interactive: false}, STYLE))), line);
            }
            var check = validatePolygon(points);
            if (!check.valid) return (opts.onInvalid || function () {})(check.reason);
            finish(addGuide(L.polygon(points, assign({interactive: false}, STYLE))), ringToGeometry(polygonRing(points)));
        }

        this.start = function () {
            if (active) return;
            active = true;
            saved = {dragging: map.dragging.enabled(), zoom: map.doubleClickZoom.enabled(), cursor: map.getContainer().style.cursor};
            map.dragging.disable();
            map.doubleClickZoom.disable();
            map.getContainer().style.cursor = "crosshair";
            if (clicked) {
                map.on("click", onPolyClick);
                if (!two) map.on("dblclick", onPolyFinish);
                map.on("mousemove", onPolyMove);
            } else map.on("mousedown", onDown);
            doc.addEventListener("keydown", onKey);
        };

        // Stops drawing; a layer handed over by onFinish stays
        this.stop = function () {
            if (!active) return;
            active = false;
            map.off("mousedown", onDown);
            map.off("mousemove", onDrag);
            map.off("click", onPolyClick);
            map.off("dblclick", onPolyFinish);
            map.off("mousemove", onPolyMove);
            doc.removeEventListener("mouseup", onUp);
            doc.removeEventListener("keydown", onKey);
            if (saved.dragging) map.dragging.enable();
            if (saved.zoom) map.doubleClickZoom.enable();
            map.getContainer().style.cursor = saved.cursor || "";
            guides.forEach(function (g) { map.removeLayer(g); });
            guides = [];
            polyGuides = [];
            vertices = [];
            origin = null;
            drawn = null;
        };

        this.cancel = function () {
            var was = active;
            self.stop();
            if (was && opts.onCancel) opts.onCancel();
        };

        this.isActive = function () { return active; };
    }

    var api = {STYLE: STYLE, TOOLS: TOOLS, rectangleRing: rectangleRing, polygonRing: polygonRing, circleRing: circleRing,
               ringToGeometry: ringToGeometry, validatePolygon: validatePolygon, lineGeometry: lineGeometry, DrawTool: DrawTool};
    root.ThermalRegions = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : {});
