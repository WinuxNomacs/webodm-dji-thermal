import { combineCameras, defaultUnit, rangeText, recordedText, requestData, validate } from "../thermal/measurement";

// As the server describes the sample photos (converter.describe)
const M4T = {
    camera: "M4T",
    recorded: {distance: 5, humidity: 50, emissivity: 0.95, reflected_temp: 25, ambient_temp: 16.437},
    ranges: {distance: [1, 300], humidity: [1, 100], emissivity: [0.10000000149011612, 1], reflected_temp: [-40, 100],
             ambient_temp: [-40, 80]}
};
const M30T = {
    camera: "M30T",
    recorded: {distance: 5, humidity: 50, emissivity: 0.95, reflected_temp: 25, ambient_temp: 25},
    ranges: {distance: [1, 25], humidity: [1, 100], emissivity: [0.1, 1], reflected_temp: [-40, 100], ambient_temp: [-40, 80]}
};
const H20T = {
    camera: "ZH20T",
    recorded: {distance: 5, humidity: 70, emissivity: 1, reflected_temp: 23},
    ranges: {distance: [1, 25], humidity: [20, 100], emissivity: [0.1, 1], reflected_temp: [-40, 500]}
};

describe("the cameras' ranges", () => {
    test("one camera's recorded values and ranges are shown in the unit picked", () => {
        const m4t = combineCameras([M4T]);
        expect(m4t.cameras).toEqual(["M4T"]);
        expect(rangeText("distance", m4t, "C")).toBe("1 - 300 m");
        expect(rangeText("emissivity", m4t, "C")).toBe("0.1 - 1");
        expect(rangeText("reflected_temp", m4t, "C")).toBe("-40 - 100 °C");
        expect(rangeText("reflected_temp", m4t, "F")).toBe("-40 - 212 °F");
        expect(recordedText("ambient_temp", m4t, "C")).toBe("16.44");
        expect(recordedText("ambient_temp", m4t, "F")).toBe("61.59");
    });

    test("photos of several cameras take the range all of them accept", () => {
        const both = combineCameras([M4T, M30T]);
        expect(both.ranges.distance).toEqual([1, 25]);
        expect(both.recorded.ambient_temp).toBe(16.437);
    });

    test("the H20T's photos do not use the ambient temperature, which the form says", () => {
        const h20t = combineCameras([H20T]);
        expect(h20t.cameras).toEqual(["H20T"]);
        expect(h20t.ranges.ambient_temp).toBeUndefined();
        expect(h20t.unusedBy.ambient_temp).toEqual(["H20T"]);

        const mixed = combineCameras([M4T, H20T]);
        expect(mixed.ranges.ambient_temp).toEqual([-40, 80]);
        expect(mixed.unusedBy.ambient_temp).toEqual(["H20T"]);
        expect(mixed.ranges.humidity).toEqual([20, 100]);
    });

    test("the default unit is WebODM's: Fahrenheit in an imperial unit system", () => {
        expect(defaultUnit({temperatureUnit: () => ({abbr: "°F"})})).toBe("F");
        expect(defaultUnit({temperatureUnit: () => ({abbr: "°C"})})).toBe("C");
        expect(defaultUnit(undefined)).toBe("C");
    });
});

describe("the values checked before the upload", () => {
    const m4t = combineCameras([M4T]);

    test("values left empty keep the recorded ones and need no check", () => {
        expect(validate({distanceMode: "lrf"}, m4t, "C")).toEqual({});
        expect(validate({emissivity: "", humidity: " "}, m4t, "C")).toEqual({});
    });

    test("a value at a range's ends is accepted, even with the camera's float rounding", () => {
        expect(validate({emissivity: "0.1", humidity: "100", distanceMode: "value", distance: "300"}, m4t, "C")).toEqual({});
    });

    test("a value outside its range, or not a number, is refused with the range", () => {
        expect(validate({emissivity: "1.2"}, m4t, "C")).toEqual({emissivity: "Outside the range: 0.1 - 1"});
        expect(validate({humidity: "abc"}, m4t, "C")).toEqual({humidity: "Enter a number"});
        expect(validate({distanceMode: "value", distance: "301"}, m4t, "C")).toEqual({distance: "Outside the range: 1 - 300 m"});
        expect(validate({distanceMode: "value", distance: ""}, m4t, "C")).toEqual({distance: "Enter a distance"});
    });

    test("temperatures are checked in the unit picked", () => {
        expect(validate({reflected_temp: "212"}, m4t, "F")).toEqual({});
        expect(validate({reflected_temp: "213"}, m4t, "F")).toEqual({reflected_temp: "Outside the range: -40 - 212 °F"});
        expect(validate({reflected_temp: "213"}, m4t, "C")).toEqual({reflected_temp: "Outside the range: -40 - 100 °C"});
    });

    test("a parameter no camera uses is not checked", () => {
        expect(validate({ambient_temp: "900"}, combineCameras([H20T]), "C")).toEqual({});
    });
});

describe("what is sent with each photo", () => {
    test("only the values changed, with the unit and the rangefinder's distance by default", () => {
        expect(requestData({emissivity: "0.90", humidity: ""}, "F")).toEqual({unit: "F", emissivity: "0.9", distance: "lrf"});
    });

    test("the distance is the recorded one, or the one set for all photos", () => {
        expect(requestData({distanceMode: "embedded", distance: "12"}, "C").distance).toBe("embedded");
        expect(requestData({distanceMode: "value", distance: "12.5"}, "C").distance).toBe("12.5");
    });
});
