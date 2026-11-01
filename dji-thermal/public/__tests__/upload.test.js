import ThermalUpload, { NO_IMAGES, taskData } from "../thermal/upload";

// jsdom's File has no text()
function readText(file){
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(file);
    });
}

const TASK_INFO = {name: "Thermal - 10/12/2026", options: [{name: "fast-orthophoto", value: true}],
                   selectedNode: {id: 1, key: 1}, alignTo: "auto"};

function photo(name){
    return new File(["thermal"], name);
}

// The server's answers by photo name: {status, image, reason}, or an Error for a request that fails
function fakeApi(answers = {}){
    const api = {
        calls: [],
        createTask: jest.fn(() => Promise.resolve({id: "t1"})),
        convert: jest.fn((projectId, taskId, file) => {
            api.calls.push(file.name);
            const answer = answers[file.name] || {status: "converted", image: file.name.replace(/\.JPG$/, ".tif")};
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        }),
        uploadFiles: jest.fn(() => Promise.resolve({})),
        commit: jest.fn(() => Promise.resolve({id: "t1", partial: false})),
        removeTask: jest.fn(() => Promise.resolve())
    };
    return api;
}

function upload(api, photos, more = {}){
    return new ThermalUpload(Object.assign({projectId: 7, taskInfo: TASK_INFO, photos, measurement: {unit: "C", distance: "lrf"},
                                            api, concurrency: 2}, more));
}

describe("a thermal task's upload", () => {
    test("the task is created as WebODM's own upload does, without resizing, with the plugin's hidden tag", () => {
        expect(taskData(TASK_INFO)).toEqual({name: TASK_INFO.name, options: TASK_INFO.options, processing_node: 1,
                                             auto_processing_node: false, partial: true, align_to: "auto",
                                             tags: [".dji-thermal-task"]});
    });

    test("every photo is converted with the measurement values, then the task is committed", async () => {
        const api = fakeApi();
        const progress = [];
        const photos = ["DJI_0001_T.JPG", "DJI_0002_T.JPG", "DJI_0003_T.JPG"].map(photo);
        const result = await upload(api, photos, {onProgress: p => progress.push(p.done)}).start();

        expect(api.createTask).toHaveBeenCalledWith(7, expect.objectContaining({partial: true}));
        expect(api.calls.sort()).toEqual(["DJI_0001_T.JPG", "DJI_0002_T.JPG", "DJI_0003_T.JPG"]);
        expect(api.convert.mock.calls[0][3]).toEqual({unit: "C", distance: "lrf"});
        expect(api.commit).toHaveBeenCalledWith(7, "t1");
        expect(api.uploadFiles).not.toHaveBeenCalled();
        expect(result.converted.sort()).toEqual(["DJI_0001_T.tif", "DJI_0002_T.tif", "DJI_0003_T.tif"]);
        expect(progress).toEqual([1, 2, 3]);
    });

    test("a photo ignored or failed stays out with its reason, and the others make the task", async () => {
        const api = fakeApi({"DJI_0002_V.JPG": {status: "ignored", reason: "not a DJI thermal image"},
                             "DJI_0003_T.JPG": {status: "failed", reason: "bad thermal block"},
                             "DJI_0004_T.JPG": new Error("502 Bad Gateway")});
        const photos = ["DJI_0001_T.JPG", "DJI_0002_V.JPG", "DJI_0003_T.JPG", "DJI_0004_T.JPG"].map(photo);
        const result = await upload(api, photos).start();

        expect(result.converted).toEqual(["DJI_0001_T.tif"]);
        expect(result.ignored).toEqual([{name: "DJI_0002_V.JPG", reason: "not a DJI thermal image"}]);
        expect(result.failed).toEqual([{name: "DJI_0003_T.JPG", reason: "bad thermal block"},
                                       {name: "DJI_0004_T.JPG", reason: "502 Bad Gateway"}]);
        expect(api.commit).toHaveBeenCalled();
        expect(api.removeTask).not.toHaveBeenCalled();
    });

    test("a task left with no image is removed and not committed", async () => {
        const api = fakeApi({"DJI_0001_T.JPG": {status: "failed", reason: "bad thermal block"}});
        await expect(upload(api, [photo("DJI_0001_T.JPG")]).start()).rejects.toThrow(NO_IMAGES);
        expect(api.removeTask).toHaveBeenCalledWith(7, "t1");
        expect(api.commit).not.toHaveBeenCalled();
    });

    test("the GCP file goes in with the converted photos' names changed to their images'", async () => {
        const api = fakeApi({"DJI_0002_T.JPG": {status: "failed", reason: "bad thermal block"}});
        const gcp = new File(["EPSG:4326\n1 2 3 4 5 DJI_0001_T.JPG\n1 2 3 4 5 DJI_0002_T.JPG\n"], "gcp_list.txt",
                             {type: "text/plain"});
        await upload(api, [photo("DJI_0001_T.JPG"), photo("DJI_0002_T.JPG")], {textFiles: [gcp]}).start();

        const [projectId, taskId, files] = api.uploadFiles.mock.calls[0];
        expect([projectId, taskId, files.map(f => f.name)]).toEqual([7, "t1", ["gcp_list.txt"]]);
        expect(await readText(files[0])).toBe("EPSG:4326\n1 2 3 4 5 DJI_0001_T.tif\n1 2 3 4 5 DJI_0002_T.JPG\n");
        expect(api.uploadFiles.mock.invocationCallOrder[0]).toBeLessThan(api.commit.mock.invocationCallOrder[0]);
    });

    test("canceling stops the conversions and removes the task", async () => {
        const api = fakeApi();
        const photos = ["DJI_0001_T.JPG", "DJI_0002_T.JPG", "DJI_0003_T.JPG", "DJI_0004_T.JPG"].map(photo);
        const u = upload(api, photos, {concurrency: 1, onProgress: () => u.cancel()});
        await expect(u.start()).rejects.toThrow("Canceled");
        expect(api.calls).toEqual(["DJI_0001_T.JPG"]);
        expect(api.removeTask).toHaveBeenCalledWith(7, "t1");
        expect(api.commit).not.toHaveBeenCalled();
    });

    test("a task that cannot be created leaves nothing to remove", async () => {
        const api = fakeApi();
        api.createTask = jest.fn(() => Promise.reject(new Error("Cannot reach the server")));
        await expect(upload(api, [photo("DJI_0001_T.JPG")]).start()).rejects.toThrow("Cannot reach the server");
        expect(api.convert).not.toHaveBeenCalled();
        expect(api.removeTask).not.toHaveBeenCalled();
    });
});
