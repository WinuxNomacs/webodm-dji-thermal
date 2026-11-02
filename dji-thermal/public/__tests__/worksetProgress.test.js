// How far a DJI Thermal Task's workset is, as the project page shows it
import { worksetState } from "../thermal/worksetProgress";

const workset = fields => Object.assign({status: "new", progress: 0, stage: {}, error: "", photos: 220, committed: false,
                                         task_error: ""}, fields);

test("a workset converting its photos shows how far it is, or the normalizing's stage, and is asked again", () => {
    expect(worksetState(workset({}))).toEqual({kind: "waiting", percent: 0, done: false});
    expect(worksetState(workset({status: "converting", progress: 0.257}))).toEqual(
        {kind: "converting", percent: 26, stage: "", done: false});
    expect(worksetState(workset({status: "converting", stage: {stage: "align", step: 2, steps: 5, round: 1, rounds: 3,
                                                               done: 812, total: 1840, unit: "pairs"}})).stage)
        .toBe("step 2 of 5, aligning (round 1/3), 812/1840 pairs");
});

test("once converted it waits for the task to start, and says why it couldn't", () => {
    expect(worksetState(workset({status: "ready", progress: 1}))).toEqual({kind: "committing", percent: 100, done: false});
    expect(worksetState(workset({status: "ready", committed: true}))).toEqual({kind: "started", percent: 100, done: true});
    expect(worksetState(workset({status: "ready", task_error: "The dataset's task is processing"}))).toEqual(
        {kind: "not_started", error: "The dataset's task is processing", done: true});
    // Still without its images a minute after: it didn't start (the page then offers to start it)
    expect(worksetState(workset({status: "ready", since_converted: 20})).kind).toBe("committing");
    expect(worksetState(workset({status: "ready", since_converted: 3600}))).toEqual({kind: "not_started", error: "", done: true});
});

test("a failed or canceled conversion is the end of it", () => {
    expect(worksetState(workset({status: "failed", error: "No image could be converted"}))).toEqual(
        {kind: "failed", error: "No image could be converted", done: true});
    expect(worksetState(workset({status: "canceled"}))).toEqual({kind: "canceled", done: true});
});
