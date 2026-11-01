// The server calls of a thermal task's upload, with jQuery (WebODM's, which sends Django's CSRF token): WebODM's
// task API and the plugin's (api.py). Each returns a promise that rejects with an Error saying what went wrong.
import $ from 'jquery';

const PLUGIN_API = "/api/plugins/dji-thermal";

function errorOf(xhr){
    const json = xhr && xhr.responseJSON;
    let message = "";
    if (json){
        if (typeof json === "string") message = json;
        else if (json.detail) message = json.detail;
        else if (Array.isArray(json)) message = json.join(" ");
        else message = JSON.stringify(json);
    }
    return new Error(message || (xhr && xhr.status ? `${xhr.status} ${xhr.statusText}` : "Cannot reach the server"));
}

function request(options){
    return new Promise((resolve, reject) => {
        $.ajax(options).done(resolve).fail(xhr => reject(errorOf(xhr)));
    });
}

function postForm(url, fields, files){
    const form = new FormData();
    Object.keys(fields).forEach(k => form.append(k, fields[k]));
    files.forEach(f => form.append("images", f, f.name));
    return request({url, type: "POST", data: form, processData: false, contentType: false, dataType: "json"});
}

const tasksUrl = projectId => `/api/projects/${projectId}/tasks/`;

export default {
    describe: photo => postForm(`${PLUGIN_API}/describe`, {}, [photo]),

    display: () => request({url: `${PLUGIN_API}/display`, type: "GET", dataType: "json"}),

    createTask: (projectId, data) => request({
        url: tasksUrl(projectId), type: "POST", contentType: "application/json", data: JSON.stringify(data),
        dataType: "json"
    }),

    convert: (projectId, taskId, photo, measurement) =>
        postForm(`${PLUGIN_API}/projects/${projectId}/tasks/${taskId}/convert`, measurement, [photo]),

    uploadFiles: (projectId, taskId, files) => postForm(`${tasksUrl(projectId)}${taskId}/upload/`, {}, files),

    commit: (projectId, taskId) => request({url: `${tasksUrl(projectId)}${taskId}/commit/`, type: "POST", dataType: "json"}),

    removeTask: (projectId, taskId) => request({url: `${tasksUrl(projectId)}${taskId}/remove/`, type: "POST"}),

    taskDataset: (projectId, taskId) =>
        request({url: `${PLUGIN_API}/projects/${projectId}/tasks/${taskId}/dataset`, type: "POST", dataType: "json"}),

    uploadToDataset: (datasetId, files) => postForm(`${PLUGIN_API}/datasets/${datasetId}/upload`, {}, files),

    analyzeDataset: datasetId => request({url: `${PLUGIN_API}/datasets/${datasetId}/analyze`, type: "POST", dataType: "json"}),

    startWorkset: (projectId, taskId, settings) => request({
        url: `${PLUGIN_API}/projects/${projectId}/tasks/${taskId}/workset`, type: "POST", contentType: "application/json",
        data: JSON.stringify({settings}), dataType: "json"
    }),

    removeDataset: datasetId => request({url: `${PLUGIN_API}/datasets/${datasetId}`, type: "DELETE"})
};
