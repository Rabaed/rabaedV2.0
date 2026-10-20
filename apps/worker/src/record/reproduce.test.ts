import { createHash } from "node:crypto";
import type { ReproductionSource } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { appendixFrom } from "./appendix.ts";
import type { RecordFiles } from "./files.ts";
import { goldenData } from "./golden-fixtures.ts";
import { LAYOUT_DERIVED, LAYOUT_VERSION, RECORD_DATA_NAMESPACE, recordDataFacts, recordDataXml, type RecordData } from "./record-data.ts";
import { findPhotos, replacedRecordKey, unreadableVersion } from "./reproduce.ts";

// How a Re-produce finds a Form photo's file again (RP-155): by the fingerprint the Record Data
// carries, among the item's Documents, never by a name two photos can share.

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (text: string) => new TextEncoder().encode(text);

function store(contents: Record<string, Uint8Array>): RecordFiles {
  return {
    put: async () => undefined,
    get: async (key) => contents[key] ?? null,
    sha256: async (key) => (contents[key] ? sha(contents[key]) : null),
  };
}

const doc = (storageKey: string, body: Uint8Array | null, extra: Partial<ReproductionSource["documents"][number]> = {}): ReproductionSource["documents"][number] => ({
  fileName: "IMG_0001.jpg",
  contentType: "image/jpeg",
  size: body?.length ?? 1,
  storageKey,
  takenAt: null,
  sha256: body ? sha(body) : null,
  ...extra,
});

describe("findPhotos", () => {
  const one = bytes("first photo");
  const two = bytes("second photo");

  it("tells two photos of one name and no time apart by their fingerprints", async () => {
    const found = await findPhotos(new Set([sha(two), sha(one)]), [doc("k1", one), doc("k2", two)], store({ k1: one, k2: two }));
    expect(found.keys).toEqual(new Map([[sha(one), "k1"], [sha(two), "k2"]]));
    expect([...found.images.keys()].sort()).toEqual(["k1", "k2"]);
  });

  it("finds a Document confirmed before its fingerprint was kept, by hashing its bytes", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("old", one, { sha256: null }), doc("k2", two)], store({ old: one, k2: two }));
    expect(found.keys).toEqual(new Map([[sha(one), "old"]]));
  });

  it("does not find a photo no Document has", async () => {
    const found = await findPhotos(new Set([sha(one), sha(bytes("gone"))]), [doc("k1", one)], store({ k1: one }));
    expect([...found.keys.keys()]).toEqual([sha(one)]);
  });

  it("does not find a photo whose file in storage is no longer what the record printed", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("k1", one)], store({ k1: two }));
    expect(found.keys.size).toBe(0);
  });

  it("does not find a photo whose file is gone from storage", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("k1", one)], store({}));
    expect(found.keys.size).toBe(0);
  });
});

describe("findPhotos with the record's Signatures, logos and Stamps", () => {
  it("finds them within their own budget, as the job inlines them, beside photos that take the photos' budget", async () => {
    // Seven photos of about 5.5 MB (38.5 MB of the photos' 40 MB) and 2 MB of Signatures, logos and Stamps.
    const photo = (n: number) => new Uint8Array(5_500_000).fill(n);
    const mark = (n: number) => new Uint8Array(500_000).fill(100 + n);
    const photos = [1, 2, 3, 4, 5, 6, 7].map(photo);
    const marks = [1, 2, 3, 4].map(mark);
    const contents = Object.fromEntries([...photos.map((b, i) => [`p${i}`, b]), ...marks.map((b, i) => [`m${i}`, b])]);
    const found = await findPhotos(
      new Set([...photos, ...marks].map(sha)),
      photos.map((b, i) => doc(`p${i}`, b)),
      store(contents),
      marks.map((b, i) => doc(`m${i}`, b, { contentType: "image/png" })),
    );
    expect(found.keys.size).toBe(11);
    expect(found.images.size).toBe(11);
  });
});

describe("unreadableVersion", () => {
  it("names the layout version of Record Data made before this version, which a Re-produce can't read", () => {
    expect(unreadableVersion('<recordData xmlns="https://rabaed.com/ns/record-data/2" layoutVersion="2" language="en">')).toMatch(/Record Data version 2.*cannot be re-produced/);
    expect(unreadableVersion(`<recordData xmlns="${RECORD_DATA_NAMESPACE}" layoutVersion="${LAYOUT_VERSION}" language="en">`)).toBeNull();
  });
});

describe("recordDataFacts", () => {
  const xml = recordDataXml({
    ...goldenData("B", "en"),
    pages: { comments: 4, reply: 6 },
    reply: { text: "Long…", cut: true },
    appendix: [{ way: "pages", fileName: "Plan.pdf", sha256: sha(bytes("plan")), pageCount: 2, pages: { first: 9, last: 10 } }],
  });

  it("lets only where things land on the pages move (LAYOUT_DERIVED)", () => {
    const moved = xml.replace('<comments page="4"', '<comments page="5"').replace('<replyFullText page="6"/>', '<replyFullText page="7"/>').replace('first="9" last="10"', 'first="11" last="12"');
    expect(moved).not.toBe(xml);
    expect(recordDataFacts(moved)).toBe(recordDataFacts(xml));
    expect(LAYOUT_DERIVED.map((d) => d.what)).toHaveLength(3);
  });

  it("keeps every fact: a name, a Code, a fingerprint", () => {
    const name = goldenData("B", "en").cards[0]!.name.en!;
    for (const changed of [xml.replace(name, `${name}x`), xml.replace('code="B"', 'code="C"'), xml.replace(sha(bytes("plan")), sha(bytes("other")))]) {
      expect(changed).not.toBe(xml);
      expect(recordDataFacts(changed)).not.toBe(recordDataFacts(xml));
    }
  });
});

describe("appendixFrom", () => {
  // A PNG the appendix gives a page, and a file it carries inside the PDF.
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
  const dwg = bytes("a drawing");
  const listed: RecordData["appendix"] = [
    { way: "pages", fileName: "Site.png", sha256: sha(png), pageCount: 1, pages: { first: 5, last: 5 } },
    { way: "attached", fileName: "Model.dwg", sha256: sha(dwg), tooManyPages: false },
    { way: "held", fileName: "Survey.zip", sha256: sha(bytes("too large")) },
  ];
  const documents = [
    doc("k-png", png, { fileName: "Site.png", contentType: "image/png" }),
    doc("k-dwg", dwg, { fileName: "Model.dwg", contentType: "application/acad", sha256: null }),
  ];

  it("carries again the files the stored Record Data lists, found by their fingerprints", async () => {
    const { appendix, problems } = await appendixFrom(listed, documents, store({ "k-png": png, "k-dwg": dwg }));
    expect(problems).toEqual([]);
    expect(appendix.entries).toEqual(listed);
    expect([...appendix.drawn].map(([index, source]) => [index, source.kind])).toEqual([[0, "image"]]);
    expect(appendix.attachments.map((a) => [a.name, a.mimeType, a.description])).toEqual([["Model.dwg", "application/acad", "Appendix 2: Model.dwg"]]);
  });

  it("names each file it can't find as the record carried it", async () => {
    const { problems } = await appendixFrom(listed, documents, store({ "k-png": png, "k-dwg": bytes("changed") }));
    expect(problems).toEqual([expect.stringContaining("Model.dwg")]);
  });
});

describe("replacedRecordKey", () => {
  it("keeps the replaced PDF beside the record, by its fingerprint", () => {
    expect(replacedRecordKey("projects/p/work-items/w/documental-record/record.pdf", "ab")).toBe("projects/p/work-items/w/documental-record/replaced/ab.pdf");
  });
});
