// The Measurement section's logic: the parameters a thermal task's photos are measured with, the ranges the
// cameras accept, and what is sent with each photo (see converter.settings on the server). A value left empty
// keeps each photo's recorded one. The server's values are in degrees Celsius; the form shows the unit picked.

export const FIELDS = [
    {name: "emissivity", label: "Emissivity", temperature: false, step: "0.01"},
    {name: "reflected_temp", label: "Reflected temperature", temperature: true, step: "0.1"},
    {name: "ambient_temp", label: "Ambient temperature", temperature: true, step: "0.1"},
    {name: "humidity", label: "Relative humidity", temperature: false, step: "1", suffix: "%"}
];

export const UNITS = {C: "°C", F: "°F", K: "K"};

// The cameras' EXIF models, as DJI names them elsewhere
const CAMERA_NAMES = {"ZH20T": "H20T", "ZH20N": "H20N", "MAVIC2-ENTERPRISE-ADVANCED": "M2EA"};

export function cameraName(model){
    return CAMERA_NAMES[model] || model;
}

export function toCelsius(value, unit){
    if (unit === "K") return value - 273.15;
    return unit === "F" ? (value - 32) * 5 / 9 : value;
}

export function fromCelsius(celsius, unit){
    if (unit === "K") return celsius + 273.15;
    return unit === "F" ? celsius * 9 / 5 + 32 : celsius;
}

// The user's unit, WebODM's (Units.js's unitSystem()): Fahrenheit when imperial, else Celsius
export function defaultUnit(system){
    return system && system.temperatureUnit(0).abbr === UNITS.F ? "F" : "C";
}

function round(n, decimals){
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
}

// descriptions: the server's describe of one photo per camera ({camera, recorded, ranges, palette, palettes}). The
// ranges every camera accepts, the first camera's recorded values, the cameras that do not use a parameter, DJI's
// palettes and the first palette the photos were shot in ("" for none).
export function combineCameras(descriptions){
    const combined = {cameras: [], ranges: {}, recorded: {}, unusedBy: {}, palettes: [], palette: ""};
    const names = FIELDS.map(f => f.name).concat(["distance"]);

    descriptions.forEach(d => {
        if (!combined.palettes.length && d.palettes) combined.palettes = d.palettes.slice();
        if (!combined.palette && d.palette) combined.palette = d.palette;
        const camera = cameraName(d.camera);
        if (combined.cameras.indexOf(camera) === -1) combined.cameras.push(camera);
        names.forEach(name => {
            const range = d.ranges[name];
            if (!range){
                combined.unusedBy[name] = (combined.unusedBy[name] || []).concat([camera]);
                return;
            }
            const low = round(range[0], 4), high = round(range[1], 4);
            const current = combined.ranges[name];
            combined.ranges[name] = current ? [Math.max(current[0], low), Math.min(current[1], high)] : [low, high];
            if (combined.recorded[name] === undefined && d.recorded[name] !== undefined){
                combined.recorded[name] = d.recorded[name];
            }
        });
    });
    return combined;
}

// Where the Palette field starts: the photos' palette, else DJI's iron red, else the first of DJI's
export function startPalette(combined){
    const list = combined.palettes || [];
    if (list.indexOf(combined.palette) !== -1) return combined.palette;
    return list.indexOf("ironred") !== -1 ? "ironred" : (list[0] || "");
}

function parse(text){
    text = String(text === undefined || text === null ? "" : text).trim();
    if (text === "") return null;
    const n = Number(text);
    return isFinite(n) ? n : NaN;
}

function formatNumber(n){
    return String(round(n, 2));
}

// The range of a field in the unit shown, as text: "0.1 - 1", "-40 - 100 °C"
export function rangeText(name, combined, unit){
    const range = combined.ranges[name];
    if (!range) return "";
    const field = FIELDS.find(f => f.name === name);
    if (field && field.temperature){
        return `${formatNumber(fromCelsius(range[0], unit))} - ${formatNumber(fromCelsius(range[1], unit))} ${UNITS[unit]}`;
    }
    return `${formatNumber(range[0])} - ${formatNumber(range[1])}${name === "distance" ? " m" : (field && field.suffix ? " %" : "")}`;
}

// The recorded value of a field in the unit shown, as text, or ""
export function recordedText(name, combined, unit){
    const value = combined.recorded[name];
    if (value === undefined || value === null) return "";
    const field = FIELDS.find(f => f.name === name);
    return formatNumber(field && field.temperature ? fromCelsius(value, unit) : value);
}

// values: {emissivity: "0.95", ..., distanceMode: "lrf", distance: "12"} as typed. The problem of each field that
// has one ({name: message}); empty when the values can be used.
export function validate(values, combined, unit){
    const errors = {};
    const check = (name, temperature) => {
        const n = parse(values[name]);
        if (n === null) return;
        if (isNaN(n)){
            errors[name] = "Enter a number";
            return;
        }
        const range = combined.ranges[name];
        const celsius = temperature ? toCelsius(n, unit) : n;
        if (range && (celsius < range[0] - 1e-6 || celsius > range[1] + 1e-6)){
            errors[name] = `Outside the range: ${rangeText(name, combined, unit)}`;
        }
    };

    FIELDS.forEach(f => {
        if (combined.ranges[f.name]) check(f.name, f.temperature);
    });
    if (values.distanceMode === "value"){
        if (parse(values.distance) === null) errors.distance = "Enter a distance";
        else check("distance", false);
    }
    return errors;
}

// What is sent with each photo: only the values changed, the unit of the temperatures and the distance
export function requestData(values, unit){
    const data = {unit};
    FIELDS.forEach(f => {
        const n = parse(values[f.name]);
        if (n !== null) data[f.name] = String(n);
    });
    data.distance = values.distanceMode === "value" ? String(parse(values.distance)) : (values.distanceMode || "lrf");
    return data;
}
