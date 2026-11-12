// A thermal task's upload: WebODM's API creates a partial task, the plugin's converts each photo into it (a few at
// a time), the text files (GCP, geo.txt, image_groups.txt) go in with the photos' names changed to the images',
// and WebODM's API commits the task, which starts processing. A photo that is not a thermal image is ignored, one
// that fails stays out with its reason; a task left with no image is removed.
//
// With keepPhotos, the task is first made a DJI Thermal Analyzer dataset too, each photo's conversion also keeps it
// there (no second upload), the other photos (otherPhotos: the RGB ones, another camera's) are uploaded to it, and
// its analysis starts once the task is committed. The dataset goes with the task if the upload fails.
//
// Normalized or harmonized (frames), every photo is needed before any is converted: the task is made a dataset, the
// photos are uploaded to it, and the server converts them in a workset of the dataset (the panel's measurement values
// and frames settings), whose TIFFs then go into the task, which the server commits (api.py TaskWorkset), with the
// plan's options (planOptions) once it has analyzed the dataset.
//
// With maxPitch, only the photos at or below it go into the task: as is, the others are not converted (but kept in the
// dataset with the other photos); normalized, the workset leaves them out.
import { tiffName, withImagesRenamed, worksetTiffName } from './textFiles';
import { byPitch } from './plan';

// Photos converted at once: each is converted inside its request, so on a one-CPU server (WebODM starts 2 x CPUs + 1
// web workers) two leave one for every other page
export const CONCURRENCY = 2;
export const RETRIES = 2;           // times a request the server never answered is sent again
export const DATASET_BATCH = 10;    // other photos per request to the dataset, as the Analyzer's own upload

export const NO_IMAGES = "None of the photos could be converted: the task was not created.";

// The task's hidden tag (conversion_tasks.THERMAL_TASK_TAG): its panel then offers a dataset for its photos (main.js)
export const THERMAL_TASK_TAG = ".dji-thermal-task";

// A proxy's answer while WebODM restarts or is overloaded (502, 503, 504): as good as none, sent again after a wait
export const GATEWAY_STATUSES = [502, 503, 504];
export const GATEWAY_WAIT_MS = 3000;

// send() again when the server never answered it (dropped on the way, or timed out: no status), or its proxy answered
// for it, up to RETRIES times. Safe: every upload is kept by its name, a resent one replaces itself.
export function retried(send, attempt = 0){
    return send().catch(e => {
        const gateway = GATEWAY_STATUSES.indexOf(e.status) >= 0;
        if ((e.status && !gateway) || attempt >= RETRIES) throw e;
        const wait = gateway ? new Promise(resolve => setTimeout(resolve, GATEWAY_WAIT_MS * (attempt + 1))) : Promise.resolve();
        return wait.then(() => retried(send, attempt + 1));
    });
}

// A beforeunload handler that asks before the page is left while busy() (an upload running): leaving would stop it half
// way, a partial task left with some of the photos
export function leaveWarning(busy){
    return e => {
        if (!busy()) return undefined;
        e.preventDefault();
        e.returnValue = "";
        return "";
    };
}

// The fields of WebODM's task creation (as its own upload, without resizing)
export function taskData(taskInfo){
    return {
        name: taskInfo.name,
        options: taskInfo.options,
        processing_node: taskInfo.selectedNode.id,
        auto_processing_node: taskInfo.selectedNode.key == "auto",
        partial: true,
        align_to: taskInfo.alignTo,
        tags: [THERMAL_TASK_TAG]
    };
}

// api: the server calls (see serverApi.js), each returning a promise. onProgress({done, total, converted,
// ignored, failed, uploading}) after each photo. pitches: a Map of each photo's gimbal pitch (plan.gimbalPitch).
export default class ThermalUpload {
    constructor({projectId, taskInfo, photos, textFiles, measurement, api, onProgress, concurrency, keepPhotos, otherPhotos,
                 frames, maxPitch, pitches, planOptions}){
        this.projectId = projectId;
        this.taskInfo = taskInfo;
        this.textFiles = textFiles || [];
        this.measurement = measurement;
        this.api = api;
        this.onProgress = onProgress || (() => {});
        this.concurrency = concurrency || CONCURRENCY;
        this.keepPhotos = !!keepPhotos;
        const normalize = !!(frames && (frames.normalize || frames.harmonize));
        // mosaics: the workset's mosaics built once it is converted (api.py TaskWorkset)
        this.frames = {normalize, harmonize: !!(frames && frames.harmonize), mosaics: normalize && !!frames.mosaics};
        this.maxPitch = maxPitch === undefined ? null : maxPitch;
        this.planOptions = !!planOptions;
        const { kept, oblique } = byPitch(photos, pitches || new Map(), this.maxPitch);
        this.thermal = kept.length;     // the photos that go into the task
        // Normalized, the workset leaves the oblique photos out; as is, they are not converted
        this.photos = normalize ? photos : kept;
        this.otherPhotos = (normalize ? [] : oblique).concat(otherPhotos || []);
        this.uploads = normalize ? this.photos.concat(this.otherPhotos.filter(f => /\.jpe?g$/i.test(f.name || ""))) : null;
        this.canceled = false;
        this.task = null;
        this.dataset = null;
        this.result = {done: 0, total: this.photos.length, converted: [], ignored: [], failed: [], oblique: oblique.length};
    }

    // What onProgress is first given: normalized, the photos are uploaded before anything is converted
    initialProgress(){
        if (this.uploads) return {done: 0, total: this.uploads.length, converted: [], ignored: [], failed: [], uploading: true};
        return Object.assign({}, this.result);
    }

    // Resolves to the result ({task, converted: image names, ignored and failed: [{name, reason}], dataset: its id
    // or null, analysisError}) once the task is committed; rejects with an Error if it could not be (the task, and
    // its dataset, are then removed).
    start(){
        if (this.frames.normalize) return this.startWorkset();
        return this.api.createTask(this.projectId, taskData(this.taskInfo))
            .then(task => {
                this.task = task;
                if (this.keepPhotos) return this.api.taskDataset(this.projectId, task.id).then(d => { this.dataset = d.id; });
            })
            .then(() => this.convertAll())
            .then(() => this.checkCanceled())
            .then(() => {
                if (!this.result.converted.length) throw new Error(NO_IMAGES);
                return this.uploadTextFiles();
            })
            .then(() => this.uploadOtherPhotos())
            .then(() => this.checkCanceled())
            .then(() => this.api.commit(this.projectId, this.task.id))
            .then(task => {
                const result = Object.assign({}, this.result, {task, dataset: this.dataset, analysisError: ""});
                if (!this.dataset) return result;
                // The task is made: a dataset whose analysis could not start is kept, and says so
                return this.api.analyzeDataset(this.dataset).then(() => result,
                    e => Object.assign(result, {analysisError: e.message}));
            })
            .catch(e => this.removeTask().then(() => { throw e; }));
    }

    // Normalized or harmonized: resolves to {task, dataset, workset: its id, done, total} once the photos are on the
    // server and the workset started; the task processes once the workset is converted
    startWorkset(){
        const photos = this.uploads;
        const progress = this.initialProgress();
        return this.api.createTask(this.projectId, taskData(this.taskInfo))
            .then(task => {
                this.task = task;
                return this.api.taskDataset(this.projectId, task.id);
            })
            .then(d => {
                this.dataset = d.id;
                let chain = Promise.resolve();
                for (let i = 0; i < photos.length; i += DATASET_BATCH){
                    const batch = photos.slice(i, i + DATASET_BATCH);
                    chain = chain.then(() => this.checkCanceled())
                        .then(() => retried(() => this.api.uploadToDataset(this.dataset, batch)))
                        .then(() => {
                            progress.done += batch.length;
                            this.onProgress(Object.assign({}, progress));
                        });
                }
                return chain;
            })
            .then(() => this.checkCanceled())
            .then(() => {
                if (!this.textFiles.length) return null;
                const names = this.photos.map(p => p.name);
                return Promise.all(this.textFiles.map(f => withImagesRenamed(f, names, worksetTiffName)))
                    .then(files => retried(() => this.api.uploadFiles(this.projectId, this.task.id, files)));
            })
            .then(() => this.checkCanceled())
            .then(() => this.api.startWorkset(this.projectId, this.task.id,
                Object.assign({}, this.measurement, this.frames, {max_pitch: this.maxPitch}),
                {plan_options: this.planOptions, frames: this.thermal}))
            .then(w => ({task: this.task, dataset: this.dataset, workset: w.id, frames: this.frames, done: progress.done,
                         total: progress.total, thermal: this.thermal, oblique: this.result.oblique, converted: [],
                         ignored: [], failed: []}))
            .catch(e => this.removeTask().then(() => { throw e; }));
    }

    cancel(){
        this.canceled = true;
    }

    checkCanceled(){
        if (this.canceled) throw new Error("Canceled");
    }

    removeTask(){
        const dataset = this.dataset;
        this.dataset = null;
        const removed = dataset ? this.api.removeDataset(dataset).catch(() => {}) : Promise.resolve();
        if (!this.task) return removed;
        const task = this.task;
        this.task = null;
        return removed.then(() => this.api.removeTask(this.projectId, task.id).catch(() => {}));
    }

    convertAll(){
        let next = 0;
        const worker = () => {
            if (this.canceled || next >= this.photos.length) return Promise.resolve();
            const photo = this.photos[next++];
            const fields = this.dataset ? Object.assign({}, this.measurement, {dataset: this.dataset}) : this.measurement;
            return retried(() => this.api.convert(this.projectId, this.task.id, photo, fields))
                .then(res => this.record(photo, res.status, res.reason, res.image),
                      e => this.record(photo, "failed", e.message))
                .then(worker);
        };
        const workers = [];
        for (let i = 0; i < Math.min(this.concurrency, this.photos.length); i++) workers.push(worker());
        return Promise.all(workers);
    }

    record(photo, status, reason, image){
        const r = this.result;
        if (status === "converted") r.converted.push(image || tiffName(photo.name));
        else if (status === "ignored") r.ignored.push({name: photo.name, reason});
        else r.failed.push({name: photo.name, reason: reason || "Unknown error"});
        r.done++;
        this.onProgress(Object.assign({}, r));
    }

    uploadTextFiles(){
        if (!this.textFiles.length) return Promise.resolve();
        const converted = {};
        this.result.converted.forEach(n => { converted[n] = true; });
        const names = this.photos.map(p => p.name).filter(n => converted[tiffName(n)]);
        return Promise.all(this.textFiles.map(f => withImagesRenamed(f, names)))
            .then(files => retried(() => this.api.uploadFiles(this.projectId, this.task.id, files)));
    }

    // The photos that are not converted, into the dataset, a few per request, one request at a time
    uploadOtherPhotos(){
        if (!this.dataset) return Promise.resolve();
        const photos = this.otherPhotos.filter(f => /\.jpe?g$/i.test(f.name || ""));
        let chain = Promise.resolve();
        for (let i = 0; i < photos.length; i += DATASET_BATCH){
            const batch = photos.slice(i, i + DATASET_BATCH);
            chain = chain.then(() => this.checkCanceled()).then(() => retried(() => this.api.uploadToDataset(this.dataset, batch)));
        }
        return chain;
    }
}
