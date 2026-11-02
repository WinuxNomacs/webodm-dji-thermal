jest.mock("jquery", () => ({ajax: jest.fn()}), {virtual: true});
import $ from "jquery";
import serverApi, { filesTimeout } from "../thermal/serverApi";

// $.ajax's answer: done with data, or failed with the xhr and jQuery's text status
function answer({data, xhr, textStatus}){
    const chain = {
        done: f => { if (data !== undefined) f(data); return chain; },
        fail: f => { if (xhr) f(xhr, textStatus); return chain; }
    };
    return chain;
}

describe("DJI Thermal Task's server calls", () => {
    test("a request sending files is given up on after a time that grows with their size", () => {
        $.ajax.mockReturnValue(answer({data: {status: "converted"}}));
        const photo = new File([new Uint8Array(1280000)], "DJI_0001_T.JPG");
        serverApi.convert(7, "t1", photo, {unit: "C"});
        expect($.ajax.mock.calls[0][0].timeout).toBe(30000 + 10000);
        expect(filesTimeout([])).toBe(30000);
    });

    test("a request given up on says the server did not answer, with no status, so it is sent again", async () => {
        $.ajax.mockReturnValue(answer({xhr: {status: 0}, textStatus: "timeout"}));
        const e = await serverApi.uploadToDataset("d1", [new File(["x"], "a.JPG")]).catch(err => err);
        expect(e.message).toBe("The server did not answer in time");
        expect(e.status).toBe(0);
    });

    test("a refusal keeps the server's reason and status", async () => {
        $.ajax.mockReturnValue(answer({xhr: {status: 400, responseJSON: {detail: "Over quota"}}, textStatus: "error"}));
        const e = await serverApi.uploadToDataset("d1", [new File(["x"], "a.JPG")]).catch(err => err);
        expect(e.message).toBe("Over quota");
        expect(e.status).toBe(400);
    });
});
