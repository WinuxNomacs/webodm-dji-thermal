import ThermalUpload, { GATEWAY_WAIT_MS, NO_IMAGES, RETRIES, leaveWarning, taskData } from "../thermal/upload";

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

// A request the server answered with an error status, or (without one) never answered
function failure(message, status){
    return Object.assign(new Error(message), {status});
}

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
        removeTask: jest.fn(() => Promise.resolve()),
        taskDataset: jest.fn(() => Promise.resolve({id: "d1"})),
        uploadToDataset: jest.fn(() => Promise.resolve({})),
        analyzeDataset: jest.fn(() => Promise.resolve({})),
        removeDataset: jest.fn(() => Promise.resolve()),
        startWorkset: jest.fn(() => Promise.resolve({id: "w1"}))
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
                             "DJI_0004_T.JPG": failure("500 Internal Server Error", 500)});
        const photos = ["DJI_0001_T.JPG", "DJI_0002_V.JPG", "DJI_0003_T.JPG", "DJI_0004_T.JPG"].map(photo);
        const result = await upload(api, photos).start();

        expect(result.converted).toEqual(["DJI_0001_T.tif"]);
        expect(result.ignored).toEqual([{name: "DJI_0002_V.JPG", reason: "not a DJI thermal image"}]);
        expect(result.failed).toEqual([{name: "DJI_0003_T.JPG", reason: "bad thermal block"},
                                       {name: "DJI_0004_T.JPG", reason: "500 Internal Server Error"}]);
        expect(api.commit).toHaveBeenCalled();
        expect(api.removeTask).not.toHaveBeenCalled();
    });

    test("a photo the server never answered is sent again, and fails with the reason once it never answers", async () => {
        const api = fakeApi({"DJI_0002_T.JPG": failure("The server did not answer in time")});
        let dropped = 1;
        const convert = api.convert;
        api.convert = jest.fn((projectId, taskId, file, fields) => file.name === "DJI_0001_T.JPG" && dropped-- > 0 ?
            Promise.reject(failure("Cannot reach the server")) : convert(projectId, taskId, file, fields));
        const result = await upload(api, ["DJI_0001_T.JPG", "DJI_0002_T.JPG"].map(photo)).start();

        expect(result.converted).toEqual(["DJI_0001_T.tif"]);
        expect(result.failed).toEqual([{name: "DJI_0002_T.JPG", reason: "The server did not answer in time"}]);
        expect(api.calls.filter(n => n === "DJI_0002_T.JPG")).toHaveLength(1 + RETRIES);
        expect(api.convert.mock.calls.filter(c => c[2].name === "DJI_0001_T.JPG")).toHaveLength(2);
    });

    test("normalized, a batch of photos the server never answered is sent again instead of removing the task", async () => {
        const api = fakeApi();
        api.uploadToDataset = jest.fn()
            .mockImplementationOnce(() => Promise.reject(failure("The server did not answer in time")))
            .mockImplementation(() => Promise.resolve({}));
        const result = await upload(api, [photo("DJI_0001_T.JPG")], {frames: {normalize: true}}).start();

        expect(api.uploadToDataset).toHaveBeenCalledTimes(2);
        expect(api.removeTask).not.toHaveBeenCalled();
        expect(result).toMatchObject({workset: "w1"});
    });

    test("a batch WebODM's proxy answered for (WebODM restarting) is sent again after a wait", async () => {
        const waits = [];
        const timer = jest.spyOn(global, "setTimeout").mockImplementation((f, ms) => { waits.push(ms); f(); return 0; });
        try {
            const api = fakeApi();
            api.uploadToDataset = jest.fn()
                .mockImplementationOnce(() => Promise.reject(failure("502 Bad Gateway", 502)))
                .mockImplementationOnce(() => Promise.reject(failure("503 Service Unavailable", 503)))
                .mockImplementation(() => Promise.resolve({}));
            const result = await upload(api, [photo("DJI_0001_T.JPG")], {frames: {normalize: true}}).start();
            expect(api.uploadToDataset).toHaveBeenCalledTimes(3);
            expect(waits).toEqual([GATEWAY_WAIT_MS, 2 * GATEWAY_WAIT_MS]);
            expect(api.removeTask).not.toHaveBeenCalled();
            expect(result).toMatchObject({workset: "w1"});
        } finally { timer.mockRestore(); }
    });

    test("a batch the server refused is not sent again", async () => {
        const api = fakeApi();
        api.uploadToDataset = jest.fn(() => Promise.reject(failure("Over quota", 400)));
        await expect(upload(api, [photo("DJI_0001_T.JPG")], {frames: {normalize: true}}).start()).rejects.toThrow("Over quota");
        expect(api.uploadToDataset).toHaveBeenCalledTimes(1);
        expect(api.removeTask).toHaveBeenCalledWith(7, "t1");
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

    test("without keeping the photos, no dataset is made", async () => {
        const api = fakeApi();
        const result = await upload(api, [photo("DJI_0001_T.JPG")], {otherPhotos: [photo("DJI_0001_V.JPG")]}).start();
        expect(api.taskDataset).not.toHaveBeenCalled();
        expect(api.uploadToDataset).not.toHaveBeenCalled();
        expect(result.dataset).toBeNull();
    });

    test("keeping the photos links a dataset first, keeps each photo with its conversion, uploads the others, then analyzes it", async () => {
        const api = fakeApi();
        const others = [photo("DJI_0001_V.JPG"), photo("notes.pdf")]
            .concat(Array.from({length: 11}, (_, i) => photo("DJI_01" + String(i).padStart(2, "0") + "_V.JPG")));
        const result = await upload(api, [photo("DJI_0001_T.JPG"), photo("DJI_0002_T.JPG")],
                                    {keepPhotos: true, otherPhotos: others}).start();

        expect(api.taskDataset).toHaveBeenCalledWith(7, "t1");
        expect(api.convert.mock.calls.map(c => c[3])).toEqual([{unit: "C", distance: "lrf", dataset: "d1"},
                                                               {unit: "C", distance: "lrf", dataset: "d1"}]);
        const batches = api.uploadToDataset.mock.calls;
        expect(batches.map(c => c[0])).toEqual(["d1", "d1"]);
        expect(batches.map(c => c[1].length)).toEqual([10, 2]);     // the 12 JPEGs, not the PDF
        expect(api.commit.mock.invocationCallOrder[0]).toBeGreaterThan(api.uploadToDataset.mock.invocationCallOrder[1]);
        expect(api.analyzeDataset).toHaveBeenCalledWith("d1");
        expect(result).toMatchObject({dataset: "d1", analysisError: ""});
    });

    test("a dataset whose analysis could not start is kept with the task, and says why", async () => {
        const api = fakeApi();
        api.analyzeDataset = jest.fn(() => Promise.reject(new Error("Over quota")));
        const result = await upload(api, [photo("DJI_0001_T.JPG")], {keepPhotos: true}).start();
        expect(result).toMatchObject({dataset: "d1", analysisError: "Over quota"});
        expect(api.removeDataset).not.toHaveBeenCalled();
        expect(api.removeTask).not.toHaveBeenCalled();
    });

    test("a failed upload removes the dataset with the task", async () => {
        const api = fakeApi({"DJI_0001_T.JPG": {status: "ignored", reason: "not a DJI thermal image"}});
        await expect(upload(api, [photo("DJI_0001_T.JPG")], {keepPhotos: true}).start()).rejects.toThrow(NO_IMAGES);
        expect(api.removeDataset).toHaveBeenCalledWith("d1");
        expect(api.removeTask).toHaveBeenCalledWith(7, "t1");
        expect(api.commit).not.toHaveBeenCalled();
    });

    test("normalized, every photo goes to the task's dataset and the server converts them in a workset, without converting or committing here", async () => {
        const api = fakeApi();
        const progress = [];
        const gcp = new File(["EPSG:4326\n0.50 0.60 223.8 320 256 DJI_0001_T.JPG gcp1\n"], "gcp_list.txt");
        const thermal = Array.from({length: 11}, (_, i) => photo("DJI_00" + String(i + 1).padStart(2, "0") + "_T.JPG"));
        const result = await upload(api, thermal, {frames: {normalize: true}, textFiles: [gcp], otherPhotos: [photo("DJI_0001_V.JPG")],
                                                   onProgress: p => progress.push(p.done)}).start();

        expect(api.taskDataset).toHaveBeenCalledWith(7, "t1");
        expect(api.uploadToDataset.mock.calls.map(c => c[1].length)).toEqual([10, 2]);
        expect(progress).toEqual([10, 12]);
        expect(await readText(api.uploadFiles.mock.calls[0][2][0])).toContain("DJI_0001_T_temp_c.tiff gcp1");
        expect(api.startWorkset).toHaveBeenCalledWith(7, "t1", {unit: "C", distance: "lrf", normalize: true, harmonize: false, mosaics: false,
                                                               max_pitch: null}, {plan_options: false, frames: 11});
        expect(api.convert).not.toHaveBeenCalled();
        expect(api.commit).not.toHaveBeenCalled();
        expect(result).toMatchObject({dataset: "d1", workset: "w1", frames: {normalize: true, harmonize: false}, total: 12, thermal: 11});
    });

    test("normalized, every photo is uploaded, the workset is given the pitch limit and the frames it keeps, and the plan's options asked for", async () => {
        const api = fakeApi();
        const thermal = [photo("DJI_0001_T.JPG"), photo("DJI_0002_T.JPG"), photo("DJI_0003_T.JPG")];
        const pitches = new Map([[thermal[0], -90], [thermal[1], -45], [thermal[2], null]]);
        const job = upload(api, thermal, {frames: {harmonize: true}, maxPitch: -80, pitches, planOptions: true,
                                          otherPhotos: [photo("DJI_0001_V.JPG")]});
        expect(job.initialProgress()).toMatchObject({done: 0, total: 4, uploading: true});
        const result = await job.start();
        expect(api.uploadToDataset.mock.calls[0][1].map(f => f.name)).toEqual(["DJI_0001_T.JPG", "DJI_0002_T.JPG", "DJI_0003_T.JPG", "DJI_0001_V.JPG"]);
        expect(api.startWorkset.mock.calls[0][2]).toMatchObject({max_pitch: -80, harmonize: true});
        // A photo whose pitch isn't known is kept, as the workset does
        expect(api.startWorkset.mock.calls[0][3]).toEqual({plan_options: true, frames: 2});
        expect(result).toMatchObject({thermal: 2, oblique: 1});
    });

    test("as is, the oblique photos are not converted but go to the dataset with the other photos", async () => {
        const api = fakeApi();
        const thermal = [photo("DJI_0001_T.JPG"), photo("DJI_0002_T.JPG"), photo("DJI_0003_T.JPG")];
        const pitches = new Map([[thermal[0], -90], [thermal[1], -45], [thermal[2], -85]]);
        const job = upload(api, thermal, {keepPhotos: true, maxPitch: -80, pitches, otherPhotos: [photo("DJI_0001_V.JPG")]});
        expect(job.initialProgress()).toMatchObject({done: 0, total: 2});
        const result = await job.start();
        expect(api.calls.sort()).toEqual(["DJI_0001_T.JPG", "DJI_0003_T.JPG"]);
        expect(api.uploadToDataset.mock.calls[0][1].map(f => f.name)).toEqual(["DJI_0002_T.JPG", "DJI_0001_V.JPG"]);
        expect(result).toMatchObject({oblique: 1, total: 2});
        // No limit: every photo
        const all = fakeApi();
        await upload(all, thermal, {pitches}).start();
        expect(all.calls.length).toBe(3);
    });

    test("the workset's mosaics are asked for when ticked, and only for a normalized task", async () => {
        const api = fakeApi();
        await upload(api, [photo("DJI_0001_T.JPG")], {frames: {harmonize: true, mosaics: true}}).start();
        expect(api.startWorkset.mock.calls[0][2]).toMatchObject({normalize: true, harmonize: true, mosaics: true});
        expect(upload(api, [photo("DJI_0001_T.JPG")], {frames: {mosaics: true}}).frames.mosaics).toBe(false);
    });

    test("harmonize normalizes too, and a workset that cannot start removes the task and its dataset", async () => {
        const api = fakeApi();
        api.startWorkset = jest.fn(() => Promise.reject(new Error("Over quota")));
        await expect(upload(api, [photo("DJI_0001_T.JPG")], {frames: {harmonize: true}}).start()).rejects.toThrow("Over quota");
        expect(api.startWorkset.mock.calls[0][2]).toMatchObject({normalize: true, harmonize: true});
        expect(api.removeDataset).toHaveBeenCalledWith("d1");
        expect(api.removeTask).toHaveBeenCalledWith(7, "t1");
    });
});

test("leaving the page asks first while the photos go up, and not otherwise", () => {
    let busy = true;
    const warn = leaveWarning(() => busy);
    const leaving = () => {
        const e = new Event("beforeunload", {cancelable: true});
        warn(e);
        return e.defaultPrevented;
    };
    expect(leaving()).toBe(true);
    busy = false;
    expect(leaving()).toBe(false);
});
