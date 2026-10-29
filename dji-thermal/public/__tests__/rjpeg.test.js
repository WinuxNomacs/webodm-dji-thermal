import { hasThermalData, isJpegName, sortFiles } from "../thermal/rjpeg";

// A JPEG's start: SOI, then segments (marker, payload length) and the start of scan
function jpeg(...markers){
    const bytes = [0xff, 0xd8];
    markers.forEach(([marker, size]) => {
        bytes.push(0xff, marker, (size + 2) >> 8, (size + 2) & 0xff);
        for (let i = 0; i < size; i++) bytes.push(0);
    });
    bytes.push(0xff, 0xda, 0, 2);
    return new Uint8Array(bytes);
}

const APP1 = 0xe1, APP2 = 0xe2, APP3 = 0xe3, DQT = 0xdb;

describe("which photos are sent to the server", () => {
    test("a JPEG with an APP3 segment after its EXIF and XMP has thermal data", () => {
        expect(hasThermalData(jpeg([APP1, 30000], [APP1, 9000], [APP2, 500], [APP3, 65000]))).toBe(true);
    });

    test("a JPEG whose segments end with the image data, without APP3, has none", () => {
        expect(hasThermalData(jpeg([APP1, 30000], [APP2, 500], [DQT, 130]))).toBe(false);
    });

    test("a file that is not a JPEG, or is cut short before an APP3, has none", () => {
        expect(hasThermalData(Uint8Array.from("not an image at all", c => c.charCodeAt(0)))).toBe(false);
        expect(hasThermalData(jpeg([APP1, 30000], [APP3, 10]).slice(0, 1000))).toBe(false);
        expect(hasThermalData(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00]))).toBe(false);
    });

    test("only files named .jpg or .jpeg are read", () => {
        expect(isJpegName("DJI_0001_T.JPG")).toBe(true);
        expect(isJpegName("a.jpeg")).toBe(true);
        expect(isJpegName("a.png")).toBe(false);
        expect(isJpegName("jpg")).toBe(false);
    });

    test("the files picked are sorted into thermal photos, text files and the rest", async () => {
        const thermal = new File([jpeg([APP1, 100], [APP3, 100])], "DJI_0001_T.JPG");
        const rgb = new File([jpeg([APP1, 100], [DQT, 10])], "DJI_0001_V.JPG");
        const gcp = new File(["EPSG:4326\n"], "gcp_list.txt", {type: "text/plain"});
        const png = new File([jpeg([APP3, 100])], "map.png");
        const sorted = await sortFiles([rgb, thermal, gcp, png]);
        expect(sorted.photos).toEqual([thermal]);
        expect(sorted.textFiles).toEqual([gcp]);
        expect(sorted.ignored).toEqual([rgb, png]);
    });
});
