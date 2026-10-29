// Which of the files picked are worth sending to the server: DJI thermal R-JPEGs carry their raw thermal data in
// APP3 segments, before the image data, which the RGB photos taken with them do not have. The server decides for
// each photo it is sent (dji-thermal-cli's classify), so this only keeps the RGB photos from being uploaded.

// Enough for the segments before the first APP3: EXIF, XMP and ICC profile (APP1, APP2), at most 64 KB each
export const HEADER_BYTES = 512 * 1024;

const JPEG_EXTENSIONS = [".jpg", ".jpeg"];
const TEXT_EXTENSIONS = [".txt"];

const SOI = 0xd8, SOS = 0xda, EOI = 0xd9, APP3 = 0xe3;

function extension(name){
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function isJpegName(name){
    return JPEG_EXTENSIONS.indexOf(extension(name)) !== -1;
}

// The GCP file and WebODM's geo.txt and image_groups.txt
export function isTextName(name){
    return TEXT_EXTENSIONS.indexOf(extension(name)) !== -1;
}

// bytes: the start of a file (Uint8Array). True if it is a JPEG with an APP3 segment before its image data.
export function hasThermalData(bytes){
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return false;

    let i = 2;
    while (i + 4 <= bytes.length){
        if (bytes[i] !== 0xff) return false;
        const marker = bytes[i + 1];
        if (marker === 0xff){ // fill byte
            i++;
            continue;
        }
        if (marker === APP3) return true;
        if (marker === SOS || marker === EOI) return false;
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    return false;
}

function readStart(file){
    const blob = file.slice(0, HEADER_BYTES);
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

export function isThermalCandidate(file){
    if (!isJpegName(file.name)) return Promise.resolve(false);
    return readStart(file).then(buffer => hasThermalData(new Uint8Array(buffer)), () => false);
}

// files: the files picked. Resolves to {photos: the possible thermal R-JPEGs, textFiles, ignored: the rest}.
export function sortFiles(files){
    files = Array.from(files);
    return Promise.all(files.map(isThermalCandidate)).then(candidate => {
        const sorted = {photos: [], textFiles: [], ignored: []};
        files.forEach((f, i) => {
            if (candidate[i]) sorted.photos.push(f);
            else if (isTextName(f.name)) sorted.textFiles.push(f);
            else sorted.ignored.push(f);
        });
        return sorted;
    });
}
