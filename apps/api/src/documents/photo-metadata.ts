import { photoMetadata, takenWhere, type PhotoMetadata } from "@rabaed/domain";
import exifr from "exifr";

// When and where a photo was taken (RP-284), read from the stored file's EXIF
// when its upload is confirmed: the browser's word is never taken for either.

/**
 * The offset of a camera time with no time zone of its own: the Project's,
 * Asia/Riyadh, which keeps +03:00 all year (locale.ts).
 */
const projectOffset = "+03:00";

const none: PhotoMetadata = { takenAt: null, takenWhere: null };

/** `YYYY:MM:DD HH:MM:SS` in the camera's clock, at `offset`, as an instant; null if it isn't a real one. */
function instant(cameraTime: unknown, offset: unknown): string | null {
  const match = typeof cameraTime === "string" && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(cameraTime.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const zone = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : projectOffset;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  // A camera that never had its clock set writes zeros; Date rolls a 13th month over rather than refusing it.
  if (Number.isNaN(date.getTime()) || Number(y) < 1900 || Number(mo) > 12 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59) return null;
  return date.toISOString();
}

/** The time and place a photo's EXIF records; nothing for a file without EXIF or one that isn't an image. */
export async function readPhotoMetadata(file: Uint8Array): Promise<PhotoMetadata> {
  let exif: Record<string, unknown> | undefined;
  try {
    exif = await exifr.parse(file, {
      gps: true,
      reviveValues: false,
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime", "GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef"],
    });
  } catch {
    return none;
  }
  if (!exif) return none;
  const place = takenWhere.safeParse({ latitude: exif.latitude, longitude: exif.longitude });
  return photoMetadata.parse({
    takenAt: instant(exif.DateTimeOriginal ?? exif.CreateDate, exif.OffsetTimeOriginal ?? exif.OffsetTime),
    takenWhere: place.success ? place.data : null,
  });
}
