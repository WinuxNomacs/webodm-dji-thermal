// How far a DJI Thermal Task's workset is, as the project page shows it (WorksetProgress.jsx), from the server's
// answer (api.py TaskWorkset.get)
import core from '../analyzer_core';

export const POLL_MS = 3000;
export const START_S = 60;     // the TIFFs go into the task within seconds of the conversion: after this, it didn't start

// {kind, percent, stage, error, done}: kind is waiting, converting, committing, started, not_started (the page's
// Start processing then puts the TIFFs in the task), failed or canceled; done once nothing more will change. stage:
// the normalizing's stage as the dataset's page words it, or ""
export function worksetState(w){
    const percent = Math.round(Math.min(1, w.progress || 0) * 100);
    if (w.committed) return {kind: "started", percent: 100, done: true};
    switch (w.status){
    case "converting": return {kind: "converting", percent, stage: core.stageText(w.stage), done: false};
    case "ready":
        return w.task_error || w.since_converted > START_S ? {kind: "not_started", error: w.task_error || "", done: true}
                                                            : {kind: "committing", percent: 100, done: false};
    case "failed": return {kind: "failed", error: w.error, done: true};
    case "canceled": return {kind: "canceled", done: true};
    default: return {kind: "waiting", percent: 0, done: false};
    }
}
