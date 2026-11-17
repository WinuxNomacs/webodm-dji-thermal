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

    test("the panel starts from radiometric calibration none, no global seam levelling and a surface model", () => {
        expect(PANEL_OPTIONS).toEqual([{name: "radiometric-calibration", value: "none"},
                                       {name: "texturing-skip-global-seam-leveling", value: true},
                                       {name: "dsm", value: true}]);
    });

    test("options are the same whatever their order, and differ by any value", () => {
        const seams = "texturing-skip-global-seam-leveling";
        const panel = (seamsValue, calibration) => [{name: "dsm", value: true}, {name: seams, value: seamsValue},
                                                    {name: "radiometric-calibration", value: calibration || "none"}];
        expect(sameOptions(panel(true), PANEL_OPTIONS)).toBe(true);
        expect(sameOptions(panel("true"), PANEL_OPTIONS)).toBe(true);
        expect(sameOptions(panel(false), PANEL_OPTIONS)).toBe(false);
        expect(sameOptions(panel(true).slice(1), PANEL_OPTIONS)).toBe(false);
        expect(sameOptions([{name: "radiometric-calibration", value: "none"}], PANEL_OPTIONS)).toBe(false);
        expect(sameOptions(panel(true, "camera"), PANEL_OPTIONS)).toBe(false);
        expect(sameOptions([], PANEL_OPTIONS)).toBe(false);
    });
});
