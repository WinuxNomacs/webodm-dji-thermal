// The temperature unit for the whole of WebODM (units.js): the user's, linked to WebODM's units, a menu in the top bar
const units = require('../units');

function navbar(singleUser) {
    document.body.innerHTML = '<nav id="navbar-top"><div class="navbar-header"><button class="navbar-toggle"></button>' +
        (singleUser ? "" : '<ul class="nav navbar-top-links navbar-right"><li class="dropdown"><a class="dropdown-toggle"><i class="fa fa-user"></i></a></li></ul>') +
        '<a class="navbar-brand" href="/"></a></div></nav>';
}

// A window whose server answers the display preferences (null: not logged in) and the administrator's default
function fakeWindow(prefs, defaultUnit) {
    const calls = [];
    const fetch = jest.fn((url, opts) => {
        calls.push([url, opts && opts.method === "PUT" ? JSON.parse(opts.body) : null, window.localStorage.getItem("unit_system")]);
        if (/\/unit$/.test(url)) {
            return Promise.resolve({ok: true, json: () => Promise.resolve(prefs ? Object.assign({logged_in: true}, prefs) :
                {logged_in: false, unit: null, default_unit: defaultUnit || "C"})});
        }
        return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    });
    return {win: {document, localStorage: window.localStorage, fetch, CustomEvent: window.CustomEvent,
                  addEventListener: window.addEventListener.bind(window)},
            puts: () => calls.filter(c => c[1]).map(c => [c[1], c[2]])};
}

const flush = () => new Promise(r => setTimeout(r, 0));
const label = () => document.querySelector(".dt-unit-menu .dropdown-toggle").textContent.trim();

describe("the temperature unit", () => {
    let heard;
    const listen = e => heard.push(e.type + ":" + e.detail);
    beforeEach(() => {
        heard = [];
        navbar();
        document.addEventListener("onUnitSystemChanged", listen);
        document.addEventListener(units.CHANGED, listen);
    });
    afterEach(() => {
        document.removeEventListener("onUnitSystemChanged", listen);
        document.removeEventListener(units.CHANGED, listen);
        window.localStorage.clear();
    });

    it("is the user's choice, else this browser's WebODM units when set, else the administrator's default", () => {
        expect(units.resolve({unit: "F", default_unit: "C"}, "metric")).toBe("F");
        expect(units.resolve({unit: null, default_unit: "C"}, "imperial")).toBe("F");
        expect(units.resolve({unit: null, default_unit: "C"}, "imperialUS")).toBe("F");
        expect(units.resolve({unit: null, default_unit: "F"}, null)).toBe("F");
        expect(units.resolve({unit: null}, null)).toBe("C");
    });

    it("sets this browser's WebODM units to the user's unit on load, and adds the menu left of the user icon", async () => {
        const {win, puts} = fakeWindow({unit: "F", default_unit: "C"});
        const u = units.create(win);
        await u.start();
        expect(window.localStorage.getItem("unit_system")).toBe("imperial");
        expect(heard).toEqual(["onUnitSystemChanged:imperial"]);
        expect(u.current()).toBe("F");
        const items = document.querySelectorAll(".navbar-top-links > li");
        expect(items[0].classList.contains("dt-unit-menu")).toBe(true);
        expect(items[1].querySelector(".fa-user")).not.toBeNull();
        expect(label()).toBe("°F");
        expect(document.querySelector(".dt-unit-menu li.active").textContent).toBe("°F Fahrenheit");
        expect(puts()).toEqual([]);
    });

    it("saves the unit picked in the menu before changing WebODM's units, and saves what WebODM's switch picks", async () => {
        const {win, puts} = fakeWindow({unit: null, default_unit: "C"});
        const u = units.create(win);
        await u.start();
        expect(label()).toBe("°C");
        document.querySelector('[data-dt-unit="F"]').click();
        await flush();
        // Saved while WebODM's units were still metric
        expect(puts()).toEqual([[{unit: "F"}, null]]);
        expect(window.localStorage.getItem("unit_system")).toBe("imperial");
        expect(label()).toBe("°F");
        // WebODM's own selector
        window.localStorage.setItem("unit_system", "metric");
        document.dispatchEvent(new CustomEvent("onUnitSystemChanged", {detail: "metric"}));
        await flush();
        expect(puts().map(p => p[0])).toEqual([{unit: "F"}, {unit: "C"}]);
        expect(label()).toBe("°C");
        expect(u.current()).toBe("C");
    });

    it("gives a user who never chose the administrator's default without saving it as their choice", async () => {
        const {win, puts} = fakeWindow({unit: null, default_unit: "F"});
        await units.create(win).start();
        expect(window.localStorage.getItem("unit_system")).toBe("imperial");
        expect(puts()).toEqual([]);
        // This browser's WebODM units, once set, win over the default
        window.localStorage.setItem("unit_system", "metric");
        navbar();
        const other = fakeWindow({unit: null, default_unit: "F"});
        await units.create(other.win).start();
        expect(window.localStorage.getItem("unit_system")).toBe("metric");
        expect(label()).toBe("°C");
        expect(other.puts()).toEqual([]);
    });

    it("adds the menu alone in WebODM's single-user mode, which has no user icon", async () => {
        navbar(true);
        await units.create(fakeWindow({unit: "C", default_unit: "C"}).win).start();
        const links = document.querySelector(".navbar-header .navbar-top-links");
        expect(links.previousElementSibling.className).toBe("navbar-toggle");
        expect(links.querySelectorAll("li.dt-unit-menu").length).toBe(1);
    });

    it("shows an anonymous viewer the administrator's default, with no menu, WebODM's units left as they are", async () => {
        const {win, puts} = fakeWindow(null, "F");
        const u = units.create(win);
        await u.start();
        expect(u.current()).toBe("F");
        expect(heard).toEqual([units.CHANGED + ":F"]);
        expect(window.localStorage.getItem("unit_system")).toBeNull();
        expect(document.querySelector(".dt-unit-menu")).toBeNull();
        document.dispatchEvent(new CustomEvent("onUnitSystemChanged", {detail: "metric"}));
        await flush();
        expect(puts()).toEqual([]);
        expect(u.current()).toBe("F");
    });
});
