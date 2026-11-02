import { MAX_PITCH, PANEL_OPTIONS, byPitch, gimbalPitch, sameOptions } from "../thermal/plan";

describe("what DJI Thermal Task's panel takes from the WebODM plan", () => {
    test("a photo's gimbal pitch comes from DJI's XMP, as a number or a signed string", () => {
        expect(gimbalPitch({GimbalPitchDegree: -89.9})).toBe(-89.9);
        expect(gimbalPitch({GimbalPitchDegree: "+0.00"})).toBe(0);
        expect(gimbalPitch({})).toBeNull();
        expect(gimbalPitch(null)).toBeNull();
    });

    test("the photos above the pitch limit are oblique, those at it or below or of an unknown pitch are kept", () => {
        const pitches = new Map([["a", -90], ["b", -80], ["c", -79.9], ["d", null]]);
        expect(byPitch(["a", "b", "c", "d", "e"], pitches, MAX_PITCH)).toEqual({kept: ["a", "b", "d", "e"], oblique: ["c"]});
        expect(byPitch(["a", "c"], pitches, null)).toEqual({kept: ["a", "c"], oblique: []});
    });

    test("options are the same whatever their order, and differ by any value", () => {
        expect(sameOptions([{name: "radiometric-calibration", value: "none"}], PANEL_OPTIONS)).toBe(true);
        expect(sameOptions([{name: "dsm", value: true}, {name: "radiometric-calibration", value: "none"}],
                           [{name: "radiometric-calibration", value: "none"}, {name: "dsm", value: true}])).toBe(true);
        expect(sameOptions([{name: "radiometric-calibration", value: "camera"}], PANEL_OPTIONS)).toBe(false);
        expect(sameOptions([], PANEL_OPTIONS)).toBe(false);
    });
});
