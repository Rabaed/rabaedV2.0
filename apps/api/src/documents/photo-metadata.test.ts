import { describe, expect, it } from "vitest";
import { jpegWithExif } from "../demo/exif-jpeg.ts";
import { readPhotoMetadata } from "./photo-metadata.ts";

describe("a photo's time and place, from its EXIF", () => {
  it("is the time it was taken, with the camera's time zone, and where", async () => {
    const photo = jpegWithExif({ takenAt: "2026:10:03 14:22:05", offset: "+02:00", latitude: 24.7136, longitude: 46.6753 });
    expect(await readPhotoMetadata(photo)).toEqual({
      takenAt: "2026-10-03T12:22:05.000Z",
      takenWhere: { latitude: 24.7136, longitude: 46.6753 },
    });
  });

  it("takes a time without a time zone as the Project's (KSA)", async () => {
    expect(await readPhotoMetadata(jpegWithExif({ takenAt: "2026:10:03 14:22:05" }))).toEqual({
      takenAt: "2026-10-03T11:22:05.000Z",
      takenWhere: null,
    });
  });

  it("keeps south and west as negative", async () => {
    const { takenWhere } = await readPhotoMetadata(jpegWithExif({ latitude: -33.8688, longitude: -70.6693 }));
    expect(takenWhere).toEqual({ latitude: -33.8688, longitude: -70.6693 });
  });

  it("is nothing for a photo without EXIF, or a file that isn't an image", async () => {
    const nothing = { takenAt: null, takenWhere: null };
    expect(await readPhotoMetadata(jpegWithExif())).toEqual(nothing);
    expect(await readPhotoMetadata(Buffer.from("%PDF-1.7 not a photo"))).toEqual(nothing);
  });

  it("ignores a time the camera never set, or one that isn't a date", async () => {
    for (const takenAt of ["0000:00:00 00:00:00", "    :  :     :  :  ", "2026:13:45 25:61:00"]) {
      expect((await readPhotoMetadata(jpegWithExif({ takenAt }))).takenAt).toBeNull();
    }
  });

  it("ignores a place off the globe", async () => {
    expect((await readPhotoMetadata(jpegWithExif({ latitude: 91, longitude: 46 }))).takenWhere).toBeNull();
  });
});
