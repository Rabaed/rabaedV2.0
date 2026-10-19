import { describe, expect, it } from "vitest";
import { companyImageTypes } from "./company-image.ts";
import { imageFileExtension, imageFileTypes, isImageFileType } from "./image-file.ts";
import { signatureImageTypes } from "./signature.ts";

describe("image files (a Signature, a logo, a Stamp)", () => {
  it("are a PNG or a JPEG, for the Signature and the Company's images alike", () => {
    expect(imageFileTypes).toEqual(["image/png", "image/jpeg"]);
    expect(signatureImageTypes).toEqual(imageFileTypes);
    expect(companyImageTypes).toEqual(imageFileTypes);
  });

  it("are stored and downloaded as .png or .jpg", () => {
    expect(imageFileExtension("image/png")).toBe("png");
    expect(imageFileExtension("image/jpeg")).toBe("jpg");
  });

  it("take no other type a browser may give a chosen file", () => {
    expect(isImageFileType("image/png")).toBe(true);
    expect(isImageFileType("image/jpeg")).toBe(true);
    for (const type of ["image/svg+xml", "image/gif", "image/webp", "application/pdf", ""]) {
      expect(isImageFileType(type), type).toBe(false);
    }
  });
});
