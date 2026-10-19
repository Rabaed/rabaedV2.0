import { describe, expect, it } from "vitest";
import { saveSignatureRequest, SIGNATURE_MAX_BYTES, signatureReturnPath } from "./signature.ts";

describe("signatureReturnPath", () => {
  it("takes the Member back to the item, or the Project, they came from", () => {
    expect(signatureReturnPath("/work-items/2c28a260-690e-4970-a79e-f14046b2d50a")).toBe("/work-items/2c28a260-690e-4970-a79e-f14046b2d50a");
    expect(signatureReturnPath("/projects/2c28a260-690e-4970-a79e-f14046b2d50a/submittals")).toBe(
      "/projects/2c28a260-690e-4970-a79e-f14046b2d50a/submittals",
    );
  });

  it("is null for anywhere else: another site, a scheme, a protocol-relative link, a path that climbs, or nothing", () => {
    for (const value of [
      "https://evil.example/work-items/1",
      "//evil.example/work-items/1",
      "javascript:alert(1)",
      "/work-items/../../admin",
      "/work-items/1?next=//evil.example",
      "/\\evil.example",
      "/members",
      "",
      null,
      undefined,
    ]) {
      expect(signatureReturnPath(value), String(value)).toBeNull();
    }
  });
});

describe("saveSignatureRequest", () => {
  it("takes base64 up to the largest Signature image, and refuses more", () => {
    const fits = Buffer.alloc(SIGNATURE_MAX_BYTES).toString("base64");
    expect(saveSignatureRequest.safeParse({ method: "drawn", contentType: "image/png", data: fits }).success).toBe(true);
    const tooBig = Buffer.alloc(SIGNATURE_MAX_BYTES + 3).toString("base64");
    expect(saveSignatureRequest.safeParse({ method: "drawn", contentType: "image/png", data: tooBig }).success).toBe(false);
  });

  it("refuses an image type other than PNG or JPEG, and a way of making it other than the three", () => {
    expect(saveSignatureRequest.safeParse({ method: "drawn", contentType: "image/svg+xml", data: "AAAA" }).success).toBe(false);
    expect(saveSignatureRequest.safeParse({ method: "scanned", contentType: "image/png", data: "AAAA" }).success).toBe(false);
  });
});
