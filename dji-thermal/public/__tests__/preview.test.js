// The frame preview (preview.js): a frame at its full size over the page, zoomed, dragged, stepped and closed
const Preview = require("../preview.js");
const Recolour = require("../recolour.js");
const Frames = require("../frames.js");
const Frames3D = require("../frames3d.js");

const settled = () => new Promise(r => setTimeout(r, 0));
const key = (k, extra) => {
    const e = new KeyboardEvent("keydown", Object.assign({key: k, bubbles: true, cancelable: true}, extra));
    document.body.dispatchEvent(e);
    return e;
};
const press = (el, action) => el.querySelector('[data-preview="' + action + '"]').click();

describe("the view of a frame", () => {
    test("fits the frame in the page, centred along the side with room to spare", () => {
        expect(Preview.fitView(640, 512, 1280, 768)).toEqual({scale: 1.5, x: 160, y: 0});
        expect(Preview.fitView(640, 512, 320, 768)).toEqual({scale: 0.5, x: 0, y: 256});
    });

    test("zooms about a point, which keeps its pixel, between the fitted scale and the largest", () => {
        const fit = Preview.fitView(640, 512, 1280, 768);
        const zoomed = Preview.zoomView(fit, 2, 400, 300, 640, 512, 1280, 768);
        expect(zoomed.scale).toBe(3);
        // The pixel under (400, 300) before is under it after
        expect((400 - zoomed.x) / zoomed.scale).toBeCloseTo((400 - fit.x) / fit.scale, 9);
        expect((300 - zoomed.y) / zoomed.scale).toBeCloseTo((300 - fit.y) / fit.scale, 9);
        expect(Preview.zoomView(fit, 0.1, 400, 300, 640, 512, 1280, 768)).toEqual(fit);
        expect(Preview.zoomView(zoomed, 1000, 400, 300, 640, 512, 1280, 768).scale).toBe(Preview.MAX_ZOOM);
    });

    test("keeps a dragged frame over the page: no edge pulled inside it", () => {
        expect(Preview.clampView({scale: 4, x: 500, y: -5000}, 640, 512, 1280, 768)).toEqual({scale: 4, x: 0, y: 768 - 2048});
    });
});

describe("the preview", () => {
    const items = [{name: "a.tiff", width: 640, height: 512, mark: {x: 100, y: 50}}, {name: "b.tiff", width: 640, height: 512, mark: null},
                   {name: "c.tiff", width: 640, height: 512, mark: null}];
    function opened(paints, extra) {
        document.body.innerHTML = '<button id="from">Preview frame</button>';
        document.getElementById("from").focus();
        const shown = jest.fn(), closed = jest.fn();
        const preview = Preview.open(document, Object.assign({
            count: 3, at: 0, shown, closed, title: (i) => "Photo " + (i + 1) + " of 3: " + items[i].name,
            item: (i) => Object.assign({}, items[i], {paint: () => Promise.resolve(paints[i]), read: (col, row) => col + "," + row})}, extra));
        return {preview, shown, closed, el: preview.element};
    }

    test("opens over the page on the frame shown, fitted, its spot marked on its pixel, and steps to the others", async () => {
        const {preview, shown, el} = opened([true, true, true]);
        await settled();
        expect(document.body.lastChild).toBe(el);
        expect(el.getAttribute("role")).toBe("dialog");
        expect(el.querySelector(".dt-preview-title").textContent).toBe("Photo 1 of 3: a.tiff");
        expect(el.querySelector('[data-preview="prev"]').disabled).toBe(true);
        expect(el.querySelector("canvas").width).toBe(640);
        // jsdom's window is 1024 x 768: the frame fitted to its height (1.5), centred across
        expect(preview.view()).toEqual({scale: 1.5, x: 32, y: 0});
        const mark = el.querySelector(".dt-preview-mark");
        expect(mark.hidden).toBe(false);
        expect(mark.style.left).toBe(32 + 100.5 * 1.5 + "px");
        expect(mark.style.top).toBe(50.5 * 1.5 + "px");
        expect(shown).not.toHaveBeenCalled();
        press(el, "next");
        await settled();
        expect(el.querySelector(".dt-preview-title").textContent).toBe("Photo 2 of 3: b.tiff");
        expect(mark.hidden).toBe(true);
        expect(shown).toHaveBeenLastCalledWith(1);
        key("ArrowRight");
        key("ArrowRight");                    // the last: stays
        expect(shown).toHaveBeenLastCalledWith(2);
        expect(shown).toHaveBeenCalledTimes(2);
        expect(el.querySelector('[data-preview="next"]').disabled).toBe(true);
        key("ArrowLeft");
        expect(preview.at()).toBe(1);
        preview.close();
    });

    test("zooms by the buttons, the keys and the wheel about the pointer, and fits again", async () => {
        const {preview, el} = opened([true, true, true]);
        await settled();
        press(el, "in");
        expect(preview.view().scale).toBeCloseTo(1.5 * Preview.STEP, 9);
        key("+");
        expect(preview.view().scale).toBeCloseTo(1.5 * Preview.STEP * Preview.STEP, 9);
        key("0");
        expect(preview.view()).toEqual({scale: 1.5, x: 32, y: 0});
        const stage = el.querySelector(".dt-preview-stage");
        const before = (332 - preview.view().x) / preview.view().scale;
        stage.dispatchEvent(new WheelEvent("wheel", {deltaY: -100, clientX: 332, clientY: 300, bubbles: true, cancelable: true}));
        stage.dispatchEvent(new WheelEvent("wheel", {deltaY: -100, clientX: 332, clientY: 300, bubbles: true, cancelable: true}));
        expect(preview.view().scale).toBeCloseTo(1.5 * Preview.STEP * Preview.STEP, 9);
        expect((332 - preview.view().x) / preview.view().scale).toBeCloseTo(before, 6);
        press(el, "out");
        press(el, "out");
        press(el, "out");                     // never smaller than fitted
        expect(preview.view().scale).toBeCloseTo(1.5, 9);
        preview.close();
    });

    test("is dragged once zoomed, and reads the pixel under the pointer", async () => {
        const {preview, el} = opened([true, true, true]);
        await settled();
        const stage = el.querySelector(".dt-preview-stage"), reading = el.querySelector(".dt-preview-reading");
        const pointer = (type, x, y, id) => {
            const e = new MouseEvent(type, {clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0});
            Object.defineProperty(e, "pointerId", {value: id});
            stage.dispatchEvent(e);
        };
        // Not pressed: the reading of the pixel there (column (182 - 32) / 1.5, row 30 / 1.5), beside the pointer
        pointer("pointermove", 182, 30, 1);
        expect(reading.hidden).toBe(false);
        expect(reading.textContent).toBe("100,20");
        pointer("pointermove", 10, 30, 1);    // left of the frame
        expect(reading.hidden).toBe(true);
        key("+"); key("+"); key("+"); key("+");
        const zoomed = preview.view();
        pointer("pointerdown", 500, 400, 1);
        pointer("pointermove", 460, 380, 1);
        expect(preview.view().x).toBeCloseTo(zoomed.x - 40, 9);
        expect(preview.view().y).toBeCloseTo(zoomed.y - 20, 9);
        pointer("pointerup", 460, 380, 1);
        pointer("pointermove", 400, 380, 1);  // let go: no longer dragging
        expect(preview.view().x).toBeCloseTo(zoomed.x - 40, 9);
        preview.close();
    });

    test("says so in place of a frame that can't be drawn, without its mark", async () => {
        const {el} = opened(["This photo isn't on the server any more.", true, true]);
        await settled();
        expect(el.querySelector(".dt-preview-note").textContent).toBe("This photo isn't on the server any more.");
        expect(el.querySelector(".dt-preview-mark").hidden).toBe(true);
        press(el, "close");
    });

    test("closes with Esc or its cross, gives the focus back, and keeps its keys from the page under it", async () => {
        const {closed, el} = opened([true, true, true]);
        const page = jest.fn();
        document.body.addEventListener("keydown", page);
        key("ArrowRight");
        key("x");
        expect(page).not.toHaveBeenCalled();
        const esc = key("Escape");
        expect(esc.defaultPrevented).toBe(true);
        expect(document.body.contains(el)).toBe(false);
        expect(closed).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(document.getElementById("from"));
        key("ArrowRight");                    // closed: the page's again
        expect(page).toHaveBeenCalledTimes(1);
        document.body.removeEventListener("keydown", page);
    });
});

describe("Preview frame in the frames windows", () => {
    const frame = (index, file, temperature, extra) => Object.assign({index, file, x: 19.5, y: 14.5, width: 40, height: 30, camera: [0, 0, 30],
        view_angle: 10, distance: 20, temperature, available: true, frame: null}, extra);

    test("the photos window previews its photos as it draws them, with the temperature under the pointer, and follows the photo shown", async () => {
        document.body.innerHTML = '<div id="box" hidden></div>';
        const box = document.getElementById("box"), changed = jest.fn();
        const context = {createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}), putImageData: jest.fn()};
        jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
        jest.spyOn(Recolour, "colour").mockImplementation(() => {});
        const values = new Float32Array(40 * 30).fill(20);
        values[5 * 40 + 8] = 31.5;
        const asked = [];
        jest.spyOn(Recolour, "fetchValues").mockImplementation((url) => { asked.push(url.replace(/.*frames\//, "")); return Promise.resolve({values, width: 40, height: 30}); });
        const fetchFn = () => Promise.resolve({ok: true, json: () => Promise.resolve({frames: [frame(1, "a.tiff", 20), frame(2, "b.tiff", 21),
            frame(3, "gone.tiff", null, {available: false})], workset: null})});
        const frames = Frames3D.create(box, {fetchFn, task: {id: "t1", project: 3}, style: () => ({palette: []}), corrected: (c) => c + 1,
                                             format: (c) => c.toFixed(1) + " °C", changed});
        await frames.show({x: 0, y: 0, z: 0}, null, null);
        await settled();
        const link = box.querySelector('[data-pip="preview"]');
        expect(link.textContent.trim()).toBe("Preview frame");
        link.click();
        await settled();
        const el = document.querySelector(".dt-preview");
        expect(el.querySelector(".dt-preview-title").textContent).toBe("Photo 1 of 3 that saw this spot: a.tiff");
        expect(el.querySelector(".dt-preview-note").hidden).toBe(true);
        expect(asked).toEqual(["1/values"]);             // the window's own values, not asked for again
        // 1024 x 768 fits 40 x 30 at 25.6: the pixel (8, 5), corrected and formatted as the window's figures
        const stage = el.querySelector(".dt-preview-stage");
        stage.dispatchEvent(new MouseEvent("pointermove", {clientX: 8.5 * 25.6, clientY: 5.5 * 25.6, bubbles: true}));
        expect(el.querySelector(".dt-preview-reading").textContent).toBe("32.5 °C");
        press(el, "next");
        await settled();
        expect(box.textContent).toContain("Photo 2 of 3 that saw this spot");
        expect(context.putImageData).toHaveBeenCalledTimes(4);     // each photo in the window and in the preview
        expect(changed.mock.calls[changed.mock.calls.length - 1][0].frame.file).toBe("b.tiff");
        press(el, "next");
        await settled();
        expect(el.querySelector(".dt-preview-note").textContent).toBe("This photo isn't on the server any more.");
        expect(asked).toEqual(["1/values", "2/values"]);
        // A photo that isn't on the server has no preview of its own to offer
        expect(box.querySelector('[data-pip="preview"]')).toBeNull();
        press(el, "close");
        expect(document.querySelector(".dt-preview")).toBeNull();
        jest.restoreAllMocks();
    });

    test("a workset's frames window previews the pictures it shows, the point marked", () => {
        const pick = {at: 1, models: true, frames: [frame(4, "a.tiff"), frame(7, "b.tiff")]};
        expect(Frames.pipHtml(pick, "/x.png", "/api/w")).toContain('data-pip="preview"');
        expect(Frames.pipHtml(pick, "/x.png", "")).toContain('data-pip="preview"');        // without a frame page too
        document.body.innerHTML = "";
        const shown = jest.fn();
        const preview = Frames.preview(document, pick, (f) => "/frames/" + f.index + ".png", shown);
        const el = preview.element;
        expect(el.querySelector(".dt-preview-title").textContent).toBe("Frame 2 of 2 that saw this point: b.tiff");
        expect(el.querySelector("img").getAttribute("src")).toBe("/frames/7.png");
        expect(el.querySelector(".dt-preview-mark").hidden).toBe(false);
        press(el, "prev");
        expect(el.querySelector("img").getAttribute("src")).toBe("/frames/4.png");
        expect(shown).toHaveBeenLastCalledWith(0);
        el.querySelector("img").dispatchEvent(new Event("error"));
        expect(el.querySelector(".dt-preview-note").textContent).toBe("This frame couldn't be loaded.");
        preview.close();
        expect(Frames.preview(document, {at: 0, frames: []}, () => "", shown)).toBeNull();
    });
});
