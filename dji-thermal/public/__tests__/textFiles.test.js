import { renameImages, tiffName, withImagesRenamed, worksetTiffName } from "../thermal/textFiles";

// jsdom's File has no text()
function readText(file){
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(file);
    });
}

describe("the photos' names in the GCP file and WebODM's text files", () => {
    test("a converted photo's image is named after it, as a .tif", () => {
        expect(tiffName("DJI_0001_T.JPG")).toBe("DJI_0001_T.tif");
        expect(tiffName("frame")).toBe("frame.tif");
    });

    test("a GCP file names the converted images", () => {
        const gcp = "EPSG:4326\n0.50 0.60 223.8 320 256 DJI_0001_T.JPG gcp1\n0.50 0.60 223.8 100 80 DJI_0002_T.JPG gcp2\n";
        expect(renameImages(gcp, ["DJI_0001_T.JPG", "DJI_0002_T.JPG"])).toBe(
            "EPSG:4326\n0.50 0.60 223.8 320 256 DJI_0001_T.tif gcp1\n0.50 0.60 223.8 100 80 DJI_0002_T.tif gcp2\n");
    });

    test("normalized or harmonized, the names are a workset's °C TIFFs'", () => {
        expect(worksetTiffName("DJI_0001_T.JPG")).toBe("DJI_0001_T_temp_c.tiff");
        expect(renameImages("EPSG:4326\n0.50 0.60 223.8 320 256 DJI_0001_T.JPG gcp1\n", ["DJI_0001_T.JPG"], worksetTiffName))
            .toBe("EPSG:4326\n0.50 0.60 223.8 320 256 DJI_0001_T_temp_c.tiff gcp1\n");
    });

    test("geo.txt and image_groups.txt, which start lines with the name, are renamed too", () => {
        expect(renameImages("EPSG:4326\nDJI_0001_T.JPG 0.50 0.60 223.8\n", ["DJI_0001_T.JPG"]))
            .toBe("EPSG:4326\nDJI_0001_T.tif 0.50 0.60 223.8\n");
        expect(renameImages("DJI_0001_T.JPG\tA\r\nDJI_0002_T.JPG\tB\r\n", ["DJI_0001_T.JPG", "DJI_0002_T.JPG"]))
            .toBe("DJI_0001_T.tif\tA\r\nDJI_0002_T.tif\tB\r\n");
    });

    test("only whole names change: not the photos left out, nor names that only contain one", () => {
        const text = "1 2 3 4 5 DJI_0001_V.JPG\n1 2 3 4 5 XDJI_0001_T.JPG\n1 2 3 4 5 DJI_0001_T.JPG.bak\n";
        expect(renameImages(text, ["DJI_0001_T.JPG"])).toBe(text);
    });

    test("a text file is sent as a new file of the same name", async () => {
        const file = new File(["1 2 3 4 5 DJI_0001_T.JPG\n"], "gcp_list.txt", {type: "text/plain"});
        const renamed = await withImagesRenamed(file, ["DJI_0001_T.JPG"]);
        expect(renamed.name).toBe("gcp_list.txt");
        expect(await readText(renamed)).toBe("1 2 3 4 5 DJI_0001_T.tif\n");
    });
});
