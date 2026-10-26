import { describe, expect, it } from "vitest";
import { objectStoreClientConfig, objectStoreFromEnv } from "./object-store.ts";

const r2 = {
  PROJECT_FILES_BUCKET: "rabaed-uat-files",
  FILE_STORE_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
  FILE_STORE_REGION: "auto",
  FILE_STORE_ACCESS_KEY_ID: "files-id",
  FILE_STORE_SECRET_ACCESS_KEY: "files-secret",
  AWS_REGION: "fra1",
};

describe("an object store from the environment", () => {
  it("is the Project files bucket at FILE_STORE_ENDPOINT with the app's key, signing in FILE_STORE_REGION, never AWS_REGION", () => {
    expect(objectStoreFromEnv(r2)).toEqual({
      bucket: "rabaed-uat-files",
      endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "files-id", secretAccessKey: "files-secret" },
    });
    expect(objectStoreFromEnv({ ...r2, FILE_STORE_REGION: undefined }).region).toBe("us-east-1");
  });

  it("is the AWS bucket in AWS_REGION with the task role when there is no endpoint", () => {
    expect(objectStoreFromEnv({ PROJECT_FILES_BUCKET: "rabaed-dev-files", AWS_REGION: "me-central-1" })).toEqual({
      bucket: "rabaed-dev-files",
      region: "me-central-1",
    });
    expect(() => objectStoreFromEnv({ PROJECT_FILES_BUCKET: "rabaed-dev-files" })).toThrow(/No file store/);
  });

  it("reads another bucket and key by the names given, never falling back to the app's key", () => {
    const names = { bucket: "OTHER_BUCKET", accessKeyId: "OTHER_ACCESS_KEY_ID", secretAccessKey: "OTHER_SECRET_ACCESS_KEY" };
    expect(objectStoreFromEnv({ ...r2, OTHER_BUCKET: "rabaed-other", OTHER_ACCESS_KEY_ID: "o-id", OTHER_SECRET_ACCESS_KEY: "o-secret" }, names)).toMatchObject({
      bucket: "rabaed-other",
      credentials: { accessKeyId: "o-id", secretAccessKey: "o-secret" },
    });
    expect(() => objectStoreFromEnv({ ...r2, OTHER_BUCKET: "rabaed-other" }, names)).toThrow(/OTHER_ACCESS_KEY_ID and OTHER_SECRET_ACCESS_KEY/);
  });

  it("asks for checksums only where an operation requires one, path-style at an endpoint", () => {
    expect(objectStoreClientConfig(objectStoreFromEnv(r2))).toEqual({
      region: "auto",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
      forcePathStyle: true,
      credentials: { accessKeyId: "files-id", secretAccessKey: "files-secret" },
    });
    expect(objectStoreClientConfig({ bucket: "rabaed-dev-files", region: "me-central-1" })).toEqual({
      region: "me-central-1",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });
});
