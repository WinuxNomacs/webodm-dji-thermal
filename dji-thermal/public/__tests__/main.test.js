// main.js as WebODM loads it on every page: the Thermal Task button, and the DJI Thermal page under Administration

function sideMenu(staff){
    document.body.innerHTML = '<ul id="side-menu"><li><a href="/dashboard/">Dashboard</a></li>' +
        (staff ? '<li><a href="#">Administration</a><ul class="nav nav-second-level">' +
                 '<li><a href="/admin/app/plugin/">Plugins</a></li><li><a href="/admin/app/basemap/">Basemaps</a></li>' +
                 '</ul></li>' : '') + '</ul>';
}

function loadMain(){
    global.PluginsAPI = {Dashboard: {addNewTaskButton: jest.fn()}};
    jest.isolateModules(() => require("../main.js"));
}

function menuLabels(){
    return Array.from(document.querySelectorAll("#side-menu a")).map(a => a.textContent.trim());
}

test("the DJI Thermal page is linked under Administration, after Plugins", () => {
    sideMenu(true);
    loadMain();
    expect(menuLabels()).toEqual(["Dashboard", "Administration", "Plugins", "DJI Thermal", "Basemaps"]);
    expect(document.querySelector("#dji-thermal-admin-menu a").getAttribute("href")).toBe("/plugins/dji-thermal/");
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
