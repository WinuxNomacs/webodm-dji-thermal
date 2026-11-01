const Recolour = require("../recolour.js");
const fixtures = require("./fixtures/colouring.json");

// The fixtures' values as a value tile decodes them
function fixtureTile(sigma) {
    return {values: Float64Array.from(fixtures.values, (v) => (v === null ? NaN : v)), flags: Uint8Array.from(fixtures.flags),
            width: fixtures.size, height: fixtures.size, margin: fixtures.margin, sigma: sigma || 1};
}

describe("colouring a value tile", () => {
    const inner = fixtures.size - 2 * fixtures.margin;

    test.each(fixtures.cases.map((c) => [c.name, c]))("draws %s exactly as the server does", (_name, c) => {
        const out = new Uint8ClampedArray(inner * inner * 4);
        Recolour.colour(fixtureTile(c.sigma), {colors: fixtures.palettes[c.palette], range: c.range, shares: c.shares || null,
                                               sharpen: c.sharpen || 0, isotherm: c.isotherm || null, seams: !!c.seams}, out);
        expect(Array.from(out)).toEqual(c.rgba);
    });

    test("keeps a tile's blur for the same range, and blurs again for another", () => {
        const tile = fixtureTile(1.7), c = fixtures.cases.find((x) => x.name === "sharpened");
        const style = {colors: fixtures.palettes.long, range: c.range, shares: null, sharpen: 2.5, isotherm: null};
        const out = new Uint8ClampedArray(inner * inner * 4);
        Recolour.colour(tile, style, out);
        const blur = tile.blur;
        Recolour.colour(tile, Object.assign({}, style, {sharpen: 1}), out);
        expect(tile.blur).toBe(blur);
        Recolour.colour(tile, Object.assign({}, style, {range: [0, 40]}), out);
        expect(tile.blur).not.toBe(blur);
    });
});

describe("the tone curve", () => {
    test("equalizes from the server's histogram as the server does", () => {
        const e = fixtures.equalization;
        const curve = Recolour.equalization(fixtures.histogram, e.range[0], e.range[1]);
        const shares = Recolour.curveShares(e.range[0], e.range[1], {gamma: 1}, curve);
        expect(shares).toHaveLength(Recolour.CURVE_SAMPLES);
        shares.forEach((s, i) => expect(s).toBeCloseTo(e.shares[i], 12));
        expect(Recolour.drawnShares(e.range[0], e.range[1], {gamma: 1, equalize: true}, fixtures.histogram)).toEqual(shares);
    });

    test("is gamma's alone without equalization, and none (linear) without adjustments", () => {
        const shares = Recolour.drawnShares(0, 10, {gamma: 2, equalize: false});
        expect(shares[16]).toBeCloseTo(Math.sqrt(0.25), 12);
        expect(Recolour.drawnShares(0, 10, {gamma: 1, equalize: false})).toBeNull();
    });

    test("equalizes nothing from a histogram with no values in the range", () => {
        expect(Recolour.equalization({counts: [5, 5], edges: [0, 1, 2]}, 10, 20)).toBeNull();
        expect(Recolour.equalization({counts: null, edges: null}, 0, 1)).toBeNull();
    });

    test("interpolates as numpy does, at repeated points too", () => {
        const xs = [0, 1, 1, 2], ys = [0, 0.25, 0.75, 1];
        expect([-1, 0.5, 1, 1.5, 3].map((x) => Recolour.interp(x, xs, ys))).toEqual([0, 0.125, 0.75, 0.875, 1]);
    });
});

describe("value tiles", () => {
    test("decode to values from their 16-bit codes, flags, and no value where clear", () => {
        const rgba = [1, 2, 1, 255, 0, 0, 0, 0, 255, 255, 2, 255];
        const tile = Recolour.decode(rgba, 3, 1, -10, 0.5);
        expect(Array.from(tile.values.slice(0, 1))).toEqual([-10 + 258 * 0.5]);
        expect(Number.isNaN(tile.values[1])).toBe(true);
        expect(tile.values[2]).toBe(-10 + 65535 * 0.5);
        expect(Array.from(tile.flags)).toEqual([1, 0, 2]);
    });

    test("are fetched with their offset, step, margin and sigma, and none where the server has none", async () => {
        const headers = {"X-Values-Offset": "5", "X-Values-Step": "0.25", "X-Values-Margin": "8", "X-Sharpen-Sigma": "1.5"};
        const fetchFn = jest.fn((url) => Promise.resolve(url.endsWith("gone") ? {status: 404, ok: false} :
            {status: 200, ok: true, headers: {get: (k) => headers[k]}, blob: () => Promise.resolve("blob")}));
        const drawn = new Uint8ClampedArray([0, 4, 0, 255]);
        window.createImageBitmap = jest.fn(() => Promise.resolve({width: 1, height: 1}));
        const ctx = {drawImage: jest.fn(), getImageData: () => ({data: drawn})};
        const canvas = jest.spyOn(document, "createElement").mockReturnValue({getContext: () => ctx});
        const tile = await Recolour.fetchValues("/values/1/2/3", fetchFn);
        expect(window.createImageBitmap).toHaveBeenCalledWith("blob", {colorSpaceConversion: "none", premultiplyAlpha: "none"});
        expect([tile.values[0], tile.margin, tile.sigma]).toEqual([6, 8, 1.5]);
        expect(await Recolour.fetchValues("/values/gone", fetchFn)).toBeNull();
        canvas.mockRestore();
    });
});

describe("a Leaflet layer drawn from value tiles", () => {
    // A canvas stand-in: what was put on it
    function fakeCanvas() {
        const ctx = {puts: 0, createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}),
                     putImageData(image) { this.puts++; this.last = image; }, clearRect: jest.fn(), drawImage: jest.fn()};
        return {getContext: () => ctx, ctx};
    }

    test("draws each tile from its values, colours them all again once a frame, and stops asking for a tile let go of", async () => {
        const headers = {"X-Values-Offset": "10", "X-Values-Step": "1", "X-Values-Margin": "0", "X-Sharpen-Sigma": "1"};
        let release;
        const fetchFn = jest.fn((url, opts) => (url.endsWith("/slow") ? new Promise((resolve) => { release = resolve; opts.signal.addEventListener("abort", () => resolve({status: 404})); }) :
            Promise.resolve({status: 200, ok: true, headers: {get: (k) => headers[k]}, blob: () => Promise.resolve("blob")})));
        window.createImageBitmap = jest.fn(() => Promise.resolve({width: 2, height: 1}));
        const create = jest.spyOn(document, "createElement").mockImplementation(() => {
            const c = fakeCanvas();
            c.ctx.getImageData = () => ({data: new Uint8ClampedArray([0, 0, 0, 255, 0, 10, 0, 255])});
            c.ctx.drawImage = jest.fn();
            return c;
        });
        const handlers = {};
        const layer = {getTileSize: () => ({x: 2, y: 1}), on(ev, f) { handlers[ev] = f; return this; }};
        let style = {colors: [0x000000ff, 0xffffffff], range: [10, 20], shares: null, sharpen: 0, isotherm: null};
        Recolour.drawFromValues(layer, {url: (c) => "/values/" + c.z + (c.slow ? "/slow" : ""), style: () => style, fetchFn});

        const done = jest.fn();
        const canvas = layer.createTile({z: 3}, done);
        await new Promise((r) => setTimeout(r, 0));
        expect(fetchFn.mock.calls[0][0]).toBe("/values/3");
        expect(done).toHaveBeenCalledWith(null, canvas);
        expect(canvas.complete).toBe(true);
        expect(Array.from(canvas.ctx.last.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);

        jest.useFakeTimers();
        const frame = jest.spyOn(window, "requestAnimationFrame");
        style = Object.assign({}, style, {range: [0, 40]});
        layer.recolour();
        layer.recolour();
        expect(frame).toHaveBeenCalledTimes(1);
        jest.runOnlyPendingTimers();
        expect(canvas.ctx.puts).toBe(2);
        jest.useRealTimers();

        const slow = layer.createTile({z: 4, slow: true}, jest.fn());
        handlers.tileunload({tile: slow});
        expect(fetchFn.mock.calls[1][1].signal.aborted).toBe(true);
        release();
        create.mockRestore();
    });
});
