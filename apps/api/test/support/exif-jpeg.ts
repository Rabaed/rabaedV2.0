// A tiny JPEG with an EXIF block, as a phone camera writes one: when the photo
// was taken (DateTimeOriginal, with or without OffsetTimeOriginal) and where
// (GPS latitude and longitude). Built by hand, so the tests need no image files.

type Entry = { tag: number; type: "ascii"; value: string } | { tag: number; type: "long"; value: number } | { tag: number; type: "rational"; value: number[] };

const typeCode = { ascii: 2, long: 4, rational: 5 } as const;

/** One IFD at `offset` (from the TIFF header), little endian; values that don't fit in 4 bytes follow it. */
function ifd(entries: Entry[], offset: number): Buffer {
  const head = Buffer.alloc(2 + entries.length * 12 + 4);
  const data: Buffer[] = [];
  let dataOffset = offset + head.length;
  head.writeUInt16LE(entries.length, 0);
  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    head.writeUInt16LE(entry.tag, at);
    head.writeUInt16LE(typeCode[entry.type], at + 2);
    let bytes: Buffer;
    if (entry.type === "long") {
      head.writeUInt32LE(1, at + 4);
      head.writeUInt32LE(entry.value, at + 8);
      return;
    }
    if (entry.type === "ascii") {
      bytes = Buffer.from(`${entry.value}\0`, "latin1");
      head.writeUInt32LE(bytes.length, at + 4);
    } else {
      bytes = Buffer.alloc(entry.value.length * 8);
      // Each value as a fraction over 10000, enough for seconds of arc.
      entry.value.forEach((v, j) => {
        bytes.writeUInt32LE(Math.round(v * 10000), j * 8);
        bytes.writeUInt32LE(10000, j * 8 + 4);
      });
      head.writeUInt32LE(entry.value.length, at + 4);
    }
    if (bytes.length <= 4) bytes.copy(head, at + 8);
    else {
      head.writeUInt32LE(dataOffset, at + 8);
      data.push(bytes);
      dataOffset += bytes.length;
    }
  });
  return Buffer.concat([head, ...data]);
}

/** Degrees as degrees, minutes and seconds. */
const dms = (degrees: number) => {
  const d = Math.floor(degrees);
  const m = Math.floor((degrees - d) * 60);
  return [d, m, (degrees - d - m / 60) * 3600];
};

export type PhotoExif = {
  /** As the camera writes it: `YYYY:MM:DD HH:MM:SS`, in its own clock. */
  takenAt?: string;
  /** `+03:00`; cameras that don't write it leave the time zone unknown. */
  offset?: string;
  latitude?: number;
  longitude?: number;
};

/** A JPEG whose EXIF holds `exif`; with nothing given, a JPEG with no EXIF at all. */
export function jpegWithExif(exif: PhotoExif = {}): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  if (exif.takenAt === undefined && exif.latitude === undefined) return Buffer.concat([soi, eoi]);

  const exifEntries: Entry[] = [];
  if (exif.takenAt !== undefined) exifEntries.push({ tag: 0x9003, type: "ascii", value: exif.takenAt });
  if (exif.offset !== undefined) exifEntries.push({ tag: 0x9011, type: "ascii", value: exif.offset });
  const gpsEntries: Entry[] = [];
  if (exif.latitude !== undefined && exif.longitude !== undefined) {
    gpsEntries.push(
      { tag: 0x0001, type: "ascii", value: exif.latitude < 0 ? "S" : "N" },
      { tag: 0x0002, type: "rational", value: dms(Math.abs(exif.latitude)) },
      { tag: 0x0003, type: "ascii", value: exif.longitude < 0 ? "W" : "E" },
      { tag: 0x0004, type: "rational", value: dms(Math.abs(exif.longitude)) },
    );
  }

  // IFD0 points to the Exif and GPS IFDs, which follow it.
  const ifd0Length = 2 + 2 * 12 + 4;
  const exifOffset = 8 + ifd0Length;
  const exifIfd = ifd(exifEntries, exifOffset);
  const gpsOffset = exifOffset + exifIfd.length;
  const gpsIfd = ifd(gpsEntries, gpsOffset);
  const ifd0 = ifd(
    [
      { tag: 0x8769, type: "long", value: exifOffset },
      { tag: 0x8825, type: "long", value: gpsOffset },
    ],
    8,
  );
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]), ifd0, exifIfd, gpsIfd]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([soi, app1, payload, eoi]);
}
