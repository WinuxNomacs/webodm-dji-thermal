// The photos that saw a spot of the 3D model (frames3d.js): which the model hides it from, what they read there, and
// the window showing them one at a time
const Recolour = require("../recolour.js");
global.window.ThermalRecolour = Recolour;
global.window.ThermalFrames = require("../frames.js");
const MeshIndex = require("../mesh_index.js");
const Frames3D = require("../frames3d.js");

function attribute(array, size) {
    return {array, count: array.length / size, getX: (i) => array[i * size], getY: (i) => array[i * size + 1], getZ: (i) => array[i * size + 2]};
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mesh(positions) {
    const n = positions.length / 3;
    return {isMesh: true, material: {__dtMaterial: 0}, matrixWorld: {elements: IDENTITY},
            geometry: {attributes: {position: attribute(Float32Array.from(positions), 3), uv: attribute(new Float32Array(n * 2), 2)}, index: null, groups: []}};
}
// The ground (z = 0) from -20 to 20, and a wall at x = 5 from y -20 to 20, 10 m high
const GROUND = [-20, -20, 0, 20, -20, 0, 20, 20, 0, -20, -20, 0, 20, 20, 0, -20, 20, 0];
const WALL = [5, -20, 0, 5, 20, 0, 5, 20, 10, 5, -20, 0, 5, 20, 10, 5, -20, 10];
function scene() { return MeshIndex.build([mesh(GROUND), mesh(WALL)]); }

const frame = (file, camera, temperature, extra) => Object.assign({index: file.length, file, x: 19.5, y: 14.5, width: 40, height: 30, camera,
    view_angle: 10, distance: 20, temperature, available: true, frame: null}, extra);

describe("the surface and the photos that see it", () => {
    test("a hit's normal is its triangle's, of unit length", () => {
        const index = scene();
        const down = MeshIndex.raycast(index, {x: 0, y: 0, z: 50}, {x: 0, y: 0, z: -1});
        const n = Frames3D.surfaceNormal(index, down);
        expect(Math.abs(n.z)).toBeCloseTo(1, 6);
        const side = MeshIndex.raycast(index, {x: 0, y: 0, z: 5}, {x: 1, y: 0, z: 0});
        expect(Math.abs(Frames3D.surfaceNormal(index, side).x)).toBeCloseTo(1, 6);
        expect(Frames3D.surfaceNormal(index, null)).toBeNull();
    });

    test("the model hides a point from a camera behind a wall, not from one on its side, whichever way the normal points", () => {
        const index = scene(), p = {x: 0, y: 0, z: 0}, up = {x: 0, y: 0, z: 1};
        expect(Frames3D.hidden(index, MeshIndex.raycast, p, up, [-10, 0, 30])).toBe(false);
        expect(Frames3D.hidden(index, MeshIndex.raycast, p, up, [20, 0, 2])).toBe(true);          // the wall between
        expect(Frames3D.hidden(index, MeshIndex.raycast, p, {x: 0, y: 0, z: -1}, [-10, 0, 30])).toBe(false);
        expect(Frames3D.hidden(index, MeshIndex.raycast, p, null, [-10, 0, 30])).toBe(false);
        // A point on the wall's east face, seen from the east
        expect(Frames3D.hidden(index, MeshIndex.raycast, {x: 5, y: 0, z: 5}, {x: -1, y: 0, z: 0}, [30, 0, 5])).toBe(false);
        expect(Frames3D.hidden(index, MeshIndex.raycast, {x: 5, y: 0, z: 5}, {x: 1, y: 0, z: 0}, [-30, 0, 5])).toBe(false);
    });

    test("keeps the server's order of the photos that see it, and counts those that don't", () => {
        const found = Frames3D.inView([frame("a", [-10, 0, 30], 20), frame("b", [20, 0, 2], 21), frame("cc", [0, 5, 40], 22)],
                                      scene(), MeshIndex.raycast, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 1});
        expect(found.seen.map((f) => f.file)).toEqual(["a", "cc"]);
        expect(found.hidden).toBe(1);
    });

    test("what the photos read there: how many, the lowest, highest and median, leaving out those without a temperature", () => {
        expect(Frames3D.spread([frame("a", [0, 0, 1], 21), frame("b", [0, 0, 1], 20), frame("c", [0, 0, 1], null), frame("d", [0, 0, 1], 24)]))
            .toEqual({count: 3, low: 20, high: 24, median: 21});
        expect(Frames3D.spread([frame("a", [0, 0, 1], 21), frame("b", [0, 0, 1], 20)]).median).toBe(20.5);
        expect(Frames3D.spread([frame("a", [0, 0, 1], null)])).toBeNull();
    });
});

describe("the window", () => {
    const format = (c) => c.toFixed(2) + " °C";
    const pick = (extra) => Object.assign({frames: [frame("P1.tiff", [0, 0, 30], 20.5), frame("P2.tiff", [5, 0, 30], 21.5)], hidden: 0, at: 0,
        workset: null, model: 20.25, normal: {x: 0, y: 0, z: 1}, spread: {count: 2, low: 20.5, high: 21.5, median: 21}}, extra);

    test("shows a photo with the spot marked, its temperature, the model's and what all the photos read", () => {
        const html = Frames3D.windowHtml(pick(), format);
        expect(html).toContain("Photo 1 of 2 that saw this spot");
        expect(html).toContain("P1.tiff");
        expect(html).toContain("This photo</td><td class=\"text-right\">20.50 °C");
        expect(html).toContain("The model</td><td class=\"text-right\">20.25 °C");
        expect(html).toContain("The 2 photos read 20.50 °C to 21.50 °C here (median 21.00 °C)");
        expect(html).toContain("10° from square on");
        expect(html).toContain('style="left: 50.00%; top: 50.00%;"');
        expect(html).not.toContain("Open this frame");
        expect(html).toMatch(/data-pip="prev"[^>]*disabled/);
    });

    test("says how many photos the model hides the spot from, and when none saw it", () => {
        expect(Frames3D.windowHtml(pick({hidden: 3}), format)).toContain("3 more photos had it in view, but the model hides it from them.");
        const none = Frames3D.windowHtml(pick({frames: [], hidden: 1}), format);
        expect(none).toContain("No photo saw this spot.");
        expect(none).toContain("1 more photo had it in view, but the model hides it from that one.");
    });

    test("links a photo to its frame's page in the Analyzer when the task came from a workset", () => {
        const html = Frames3D.windowHtml(pick({workset: {dataset: "d1", workset: "w1"}, frames: [frame("P1.tiff", [0, 0, 30], 20.5, {frame: "sub/P1_T.JPG"})]}), format);
        expect(html).toContain('href="/plugins/dji-thermal/dataset/d1/conversion/w1/frame?frame=sub%2FP1_T.JPG"');
    });

    test("says a photo that's gone isn't on the server", () => {
        const html = Frames3D.windowHtml(pick({frames: [frame("P1.tiff", [0, 0, 30], null, {available: false})]}), format);
        expect(html).toContain("This photo</td><td class=\"text-right\">Not on the server");
    });
});

describe("the window's behaviour", () => {
    function setup(response) {
        document.body.innerHTML = '<div id="box" hidden></div>';
        const box = document.getElementById("box"), changed = jest.fn(), urls = [];
        const fetchFn = jest.fn((url) => {
            urls.push(url);
            if (url.includes("/values")) return Promise.resolve({status: 404, ok: false});
            return Promise.resolve({ok: true, json: () => Promise.resolve(response)});
        });
        const frames = Frames3D.create(box, {fetchFn, task: {id: "t1", project: 3}, raycast: MeshIndex.raycast, index: () => scene(),
                                             style: () => null, corrected: (c) => c + 1, format: (c) => c.toFixed(1) + " °C", changed});
        return {box, frames, changed, urls};
    }

    test("asks for the photos at the spot with its normal, leaves out those hidden, steps through the rest and marks each one's camera", async () => {
        const s = setup({frames: [frame("a", [-10, 0, 30], 20), frame("b", [20, 0, 2], 21), frame("c", [0, 5, 40], 22)], workset: null});
        await s.frames.show({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 1}, 19);
        expect(s.urls[0]).toBe("/api/plugins/dji-thermal/projects/3/tasks/t1/inspector/model/frames?x=0&y=0&z=0&nx=0&ny=0&nz=1");
        expect(s.box.hidden).toBe(false);
        expect(s.box.textContent).toContain("Photo 1 of 2 that saw this spot");
        expect(s.box.textContent).toContain("21.0 °C");                // a's 20, corrected
        expect(s.box.textContent).toContain("The model20.0 °C");       // 19, corrected
        expect(s.box.textContent).toContain("1 more photo had it in view");
        expect(s.changed).toHaveBeenLastCalledWith(expect.objectContaining({camera: [-10, 0, 30], point: {x: 0, y: 0, z: 0}}), true);
        expect(s.changed.mock.calls[s.changed.mock.calls.length - 1][0].frame.file).toBe("a");
        s.box.querySelector('[data-pip="next"]').click();
        expect(s.box.textContent).toContain("Photo 2 of 2");
        expect(s.changed).toHaveBeenLastCalledWith(expect.objectContaining({camera: [0, 5, 40], point: {x: 0, y: 0, z: 0}}), true);
        s.box.querySelector('[data-pip="close"]').click();
        expect(s.box.hidden).toBe(true);
        expect(s.changed).toHaveBeenLastCalledWith(null, false);
    });

    test("shows a point of the map from the caller's own URLs, in its words, with the photos the server left out and the orthophoto's temperature", async () => {
        document.body.innerHTML = '<div id="box" hidden></div>';
        const box = document.getElementById("box"), urls = [];
        const fetchFn = jest.fn((url) => {
            urls.push(url);
            if (url.includes("/values")) return Promise.resolve({status: 200, ok: true, arrayBuffer: () => Promise.reject(new Error("no"))});
            return Promise.resolve({ok: true, json: () => Promise.resolve({frames: [frame("a", [-10, 0, 30], 20), frame("b", [20, 0, 2], 21)],
                                                                          workset: null, hidden: 2, orthophoto: 18})});
        });
        const frames = Frames3D.create(box, {fetchFn, framesUrl: (p) => "/map/frames?lon=" + p.lng + "&lat=" + p.lat, valuesUrl: (i) => "/map/frames/" + i + "/values",
                                             words: {surface: "The orthophoto", hides: "the surface"}, style: () => ({palette: []}),
                                             corrected: (c) => c + 1, format: (c) => c.toFixed(1) + " °C"});
        await frames.show({lng: 1.5, lat: 2.5}, null);
        expect(urls[0]).toBe("/map/frames?lon=1.5&lat=2.5");
        // No mesh to hide a photo in the browser: both shown, the server's two counted
        expect(box.textContent).toContain("Photo 1 of 2 that saw this spot");
        expect(box.textContent).toContain("The orthophoto19.0 °C");
        expect(box.textContent).toContain("2 more photos had it in view, but the surface hides it from them.");
        expect(urls).toContain("/map/frames/1/values");
    });

    test("asks again for a photo's temperatures that failed to load, when it's shown again", async () => {
        document.body.innerHTML = '<div id="box" hidden></div>';
        const box = document.getElementById("box"), asked = [];
        const fetchFn = jest.fn((url) => {
            if (url.includes("/values")) { asked.push(url); return Promise.reject(new Error("offline")); }
            return Promise.resolve({ok: true, json: () => Promise.resolve({frames: [frame("a", [-10, 0, 30], 20), frame("bb", [0, 5, 40], 21)], workset: null})});
        });
        const frames = Frames3D.create(box, {fetchFn, task: {id: "t1", project: 3}, style: () => ({palette: []}), corrected: (c) => c, format: (c) => String(c)});
        await frames.show({x: 0, y: 0, z: 0}, null, null);
        await new Promise(r => setTimeout(r, 0));
        box.querySelector('[data-pip="next"]').click();
        await new Promise(r => setTimeout(r, 0));
        box.querySelector('[data-pip="prev"]').click();
        expect(asked.map(u => u.replace(/.*frames\//, ""))).toEqual(["1/values", "2/values", "1/values"]);
    });

    test("says why when the server has no photos to give", async () => {
        document.body.innerHTML = '<div id="box"></div>';
        const box = document.getElementById("box");
        const frames = Frames3D.create(box, {fetchFn: () => Promise.resolve({ok: false, json: () => Promise.resolve({error: "This task has no cameras ODM placed its photos with"})}),
                                             task: {id: "t1", project: 3}, raycast: MeshIndex.raycast, index: () => null, style: () => null,
                                             corrected: (c) => c, format: (c) => String(c)});
        await frames.show({x: 0, y: 0, z: 0}, null, null);
        expect(box.textContent).toContain("This task has no cameras ODM placed its photos with");
    });
});
