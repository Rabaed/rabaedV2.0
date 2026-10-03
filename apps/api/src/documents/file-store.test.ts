import { describe, expect, it } from "vitest";
import { contentDisposition, fileStoreSettingsFromEnv } from "./file-store.ts";

const local = {
  PROJECT_FILES_BUCKET: "rabaed-project-files",
  FILE_STORE_ENDPOINT: "http://127.0.0.1:9000",
  FILE_STORE_ACCESS_KEY_ID: "rabaed-local",
  FILE_STORE_SECRET_ACCESS_KEY: "local-dev-only",
};

describe("the file store's settings", () => {
  it("locally, use the store in Docker with its own keys", () => {
    expect(fileStoreSettingsFromEnv(local)).toEqual({
      bucket: "rabaed-project-files",
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      credentials: { accessKeyId: "rabaed-local", secretAccessKey: "local-dev-only" },
    });
  });

  it("locally, never fall back to the machine's AWS credentials", () => {
    expect(() => fileStoreSettingsFromEnv({ ...local, FILE_STORE_SECRET_ACCESS_KEY: undefined })).toThrow(/FILE_STORE_SECRET_ACCESS_KEY/);
  });

  it("in AWS, use the Project files bucket with the task role", () => {
    expect(fileStoreSettingsFromEnv({ PROJECT_FILES_BUCKET: "rabaed-dev-files", AWS_REGION: "me-central-1" })).toEqual({
      bucket: "rabaed-dev-files",
      region: "me-central-1",
    });
  });

  it("refuse to start with neither", () => {
    expect(() => fileStoreSettingsFromEnv({ PROJECT_FILES_BUCKET: "rabaed-project-files" })).toThrow(/No file store/);
  });
});

describe("a download's Content-Disposition", () => {
  it("opens PDFs and images in the browser, and saves anything else", () => {
    expect(contentDisposition("datasheet.pdf", "application/pdf")).toMatch(/^inline;/);
    expect(contentDisposition("photo.png", "image/png")).toMatch(/^inline;/);
    expect(contentDisposition("boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toMatch(/^attachment;/);
  });

  it("keeps an Arabic file name, with a plain fallback", () => {
    expect(contentDisposition('مخطط "أ".pdf', "application/pdf")).toBe(
      `inline; filename="____ ___.pdf"; filename*=UTF-8''${encodeURIComponent('مخطط "أ".pdf')}`,
    );
  });
});
