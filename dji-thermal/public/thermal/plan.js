// What DJI Thermal Task's panel takes from the WebODM plan (the dataset's analysis, dji-thermal-cli's webodm.plan)
// before any photo is uploaded: its nadir-only pitch limit, and the ODM options that need no analysis.

export const MAX_PITCH = -80;   // degrees: dji-thermal-cli's mosaic.DEFAULT_MAX_PITCH, the plan's limit

// The options WebODM's panel starts from ("Custom"). Left so, a normalized or harmonized task gets the plan's
// recommended ones once its dataset is analyzed (api.py TaskWorkset: plan_options).
// Global seam levelling off: it shifts the temperatures and can leave a few pixels far outside any measured.
export const PANEL_OPTIONS = [{name: "radiometric-calibration", value: "none"},
                              {name: "texturing-skip-global-seam-leveling", value: true}];

// A photo's gimbal pitch in degrees (DJI's XMP GimbalPitchDegree, as exifr reads it), or null
export function gimbalPitch(exif){
    const pitch = parseFloat(exif && exif.GimbalPitchDegree);
    return isNaN(pitch) ? null : pitch;
}

// {kept, oblique}: the photos at or below maxPitch (null: no limit), and those above it. A photo whose pitch isn't
// known is kept, as the workset's conversion does.
export function byPitch(photos, pitches, maxPitch){
    if (maxPitch === null || maxPitch === undefined) return {kept: photos.slice(), oblique: []};
    const kept = [], oblique = [];
    photos.forEach(p => {
        const pitch = pitches.get(p);
        (pitch !== null && pitch !== undefined && pitch > maxPitch ? oblique : kept).push(p);
    });
    return {kept, oblique};
}

// Whether two lists of ODM options ([{name, value}]) set the same values, in any order (true and "true" alike:
// WebODM's form gives a ticked option either way)
export function sameOptions(a, b){
    const key = list => JSON.stringify((list || []).map(o => [o.name, String(o.value)]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    return key(a) === key(b);
}
