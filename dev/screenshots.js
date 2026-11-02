// The docs' screenshots (docs/images/*.png), taken in a headless browser from the dev WebODM (dev/webodm.sh up) on
// your own data: `node dev/screenshots.js [name ...]` at the repo root, every shot when no name is given. Read only:
// the browser sends no request that changes anything (only the login and two that compute without saving), and none
// beyond WebODM, so the maps have no base layer to show where a flight was. Nothing on a page that gives a location
// is shot: the detail pane's latitude and longitude are hidden first (and the camera's serial number), and a shot
// whose page shows a number that looks like a coordinate is refused. Look at each one before committing it.
//
// Set in the environment or in .env (untracked):
//   DT_DOCS_USER, DT_DOCS_PASSWORD   a login on the dev WebODM
//   DT_DOCS_DATASET                  a Thermal Analyzer dataset, analyzed, with a workset that has mosaics
//   DT_DOCS_MAP                      the map page of a task with a thermal orthophoto (/map/project/<id>/task/<id>/)
//   DT_FLIGHT_DIR                    a flight's photos (as for the tests), a few given to the Thermal Task panel
//   DT_DOCS_URL                      the dev WebODM, by default http://localhost:8002
"use strict";
const fs = require("fs");
const path = require("path");
const {chromium} = require("playwright");

const REPO = path.dirname(__dirname);
const OUT = path.join(REPO, "docs", "images");
const SIZE = {width: 1280, height: 800};
const MARGIN = 8;       // around an element shot
// What may be posted: the login, a photo's description (the Thermal Task panel) and a region's statistics (the
// Thermal Inspector, the frame page), which compute without saving
const POSTS = [/\/login\/$/, /\/api\/plugins\/dji-thermal\/describe$/, /\/inspector\/region$/, /\/frame\/region$/];
// A number with five or more decimals, as coordinates are shown
const COORDINATE = /-?\b\d{1,3}\.\d{5,}\b/;
// A camera's serial number, as the dataset's summary and the detail pane show it
const SERIAL = /\bSN [A-Z0-9]{6,}/g;

function readEnv() {
    const file = path.join(REPO, ".env");
    const env = {};
    if (fs.existsSync(file)) {
        fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*(#.*)?$/);
            if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
        });
    }
    return Object.assign(env, process.env);
}

function need(env, name) {
    if (!env[name]) throw new Error(name + " is not set (environment or .env)");
    return env[name];
}

// A few thermal photos (_T.JPG) of the flight, found in any subfolder
function thermalPhotos(dir, count) {
    const found = [];
    (function walk(d) {
        fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
            if (found.length >= count) return;
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/_T\.jpe?g$/i.test(e.name)) found.push(p);
        });
    })(dir);
    return found;
}

// The shots, in the docs' order: each opens its page in a set state and returns what to shoot (the page, or an
// element of it)
const SHOTS = {
    "thermal-task-button": async (p, env) => {
        await p.goto(env.url + "/dashboard/");
        await p.waitForSelector(".dji-thermal-button");
        await p.waitForTimeout(1000);
        return p.locator(".project-list-item").first();
    },
    "thermal-task-panel": async (p, env) => {
        await p.goto(env.url + "/dashboard/");
        await p.waitForSelector(".dji-thermal-button");
        const photos = thermalPhotos(need(env, "DT_FLIGHT_DIR"), 6);
        await p.locator('input[type=file][accept=".jpg,.jpeg,.txt"]').first().setInputFiles(photos);
        await p.waitForSelector("#dji-thermal-unit", {timeout: 60000});
        await p.waitForTimeout(2000);
        return p.locator(".project-list-item").first();
    },
    "analyzer-list": async (p, env) => {
        await p.goto(env.url + "/plugins/dji-thermal/");
        await p.waitForSelector("#ta-body tr");
        return p;
    },
    "new-dataset": async (p, env) => {
        await p.goto(env.url + "/plugins/dji-thermal/");
        await p.waitForSelector("#ta-body tr");
        await p.click("#ta-new");
        // A few of the flight's photos chosen (nothing is sent before Create): the name filled in from their camera
        await p.setInputFiles("#ta-new-files", thermalPhotos(need(env, "DT_FLIGHT_DIR"), 6));
        await p.waitForFunction(() => /\d{4}-\d\d-\d\d$/.test(document.getElementById("ta-new-name").value));
        return p.locator("#ta-new-dialog .ta-dialog-inner");
    },
    "dataset": async (p, env) => {
        await openDataset(p, env);
        return p;
    },
    "workset-settings": async (p, env) => {
        await openDataset(p, env);
        await p.click("#ta-convert-summary [data-act=edit]");
        await p.waitForTimeout(500);
        return p.locator("#ta-convert-settings");
    },
    "workset": async (p, env) => {
        await openDataset(p, env);
        return p.locator(".ta-conversion").first();
    },
    "workset-files": async (p, env) => {
        // The first workset's Files, the detail pane following the mouse on its second image (its figures measured
        // once, in WebODM's worker, the first time they're asked for), wide enough for all its columns
        await p.setViewportSize({width: 1500, height: 900});
        await openDataset(p, env);
        const first = p.locator(".ta-conversion").first();
        await first.locator('.ta-conversion-files-head [data-act="files"]').click();
        const files = first.locator(".ta-conversion-files");
        await files.locator(".ta-results tbody tr").first().waitFor();
        await p.waitForFunction(() => !document.querySelector(".ta-figures-progress .fa-spin"), null, {timeout: 120000});
        await files.locator(".ta-results tbody tr").nth(1).hover();
        await files.locator(".ta-file-detail-img").waitFor();
        // The table's first rows only, so the picture stays readable
        await p.addStyleTag({content: ".ta-results tbody tr:nth-child(n+13){ display: none; }"});
        await p.waitForTimeout(1500);
        return files;
    },
    "workset-mosaics": async (p, env) => {
        // The first workset with mosaics: its Mosaics, the harmonized one clicked, so the pane keeps it
        await openDataset(p, env);
        const card = p.locator(".ta-conversion").filter({has: p.locator('[data-act="mosaic-files"]')}).first();
        await card.locator('[data-act="mosaic-files"]').click();
        const section = card.locator(".ta-mosaics-section");
        await section.locator('tbody tr[data-kind="harmonized"] td').nth(1).click();
        await section.locator(".ta-file-detail-img").waitFor();
        await p.mouse.move(0, 0);
        await p.waitForTimeout(1500);
        return section;
    },
    "create-task": async (p, env) => {
        await openDataset(p, env);
        const first = p.locator(".ta-conversion").first();
        const button = first.locator('[data-act="task"]').first();
        if (!await button.isVisible()) await first.locator('[data-act="menu"]').first().click();
        await button.click();
        await p.waitForSelector(".ta-task-head");
        return first;
    },
    "dataset-files": async (p, env) => {
        // Wide enough for all its columns beside the detail pane
        await p.setViewportSize({width: 1600, height: 900});
        await openDataset(p, env);
        await p.click('#ta-tabs a[data-tab="files"]');
        await p.locator(".ta-files tbody tr.ta-kind-thermal").nth(2).click();
        await p.waitForSelector(".ta-file-detail:not([hidden]) img");
        await p.waitForTimeout(1500);
        return p;
    },
    "picture-viewer": async (p, env) => {
        await SHOTS["dataset-files"](p, env);
        await p.click('a[data-act="view-picture"]');
        await p.waitForSelector(".ta-picture-img:not([hidden])");
        await p.waitForTimeout(500);
        return p;
    },
    "dataset-problems": async (p, env) => {
        await openDataset(p, env);
        await p.click('#ta-tabs a[data-tab="problems"]');
        await p.waitForTimeout(500);
        return p.locator("#ta-tab-problems");
    },
    "dataset-plan": async (p, env) => {
        await openDataset(p, env);
        await p.click('#ta-tabs a[data-tab="webodm"]');
        await p.waitForTimeout(500);
        return p.locator("#ta-tab-webodm");
    },
    "dataset-preset": async (p, env) => {
        await openDataset(p, env);
        await p.click('#ta-tabs a[data-tab="webodm"]');
        await p.click("#ta-plan-preset");
        await p.waitForSelector('[data-act="preset-save"]');
        return p.locator("#ta-plan-preset-panel");
    },
    "mosaic-viewer": async (p, env) => {
        await openViewer(p, env);
        await hoverMap(p);
        return p;
    },
    "mosaic-frames": async (p, env) => {
        await openViewer(p, env);
        const box = await p.locator("#ta-viewer-map").boundingBox();
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await p.waitForSelector("#ta-viewer-pip:not([hidden]) img", {timeout: 30000});
        await p.waitForTimeout(1500);
        return p;
    },
    "frame-page": async (p, env) => {
        // A frame of the dataset's first workset, a rectangle measured on it, the cursor on the frame
        await p.setViewportSize({width: SIZE.width, height: 1000});
        await openFrame(p, env);
        const frame = await p.locator("#ta-frame-map-0").boundingBox();
        const at = (fx, fy) => [frame.x + frame.width * fx, frame.y + frame.height * fy];
        await p.click('[data-tool="rectangle"]');
        await p.mouse.move(...at(0.3, 0.35));
        await p.mouse.down();
        await p.mouse.move(...at(0.45, 0.55), {steps: 6});
        await p.mouse.up();
        await p.waitForSelector("#ta-frame-measure .dt-inspector-histogram", {timeout: 30000});
        await p.mouse.move(...at(0.6, 0.4));
        await p.waitForTimeout(500);
        return p;
    },
    "frame-measure-again": async (p, env) => {
        // The same frame measured again with another emissivity, beside it, the cursor's two temperatures read
        await p.setViewportSize({width: SIZE.width, height: 1000});
        await openFrame(p, env);
        await p.fill('#ta-frame-params input[name="emissivity"]', "0.8");
        await p.click("#ta-frame-apply");
        await p.waitForSelector("#ta-frame-pane-1:not([hidden]) canvas", {timeout: 30000});
        await p.waitForTimeout(1500);
        await p.locator('[data-section="params"]').scrollIntoViewIfNeeded();
        const frame = await p.locator("#ta-frame-map-0").boundingBox();
        await p.mouse.move(frame.x + frame.width * 0.4, frame.y + frame.height * 0.45);
        await p.waitForTimeout(500);
        return p;
    },
    "inspector": async (p, env) => {
        await p.setViewportSize({width: SIZE.width, height: 1100});    // room for a region's statistics
        await p.goto(env.url + need(env, "DT_DOCS_MAP"));
        await p.waitForSelector(".dt-inspector-button", {timeout: 30000});
        await p.waitForTimeout(3000);
        await p.click(".dt-inspector-button");
        const map = await p.locator(".leaflet-container").first().boundingBox();
        const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
        await p.click('.dt-inspector-modes [data-mode="pin"]');
        await p.mouse.click(...at(0.45, 0.4));
        await p.waitForTimeout(1000);
        // The pin opens the frames that saw it (a task processed from a workset): closed, off the region's place
        await p.click('.dt-inspector-frames [data-pip="close"]', {timeout: 5000}).catch(() => {});
        await p.click('.dt-inspector-modes [data-mode="rectangle"]');
        await p.mouse.move(...at(0.5, 0.5));
        await p.mouse.down();
        await p.mouse.move(...at(0.6, 0.62), {steps: 8});
        await p.mouse.up();
        await p.waitForSelector(".dt-inspector-histogram", {timeout: 30000});
        await p.click('.dt-inspector-modes [data-mode="hover"]');
        await p.mouse.move(...at(0.4, 0.55));
        await p.waitForTimeout(1500);
        await p.locator(".dt-inspector-shown").scrollIntoViewIfNeeded();
        await p.waitForTimeout(300);
        return p;
    },
    "inspector-line": async (p, env) => {
        // A line across the map's thermal orthophoto, its profile hovered: the point found on the map
        await p.setViewportSize({width: SIZE.width, height: 1100});    // room for its statistics and profile
        await p.goto(env.url + need(env, "DT_DOCS_MAP"));
        await p.waitForSelector(".dt-inspector-button", {timeout: 30000});
        await p.waitForTimeout(3000);
        await p.click(".dt-inspector-button");
        const map = await p.locator(".leaflet-container").first().boundingBox();
        const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
        await p.click('.dt-inspector-modes [data-mode="line"]');
        await p.mouse.click(...at(0.3, 0.5));
        await p.waitForTimeout(300);
        await p.mouse.dblclick(...at(0.55, 0.6));
        await p.waitForSelector(".dt-inspector-profile svg", {timeout: 30000});
        await p.locator(".dt-inspector-profile svg").scrollIntoViewIfNeeded();
        const profile = await p.locator(".dt-inspector-profile svg").boundingBox();
        await p.mouse.move(profile.x + profile.width * 0.6, profile.y + profile.height / 2);
        await p.waitForTimeout(1000);
        return p;
    },
    "inspector-image": async (p, env) => {
        // The colour scale and the Image section under Palette: the contrast raised, gamma above 1 and some sharpening
        // (not Equalized: its histogram would be kept on the server, and the script stays read only)
        await p.setViewportSize({width: SIZE.width, height: 1100});
        await p.goto(env.url + need(env, "DT_DOCS_MAP"));
        await p.waitForSelector(".dt-inspector-button", {timeout: 30000});
        await p.waitForTimeout(3000);
        await p.click(".dt-inspector-button");
        await p.click('[data-act="range-auto"]');
        const set = (act, value) => p.$eval('[data-act="' + act + '"]', (e, v) => {
            e.value = v;
            e.dispatchEvent(new Event("change", {bubbles: true}));
        }, value);
        await set("image-contrast", "0.5");
        await set("image-gamma", "0.6");
        await set("image-sharpen", "1");
        await p.waitForTimeout(4000);
        return p;
    },
    "inspector-saved": async (p, env) => {
        // A region on the map's thermal orthophoto measured with the correction on, and its Save form filled in (not
        // sent: the script stays read only)
        await p.setViewportSize({width: SIZE.width, height: 1100});
        await p.goto(env.url + need(env, "DT_DOCS_MAP"));
        await p.waitForSelector(".dt-inspector-button", {timeout: 30000});
        await p.waitForTimeout(3000);
        await p.click(".dt-inspector-button");
        const map = await p.locator(".leaflet-container").first().boundingBox();
        await p.click('.dt-inspector-modes [data-mode="rectangle"]');
        await p.mouse.move(map.x + map.width * 0.35, map.y + map.height * 0.4);
        await p.mouse.down();
        await p.mouse.move(map.x + map.width * 0.45, map.y + map.height * 0.5, {steps: 5});
        await p.mouse.up();
        await p.waitForSelector(".dt-inspector-shown .dt-inspector-stats", {timeout: 30000});
        await p.check('[data-act="correction-on"]');
        await p.fill('[data-act="correction-emissivity"]', "0.95");
        await p.press('[data-act="correction-emissivity"]', "Tab");
        await p.waitForTimeout(3000);
        await p.click('[data-region] [data-act="save"]');
        await p.fill('[data-form="name"]', "Warm roof section");
        await p.fill('[data-form="comment"]', "Check the insulation above the boiler");
        await p.locator(".dt-inspector-form").scrollIntoViewIfNeeded();
        await p.waitForTimeout(500);
        return p;
    },
    "inspector-frames": async (p, env) => {
        // The frames that saw a point clicked on the map's thermal orthophoto (its task processed from a workset)
        await p.setViewportSize({width: SIZE.width, height: 1100});    // room for the window, down to Open this frame
        await p.goto(env.url + need(env, "DT_DOCS_MAP"));
        await p.waitForSelector(".dt-inspector-button", {timeout: 30000});
        await p.waitForTimeout(3000);
        await p.click(".dt-inspector-button");
        const map = await p.locator(".leaflet-container").first().boundingBox();
        await p.mouse.click(map.x + map.width * 0.4, map.y + map.height * 0.55);
        await p.waitForSelector(".dt-inspector-frames:not([hidden]) img", {timeout: 30000})
            .catch(() => { throw new Error("no source frames: is DT_DOCS_MAP's task processed from a workset with mosaics?"); });
        await p.waitForTimeout(2000);
        return p;
    },
    "inspector-mosaics": async (p, env) => {
        // WebODM's map of the dataset's project, its first workset's mosaic laid by the link, swiped against the
        // project's own layers
        const dataset = need(env, "DT_DOCS_DATASET");
        const d = await p.evaluate(async (id) => (await fetch("/api/plugins/dji-thermal/datasets/" + id)).json(), dataset);
        const list = await p.evaluate(async (id) => (await fetch("/api/plugins/dji-thermal/datasets/" + id + "/conversions")).json(), dataset);
        const conversion = (list.conversions || list).filter((c) => c.mosaic_status === "ready")[0];
        await p.goto(env.url + "/map/project/" + d.project.id + "/?dt-mosaic=" + dataset + "/" + conversion.id + "/harmonized");
        await p.waitForSelector(".dt-inspector-mosaic input:checked", {timeout: 30000});
        await p.click('[data-act="mosaic-swipe"]');
        await p.waitForTimeout(3000);
        const map = await p.locator(".leaflet-container").first().boundingBox();
        await p.mouse.move(map.x + map.width * 0.6, map.y + map.height * 0.5);
        await p.waitForTimeout(1500);
        return p;
    },
    "dji-sdk": async (p, env) => {
        await p.goto(env.url + "/plugins/dji-thermal/sdk/");
        await p.waitForLoadState("networkidle");
        return p;
    },
};

async function openDataset(p, env) {
    await p.goto(env.url + "/plugins/dji-thermal/dataset/" + need(env, "DT_DOCS_DATASET"));
    await p.waitForSelector(".ta-conversion");
    await p.waitForTimeout(1000);
}

// The dataset's first workset with mosaics, on its mosaic viewer page
async function openViewer(p, env) {
    const dataset = need(env, "DT_DOCS_DATASET");
    const list = await p.evaluate(async (d) => (await fetch("/api/plugins/dji-thermal/datasets/" + d + "/conversions")).json(), dataset);
    const conversion = (list.conversions || list)[0];
    await p.goto(env.url + "/plugins/dji-thermal/dataset/" + dataset + "/conversion/" + conversion.id);
    await p.waitForSelector("#ta-viewer-map .leaflet-tile-loaded", {timeout: 60000});
    await p.waitForTimeout(2000);
}

// The frame page of the dataset's first workset, at its first frame
async function openFrame(p, env) {
    const dataset = need(env, "DT_DOCS_DATASET");
    const list = await p.evaluate(async (d) => (await fetch("/api/plugins/dji-thermal/datasets/" + d + "/conversions")).json(), dataset);
    const conversion = (list.conversions || list)[0];
    await p.goto(env.url + "/plugins/dji-thermal/dataset/" + dataset + "/conversion/" + conversion.id + "/frame");
    await p.waitForSelector("#ta-frame-map-0 canvas", {timeout: 60000});
    await p.waitForTimeout(2000);
}

async function hoverMap(p) {
    const box = await p.locator("#ta-viewer-map").boundingBox();
    await p.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await p.waitForTimeout(1500);
}

// Hides what gives a place away (the detail pane's latitude and longitude) and the camera's serial number, then
// refuses the shot if the page still shows a number that looks like a coordinate
async function hidePrivate(p) {
    await p.evaluate((serial) => {
        document.querySelectorAll(".ta-file-detail tr").forEach((tr) => {
            const label = tr.firstElementChild && tr.firstElementChild.textContent.trim();
            if (label === "Latitude" || label === "Longitude") tr.lastElementChild.textContent = "(hidden here)";
        });
        const re = new RegExp(serial, "g");
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, "SN (hidden here)");
            re.lastIndex = 0;
        }
        window.getSelection().removeAllRanges();     // a drag on a map can select the page's text
    }, SERIAL.source);
    const text = await p.evaluate(() => document.body.innerText);
    const m = text.match(COORDINATE);
    if (m) throw new Error("the page shows " + m[0] + ", which looks like a coordinate: not shot");
}

// The window, or an element with a margin around it (from the whole page, so a tall one is shot whole)
async function shoot(p, target, file) {
    if (target === p) return p.screenshot({path: file, animations: "disabled"});
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const page = await p.evaluate(() => ({x: window.scrollX, y: window.scrollY, w: document.documentElement.scrollWidth}));
    const x = Math.max(0, box.x + page.x - MARGIN), y = Math.max(0, box.y + page.y - MARGIN);
    const clip = {x: x, y: y, width: Math.min(page.w - x, box.width + 2 * MARGIN), height: box.height + 2 * MARGIN};
    return p.screenshot({path: file, clip: clip, fullPage: true, animations: "disabled"});
}

(async () => {
    const env = readEnv();
    env.url = (env.DT_DOCS_URL || "http://localhost:8002").replace(/\/$/, "");
    const origin = new URL(env.url).origin;
    const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
    const unknown = names.filter((n) => !SHOTS[n]);
    if (unknown.length) throw new Error("No such shot: " + unknown.join(", ") + ". The shots: " + Object.keys(SHOTS).join(", "));
    fs.mkdirSync(OUT, {recursive: true});

    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: SIZE});     // a fresh profile, gone when it closes
    const p = await context.newPage();
    const blocked = [], errors = [];
    await p.route("**/*", (route) => {
        const req = route.request(), url = req.url();
        const allowed = url.startsWith(origin) && (req.method() === "GET" || POSTS.some((re) => re.test(url.split("?")[0])));
        if (allowed) return route.continue();
        if (url.startsWith(origin)) blocked.push(req.method() + " " + url);
        return route.abort();
    });
    p.on("pageerror", (e) => errors.push(e.message));

    await p.goto(env.url + "/login/");
    await p.fill("input[name=username]", need(env, "DT_DOCS_USER"));
    await p.fill("input[name=password]", need(env, "DT_DOCS_PASSWORD"));
    await Promise.all([p.waitForNavigation(), p.click("button[type=submit], input[type=submit]")]);
    if (p.url().includes("/login")) throw new Error("The login failed: check DT_DOCS_USER and DT_DOCS_PASSWORD");

    let failed = 0;
    for (const name of names) {
        const file = path.join(OUT, name + ".png");
        try {
            // Each shot as a first visit: nothing kept from the shots before it (open sections, pins, regions)
            await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
            await p.setViewportSize(SIZE);
            const target = await SHOTS[name](p, env);
            await hidePrivate(p);
            await shoot(p, target, file);
            console.log("docs/images/" + name + ".png");
        } catch (e) {
            failed++;
            console.error(name + ": " + e.message.split("\n")[0]);
        }
        await p.keyboard.press("Escape").catch(() => {});
    }
    if (blocked.length) console.log("Blocked (not sent):\n  " + blocked.join("\n  "));
    if (errors.length) console.log("Page errors:\n  " + errors.join("\n  "));
    await browser.close();
    process.exitCode = failed ? 1 : 0;
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
