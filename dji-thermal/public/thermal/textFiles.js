// The task's images are the photos converted to .tif (DJI_0001_T.JPG becomes DJI_0001_T.tif), or a workset's °C TIFFs
// (DJI_0001_T_temp_c.tiff, when normalized or harmonized): the GCP file, geo.txt and image_groups.txt name the
// photos, so their names are changed to the images' in those files too.

export function tiffName(name){
    const dot = name.lastIndexOf(".");
    return (dot === -1 ? name : name.slice(0, dot)) + ".tif";
}

export function worksetTiffName(name){
    const dot = name.lastIndexOf(".");
    return (dot === -1 ? name : name.slice(0, dot)) + "_temp_c.tiff";
}

function escapeRegExp(s){
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// text: a GCP file, geo.txt or image_groups.txt. names: the photos converted. Each name, as a whole field (between
// whitespace or the line's ends), becomes its image's name; case is kept as in the photo's name.
export function renameImages(text, names, imageName = tiffName){
    if (!names.length) return text;
    const byName = {};
    names.forEach(n => { byName[n] = imageName(n); });
    const pattern = new RegExp(`(^|\\s)(${names.map(escapeRegExp).join("|")})(?=\\s|$)`, "gm");
    return text.replace(pattern, (match, before, name) => before + byName[name]);
}

function readText(file){
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// The text file with the converted photos' names changed, as a new File of the same name
export function withImagesRenamed(file, names, imageName = tiffName){
    return readText(file).then(text => new File([renameImages(text, names, imageName)], file.name, {type: file.type || "text/plain"}));
}
