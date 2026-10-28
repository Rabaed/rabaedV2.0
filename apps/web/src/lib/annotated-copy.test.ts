import { startDocumentUploadRequest } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { annotatedCopyFile, annotatedCopyRequest } from "./annotated-copy";

const original = "0199a3b0-0000-7000-8000-000000000301";
const drawn = () => new Blob([new Uint8Array(2048)], { type: "image/jpeg" });

describe("an annotated copy (RP-656, RP-1056)", () => {
  it("is a JPEG named after its original, never replacing it", () => {
    expect(annotatedCopyFile("ceiling.jpg", drawn())).toMatchObject({ name: "ceiling-annotated.jpg", type: "image/jpeg", size: 2048 });
    expect(annotatedCopyFile("IMG_0042.HEIC", drawn()).name).toBe("IMG_0042-annotated.jpg");
    expect(annotatedCopyFile("no-extension", drawn()).name).toBe("no-extension-annotated.jpg");
  });

  it("keeps the name within the api's 255 characters", () => {
    expect(annotatedCopyFile(`${"a".repeat(260)}.jpg`, drawn()).name).toHaveLength(255);
  });

  it("is declared by its original alone: the api puts it in the original's field, item and reply", () => {
    const request = annotatedCopyRequest(original, annotatedCopyFile("gap.jpg", drawn()));
    expect(request).toEqual({ fileName: "gap-annotated.jpg", sizeBytes: 2048, contentType: "image/jpeg", annotatedFromId: original });
    // A reply photo's copy is still declared without `reply`: the schema refuses a reply file naming an original.
    expect(startDocumentUploadRequest.safeParse(request).success).toBe(true);
  });
});
