// A thermal task's upload: WebODM's API creates a partial task, the plugin's converts each photo into it (a few at
// a time), the text files (GCP, geo.txt, image_groups.txt) go in with the photos' names changed to the images',
// and WebODM's API commits the task, which starts processing. A photo that is not a thermal image is ignored, one
// that fails stays out with its reason; a task left with no image is removed.
import { tiffName, withImagesRenamed } from './textFiles';

export const CONCURRENCY = 3;

export const NO_IMAGES = "None of the photos could be converted: the task was not created.";

// The fields of WebODM's task creation (as its own upload, without resizing)
export function taskData(taskInfo){
    return {
        name: taskInfo.name,
        options: taskInfo.options,
        processing_node: taskInfo.selectedNode.id,
        auto_processing_node: taskInfo.selectedNode.key == "auto",
        partial: true,
        align_to: taskInfo.alignTo
    };
}

// api: the server calls (see serverApi.js), each returning a promise. onProgress({done, total, converted,
// ignored, failed}) after each photo.
export default class ThermalUpload {
    constructor({projectId, taskInfo, photos, textFiles, measurement, api, onProgress, concurrency}){
        this.projectId = projectId;
        this.taskInfo = taskInfo;
        this.photos = photos;
        this.textFiles = textFiles || [];
        this.measurement = measurement;
        this.api = api;
        this.onProgress = onProgress || (() => {});
        this.concurrency = concurrency || CONCURRENCY;
        this.canceled = false;
        this.task = null;
        this.result = {done: 0, total: photos.length, converted: [], ignored: [], failed: []};
    }

    // Resolves to the result ({task, converted: image names, ignored and failed: [{name, reason}]}) once the
    // task is committed; rejects with an Error if it could not be (the task is then removed).
    start(){
        return this.api.createTask(this.projectId, taskData(this.taskInfo))
            .then(task => {
                this.task = task;
                return this.convertAll();
            })
            .then(() => this.checkCanceled())
            .then(() => {
                if (!this.result.converted.length) throw new Error(NO_IMAGES);
                return this.uploadTextFiles();
            })
            .then(() => this.checkCanceled())
            .then(() => this.api.commit(this.projectId, this.task.id))
            .then(task => Object.assign({}, this.result, {task}))
            .catch(e => this.removeTask().then(() => { throw e; }));
    }

    cancel(){
        this.canceled = true;
    }

    checkCanceled(){
        if (this.canceled) throw new Error("Canceled");
    }

    removeTask(){
        if (!this.task) return Promise.resolve();
        const task = this.task;
        this.task = null;
        return this.api.removeTask(this.projectId, task.id).catch(() => {});
    }

    convertAll(){
        let next = 0;
        const worker = () => {
            if (this.canceled || next >= this.photos.length) return Promise.resolve();
            const photo = this.photos[next++];
            return this.api.convert(this.projectId, this.task.id, photo, this.measurement)
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
}
