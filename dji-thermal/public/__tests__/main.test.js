// main.js as WebODM loads it on every page: the Thermal Task button, the Thermal dataset and Create thermal dataset
// buttons on a task's panel, and
// the DJI Thermal page under Administration

function sideMenu(staff){
    document.body.innerHTML = '<ul id="side-menu"><li><a href="/dashboard/">Dashboard</a></li>' +
        (staff ? '<li><a href="#">Administration</a><ul class="nav nav-second-level">' +
                 '<li><a href="/admin/app/plugin/">Plugins</a></li><li><a href="/admin/app/basemap/">Basemaps</a></li>' +
                 '</ul></li>' : '') + '</ul>';
}

function loadMain(){
    global.PluginsAPI = {Dashboard: {addNewTaskButton: jest.fn(), addTaskActionButton: jest.fn()},
                         Map: {willAddControls: jest.fn()}};
    global.React = {createElement: (type, props, ...children) => ({type, props, children}), Component: function(props){ this.props = props; }};
    jest.isolateModules(() => require("../main.js"));
}

function menuLabels(){
    return Array.from(document.querySelectorAll("#side-menu a")).map(a => a.textContent.trim());
}

test("the DJI Thermal page is linked under Administration, after Plugins", () => {
    sideMenu(true);
    loadMain();
    expect(menuLabels()).toEqual(["Dashboard", "Administration", "Plugins", "DJI Thermal", "Basemaps"]);
    expect(document.querySelector("#dji-thermal-admin-menu a").getAttribute("href")).toBe("/plugins/dji-thermal/sdk/");
});

test("users without the Administration menu get no link to the page", () => {
    sideMenu(false);
    loadMain();
    expect(menuLabels()).toEqual(["Dashboard"]);
});

test("the Thermal Task button is added to the dashboard", () => {
    sideMenu(false);
    loadMain();
    expect(global.PluginsAPI.Dashboard.addNewTaskButton).toHaveBeenCalledTimes(1);
});

const DATASET = "0f1e2d3c-4b5a-4697-8877-665544332211";

function taskButton(task){
    sideMenu(false);
    loadMain();
    return global.PluginsAPI.Dashboard.addTaskActionButton.mock.calls[0][0]({task});
}

test("a dataset's own task gets a Thermal dataset button to the dataset", () => {
    const button = taskButton({id: DATASET, tags: ["survey", ".dji-thermal-dataset"]});
    expect(button.type).toBe("a");
    expect(button.props.href).toBe("/plugins/dji-thermal/dataset/" + DATASET);
    expect(button.props.className).toBe("btn btn-sm btn-primary");
    expect(button.children[1]).toBe(" Thermal dataset");
});

test("a DJI Thermal Task's partial task shows its workset's progress in its panel, until it is committed", () => {
    sideMenu(false);
    loadMain();
    const add = global.PluginsAPI.Dashboard.addTaskActionButton.mock.calls[1][0];
    const progress = add({task: {id: DATASET, project: 12, partial: true, tags: [".dji-thermal-task", ".dji-thermal-dataset"]}});
    expect(progress.props).toEqual({projectId: 12, taskId: DATASET});
    expect(add({task: {id: DATASET, project: 12, partial: false, tags: [".dji-thermal-task"]}})).toBe(null);
    expect(add({task: {id: DATASET, project: 12, partial: true, tags: []}})).toBe(null);
});

test("a panel's component from a bundle is answered at once and shown once the bundle is loaded", async () => {
    sideMenu(false);
    loadMain();
    function Loaded(){}
    global.PluginsAPI.SystemJS = {import: jest.fn(() => Promise.resolve({default: Loaded}))};
    const Lazy = window.DjiThermalLazy("dji-thermal/build/X.js");
    const shown = new Lazy({taskId: "t"});
    shown.setState = function(s){ Object.assign(this.state, s); };
    expect(shown.render()).toBe(null);
    await shown.componentDidMount();
    expect(global.PluginsAPI.SystemJS.import).toHaveBeenCalledWith("dji-thermal/build/X.js");
    expect(shown.render()).toEqual({type: Loaded, props: {taskId: "t"}, children: []});
});

test("a task made from a workset links back to its dataset", () => {
    const button = taskButton({id: "11111111-2222-3333-4444-555555555555", tags: [".dji-thermal-from-" + DATASET]});
    expect(button.props.href).toBe("/plugins/dji-thermal/dataset/" + DATASET);
});

test("other tasks, and a tag naming no dataset, get no button", () => {
    expect(taskButton({id: DATASET, tags: ["survey"]})).toBeNull();
    expect(taskButton({id: DATASET})).toBeNull();
    expect(taskButton({id: DATASET, tags: [".dji-thermal-from-../../admin"]})).toBeNull();
});

const TASK = "11111111-2222-3333-4444-555555555555";

test("a task made by the Thermal Task button, or with a thermal orthophoto, and no dataset gets Create thermal dataset", () => {
    for (const task of [{id: TASK, project: 3, tags: [".dji-thermal-task"]},
                        {id: TASK, project: 3, tags: [], orthophoto_bands: [{description: "lwir"}]}]){
        const button = taskButton(task);
        expect(button.type).toBe("button");
        expect(button.children[1]).toBe(" Create thermal dataset");
    }
    expect(taskButton({id: TASK, project: 3, orthophoto_bands: [{description: "red"}, {description: "green"}]})).toBeNull();
    expect(taskButton({id: TASK, project: 3, tags: [".dji-thermal-task", ".dji-thermal-from-" + DATASET]}).props.href)
        .toBe("/plugins/dji-thermal/dataset/" + DATASET);
});

describe("Create thermal dataset", () => {
    let assign;
    beforeEach(() => {
        assign = jest.fn();
        window.alert = jest.fn();
        document.cookie = "csrftoken=tok";
    });

    function click(answer){
        global.fetch = jest.fn(() => Promise.resolve(answer));
        const button = taskButton({id: TASK, project: 3, tags: [".dji-thermal-task"]});
        window.DjiThermalTaskDataset.open = assign;
        const el = document.createElement("button");
        button.props.onClick({currentTarget: el});
        return {el, done: () => new Promise(r => setTimeout(r, 0))};
    }

    test("makes the task's dataset on the server, then opens its page", async () => {
        const {el, done} = click({ok: true, status: 201, json: () => Promise.resolve({id: DATASET})});
        expect(el.disabled).toBe(true);
        await done();
        expect(global.fetch).toHaveBeenCalledWith("/api/plugins/dji-thermal/projects/3/tasks/" + TASK + "/dataset",
            {method: "POST", credentials: "same-origin", headers: {"X-CSRFToken": "tok"}});
        expect(assign).toHaveBeenCalledWith("/plugins/dji-thermal/dataset/" + DATASET);
    });

    test("a refusal is said, and the button can be pressed again", async () => {
        const {el, done} = click({ok: false, status: 400, json: () => Promise.resolve({detail: "Over quota"})});
        await done();
        expect(assign).not.toHaveBeenCalled();
        expect(window.alert).toHaveBeenCalledWith("Could not create the thermal dataset: Over quota");
        expect(el.disabled).toBe(false);
    });
});

test("the Thermal Inspector is added to every map, with WebODM's Leaflet (its button shows when it has something to inspect)", () => {
    sideMenu(false);
    loadMain();
    const [deps, add] = global.PluginsAPI.Map.willAddControls.mock.calls[0];
    expect(deps).toEqual(["leaflet", "dji-thermal/inspector.css", "dji-thermal/frames.css"]);
    window.ThermalInspector = {create: jest.fn()};
    add({tiles: []}, "L");
    expect(window.ThermalInspector.create).toHaveBeenCalledWith({tiles: []}, "L");
    delete window.ThermalInspector;
});
