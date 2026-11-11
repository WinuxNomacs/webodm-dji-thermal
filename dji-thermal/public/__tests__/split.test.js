// The divider that shows layers on one side of it (split.js), on a real Leaflet map in jsdom
const L = require("leaflet");
const SplitDivider = require("../split.js");

function leafletMap() {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const map = L.map(div, {zoomControl: false}).setView([0.5, 0.5], 18);
    map.getSize = () => L.point(1000, 800);
    div.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 800});
    map.setView([0.5, 0.5], 18, {animate: false});
    return map;
}
const layer = map => L.gridLayer().addTo(map);

afterEach(() => { document.body.innerHTML = ""; });

describe("the split divider", () => {
    it("clips a layer to its side of an upright or a crossing divider", () => {
        const nw = {x: 10, y: 20}, se = {x: 1010, y: 820};
        expect(SplitDivider.clip(nw, se, 300, true, "after")).toBe("rect(20px, 1010px, 820px, 310px)");
        expect(SplitDivider.clip(nw, se, 300, true, "before")).toBe("rect(20px, 310px, 820px, 10px)");
        expect(SplitDivider.clip(nw, se, 300, false, "after")).toBe("rect(320px, 1010px, 820px, 10px)");
        expect(SplitDivider.clip(nw, se, 300, false, "before")).toBe("rect(20px, 1010px, 320px, 10px)");
        expect([true, false].map(v => ["after", "before"].map(s => SplitDivider.sideName(s, v)))).toEqual([["Right", "Left"], ["Below", "Above"]]);
    });

    it("shows while it has layers, each on the side given, and unclips a layer that leaves", () => {
        const map = leafletMap(), a = layer(map), b = layer(map);
        const split = SplitDivider.create(L, map), changes = [];
        split.on("change", e => changes.push([e.reason, e.vertical, e.at]));
        expect(split.element()).toBe(null);
        split.add(a);
        split.add(b, "before");
        const nw = map.containerPointToLayerPoint([0, 0]);
        expect(a.getContainer().style.clip).toBe(`rect(${nw.y}px, ${nw.x + 1000}px, ${nw.y + 800}px, ${nw.x + 500}px)`);
        expect(b.getContainer().style.clip).toBe(`rect(${nw.y}px, ${nw.x + 500}px, ${nw.y + 800}px, ${nw.x}px)`);
        expect(split.element().className).toBe("split-divider split-divider-vertical");
        expect(split.layers().map(l => l.side)).toEqual(["after", "before"]);
        // Moved, turned, a layer's side changed
        split.setPosition(0.25);
        split.turn();
        split.setSide(b, "after");
        expect(b.getContainer().style.clip).toBe(`rect(${nw.y + 200}px, ${nw.x + 1000}px, ${nw.y + 800}px, ${nw.x}px)`);
        expect(split.element().className).toBe("split-divider split-divider-across");
        expect(changes).toEqual([["layers", true, 0.5], ["layers", true, 0.5], ["move", true, 0.25], ["turn", false, 0.25], ["side", false, 0.25]]);
        // Gone with its last layer, its clips taken away
        split.remove(a);
        expect(a.getContainer().style.clip).toBe("");
        split.remove(b);
        expect(split.element()).toBe(null);
        expect(map.getContainer().querySelector(".split-divider")).toBe(null);
        map.remove();
    });

    it("is dragged by its handle without panning the map, turned by a right-click, and follows the map as it moves", () => {
        const map = leafletMap(), a = layer(map);
        const split = SplitDivider.create(L, map).add(a);
        const handle = split.element().querySelector(".split-divider-handle");
        handle.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0}));
        expect(map.dragging.enabled()).toBe(false);
        document.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, cancelable: true, clientX: 700, clientY: 100}));
        document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
        expect(map.dragging.enabled()).toBe(true);
        expect(split.position()).toBe(0.7);
        expect(handle.style.left).toBe("700px");
        // Past the map's edge: at its edge
        handle.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0}));
        document.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, cancelable: true, clientX: 1500, clientY: 100}));
        document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
        expect(split.position()).toBe(1);
        split.setPosition(0.7);
        // A right-click turns it, not the browser's menu
        const menu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        handle.dispatchEvent(menu);
        expect(menu.defaultPrevented).toBe(true);
        expect(split.isVertical()).toBe(false);
        expect(handle.style.top).toBe("560px");
        expect(handle.innerHTML).toBe('<i class="fa fa-grip-lines"></i>');
        // The map panned: the clip keeps the divider where it is on the view
        map.panBy([0, 50], {animate: false});
        const nw = map.containerPointToLayerPoint([0, 0]);
        expect(a.getContainer().style.clip).toBe(`rect(${nw.y + 560}px, ${nw.x + 1000}px, ${nw.y + 800}px, ${nw.x}px)`);
        map.remove();
    });

    it("clips a layer of its put back on the map, whose container is a new one", () => {
        const map = leafletMap(), a = layer(map);
        SplitDivider.create(L, map).add(a);
        map.removeLayer(a);
        map.addLayer(a);
        const nw = map.containerPointToLayerPoint([0, 0]);
        expect(a.getContainer().style.clip).toBe(`rect(${nw.y}px, ${nw.x + 1000}px, ${nw.y + 800}px, ${nw.x + 500}px)`);
        map.remove();
    });

    it("takes a class, a handle and a title of its own, can leave right-clicks alone, and goes when destroyed", () => {
        const map = leafletMap(), a = layer(map);
        const split = SplitDivider.create(L, map, {vertical: false, at: 0.4, className: "my-plugin-split", title: "Compare",
                                                   handleHtml: v => (v ? "|" : "—"), turnOnRightClick: false}).add(a, "before");
        const handle = split.element().querySelector(".split-divider-handle");
        expect(split.element().className).toBe("split-divider split-divider-across my-plugin-split");
        expect([handle.title, handle.innerHTML, handle.style.top]).toEqual(["Compare", "—", "320px"]);
        const menu = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
        handle.dispatchEvent(menu);
        expect([menu.defaultPrevented, split.isVertical()]).toEqual([false, false]);
        split.destroy();
        expect(a.getContainer().style.clip).toBe("");
        expect(map.getContainer().querySelector(".split-divider")).toBe(null);
        split.add(a);       // nothing once destroyed
        expect(map.getContainer().querySelector(".split-divider")).toBe(null);
        map.remove();
    });
});
