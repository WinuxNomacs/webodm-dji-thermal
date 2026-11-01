// main.js as WebODM loads it on every page: the Thermal Task button, the Thermal dataset button on a task's panel, and
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
    global.React = {createElement: (type, props, ...children) => ({type, props, children})};
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

test("a task made from a workset links back to its dataset", () => {
    const button = taskButton({id: "11111111-2222-3333-4444-555555555555", tags: [".dji-thermal-from-" + DATASET]});
    expect(button.props.href).toBe("/plugins/dji-thermal/dataset/" + DATASET);
});

test("other tasks, and a tag naming no dataset, get no button", () => {
    expect(taskButton({id: DATASET, tags: ["survey"]})).toBeNull();
    expect(taskButton({id: DATASET})).toBeNull();
    expect(taskButton({id: DATASET, tags: [".dji-thermal-from-../../admin"]})).toBeNull();
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
