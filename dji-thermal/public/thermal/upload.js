// A thermal task's upload: WebODM's API creates a partial task, the plugin's converts each photo into it (a few at
// a time), the text files (GCP, geo.txt, image_groups.txt) go in with the photos' names changed to the images',
// and WebODM's API commits the task, which starts processing. A photo that is not a thermal image is ignored, one
// that fails stays out with its reason; a task left with no image is removed.
//
// With keepPhotos, the task is first linked to a new DJI Thermal Analyzer dataset, each photo's conversion also keeps
// it there (no second upload), the other photos (otherPhotos: the RGB ones, another camera's) are uploaded to it, and
// its analysis starts once the task is committed. The dataset is removed with the task if the upload fails.
import { tiffName, withImagesRenamed } from './textFiles';

export const CONCURRENCY = 3;
export const DATASET_BATCH = 10;    // other photos per request to the dataset, as the Analyzer's own upload

export const NO_IMAGES = "None of the photos could be converted: the task was not created.";

// The task's hidden tag (conversion_tasks.THERMAL_TASK_TAG): its panel then offers a dataset for its photos (main.js)
export const THERMAL_TASK_TAG = ".dji-thermal-task";

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
// ignored, failed}) after each photo.
export default class ThermalUpload {
    constructor({projectId, taskInfo, photos, textFiles, measurement, api, onProgress, concurrency, keepPhotos, otherPhotos}){
        this.projectId = projectId;
        this.taskInfo = taskInfo;
        this.photos = photos;
        this.textFiles = textFiles || [];
        this.measurement = measurement;
        this.api = api;
        this.onProgress = onProgress || (() => {});
        this.concurrency = concurrency || CONCURRENCY;
        this.keepPhotos = !!keepPhotos;
        this.otherPhotos = otherPhotos || [];
        this.canceled = false;
        this.task = null;
        this.dataset = null;
        this.result = {done: 0, total: photos.length, converted: [], ignored: [], failed: []};
    }

    // Resolves to the result ({task, converted: image names, ignored and failed: [{name, reason}], dataset: its id
    // or null, analysisError}) once the task is committed; rejects with an Error if it could not be (the task, and
    // its dataset, are then removed).
    start(){
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
            return this.api.convert(this.projectId, this.task.id, photo, fields)
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
            .then(files => this.api.uploadFiles(this.projectId, this.task.id, files));
    }

    // The photos that are not converted, into the dataset, a few per request, one request at a time
    uploadOtherPhotos(){
        if (!this.dataset) return Promise.resolve();
        const photos = this.otherPhotos.filter(f => /\.jpe?g$/i.test(f.name || ""));
        let chain = Promise.resolve();
        for (let i = 0; i < photos.length; i += DATASET_BATCH){
            const batch = photos.slice(i, i + DATASET_BATCH);
            chain = chain.then(() => this.checkCanceled()).then(() => this.api.uploadToDataset(this.dataset, batch));
        }
        return chain;
    }
}
