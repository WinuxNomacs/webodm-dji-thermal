// Drawing the Thermal Inspector's regions (regions.js), on Leaflet 1.3.1 as WebODM's map has it
const L = require("leaflet");
const regions = require("../regions.js");

const p = (lng, lat) => ({lng, lat});

// jsdom can't tell Leaflet SVG is there: the map gets an SVG renderer
function makeMap() {
    const div = document.createElement("div");
    document.body.appendChild(div);
    return L.map(div, {zoomControl: false, renderer: new L.SVG()}).setView([42, -88], 16);
}

// A point on the map's container (jsdom has no layout)
const at = (map, x, y) => map.containerPointToLatLng(L.point(x, y));
const mouseup = (x, y) => document.dispatchEvent(new MouseEvent("mouseup", {clientX: x, clientY: y}));
const key = k => document.dispatchEvent(new KeyboardEvent("keydown", {key: k}));
const shapes = map => Object.values(map._layers).filter(l => !(l instanceof L.Renderer)).length;

let map, tool, calls;
function draw(shape) {
    calls = {finish: [], cancel: 0, invalid: []};
    tool = new regions.DrawTool(L, map, {shape, onFinish: r => calls.finish.push(r), onCancel: () => calls.cancel++,
                                         onInvalid: reason => calls.invalid.push(reason)});
    tool.start();
}

beforeEach(() => { map = makeMap(); });
afterEach(() => { if (tool) tool.stop(); map.remove(); tool = null; document.body.innerHTML = ""; });

describe("a region's outline", () => {
    it("is a closed ring of lon/lat, a rectangle whatever its corners' order", () => {
        const ring = [[1, 4], [3, 4], [3, 2], [1, 2], [1, 4]];
        expect(regions.rectangleRing(p(1, 2), p(3, 4))).toEqual(ring);
        expect(regions.rectangleRing(p(3, 2), p(1, 4))).toEqual(ring);
        expect(regions.ringToGeometry(ring)).toEqual({type: "Polygon", coordinates: [ring]});
    });

    it("is a circle's shape on the ground", () => {
        const center = {lat: 42, lng: -88};
        const ring = regions.circleRing(center, 50, 16);
        expect(ring.length).toBe(17);
        ring.slice(0, -1).forEach(c => expect(L.latLng(c[1], c[0]).distanceTo(center)).toBeCloseTo(50, 3));
    });

    it("is a polygon with three corners, some area and no crossing edges", () => {
        expect(regions.validatePolygon([p(0, 0), p(2, 0), p(2, 2), p(1, 1), p(0, 2)])).toEqual({valid: true});
        expect(regions.validatePolygon([p(0, 0), p(1, 1), p(1, 1)]).reason).toBe("too_few_points");
        expect(regions.validatePolygon([p(0, 0), p(1, 1), p(2, 2)]).reason).toBe("no_area");
        expect(regions.validatePolygon([p(0, 0), p(2, 2), p(2, 0), p(0, 2)]).reason).toBe("self_intersecting");
        expect(regions.validatePolygon([p(0, 0), p(4, 0), p(4, 4), p(2, 0), p(0, 4)]).valid).toBe(false);
    });
});

describe("drawing a region", () => {
    it("drags a rectangle, hands it over and gives the map back", () => {
        draw("rectangle");
        expect(map.dragging.enabled()).toBe(false);
        expect(map.getContainer().style.cursor).toBe("crosshair");
        const a = at(map, 10, 10), b = at(map, 60, 50);
        map.fire("mousedown", {latlng: a, originalEvent: {button: 0}});
        map.fire("mousemove", {latlng: b});
        mouseup(60, 50);
        expect(calls.finish.length).toBe(1);
        const {geometry, layer} = calls.finish[0];
        const lngs = geometry.coordinates[0].map(c => c[0]);
        expect(Math.min(...lngs)).toBeCloseTo(a.lng, 8);
        expect(Math.max(...lngs)).toBeCloseTo(b.lng, 8);
        expect(map.hasLayer(layer)).toBe(true);
        expect(tool.isActive()).toBe(false);
        expect(map.dragging.enabled()).toBe(true);
        expect(map.getContainer().style.cursor).toBe("");
    });

    it("takes a click for a stray one, not a rectangle", () => {
        draw("rectangle");
        const before = shapes(map);
        map.fire("mousedown", {latlng: at(map, 10, 10), originalEvent: {button: 0}});
        mouseup(11, 11);
        expect(calls.finish).toEqual([]);
        expect(shapes(map)).toBe(before);
        expect(tool.isActive()).toBe(true);
    });

    it("grows a circle from its centre", () => {
        draw("circle");
        const c = at(map, 50, 50);
        map.fire("mousedown", {latlng: c, originalEvent: {button: 0}});
        mouseup(90, 50);
        const {circle, geometry} = calls.finish[0];
        expect(circle.lat).toBeCloseTo(c.lat, 10);
        expect(circle.radius).toBeCloseTo(map.distance(c, at(map, 90, 50)), 6);
        expect(geometry.coordinates[0].length).toBe(65);
    });

    it("clicks a polygon's corners, finishing on the first one or with Enter", () => {
        draw("polygon");
        [[10, 10], [80, 10], [80, 80]].forEach(([x, y]) => map.fire("click", {latlng: at(map, x, y)}));
        map.fire("click", {latlng: at(map, 12, 11)});
        expect(calls.finish.length).toBe(1);
        expect(calls.finish[0].geometry.coordinates[0].length).toBe(4);

        draw("polygon");
        [[10, 10], [80, 10], [80, 80], [10, 80]].forEach(([x, y]) => map.fire("click", {latlng: at(map, x, y)}));
        key("Backspace");
        key("Enter");
        expect(calls.finish[0].geometry.coordinates[0].length).toBe(4);
    });

    it("says why a polygon is not one, and Esc cancels", () => {
        draw("polygon");
        map.fire("click", {latlng: at(map, 10, 10)});
        map.fire("dblclick", {latlng: at(map, 10, 10)});
        expect(calls.invalid).toEqual(["too_few_points"]);
        expect(tool.isActive()).toBe(true);
        key("Escape");
        expect(calls.cancel).toBe(1);
        expect(tool.isActive()).toBe(false);
        expect(shapes(map)).toBe(0);
    });
});
