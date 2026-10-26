import { describe, expect, it } from "vitest";
import { projectFilesFromEnv, s3Client } from "./files.ts";

const local = {
  PROJECT_FILES_BUCKET: "rabaed-project-files",
  FILE_STORE_ENDPOINT: "http://127.0.0.1:9000",
  FILE_STORE_ACCESS_KEY_ID: "rabaed-local",
  FILE_STORE_SECRET_ACCESS_KEY: "local-dev-only",
};

describe("the worker's Project files bucket", () => {
  it("locally, signs for the store in Docker as before", () => {
    expect(projectFilesFromEnv(local).region).toBe("us-east-1");
  });

  it("on R2, signs for the region the environment names (auto)", () => {
    const settings = projectFilesFromEnv({ ...local, FILE_STORE_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com", FILE_STORE_REGION: "auto" });
    expect(settings).toEqual({
      bucket: "rabaed-project-files",
      endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "rabaed-local", secretAccessKey: "local-dev-only" },
    });
  });

  it("with an endpoint, never the platform's AWS_REGION", () => {
    expect(projectFilesFromEnv({ ...local, AWS_REGION: "eu-central-1" }).region).toBe("us-east-1");
  });

  it("in AWS, the task's region", () => {
    expect(projectFilesFromEnv({ PROJECT_FILES_BUCKET: "rabaed-dev-files", AWS_REGION: "me-central-1", FILE_STORE_REGION: "auto" })).toEqual({
      bucket: "rabaed-dev-files",
      region: "me-central-1",
    });
  });

  it("computes and checks checksums only where an operation requires one, as R2 accepts", async () => {
    const client = s3Client(projectFilesFromEnv({ ...local, FILE_STORE_REGION: "auto" }));
    expect(await client.config.region()).toBe("auto");
    expect(await client.config.requestChecksumCalculation()).toBe("WHEN_REQUIRED");
    expect(await client.config.responseChecksumValidation()).toBe("WHEN_REQUIRED");
  });
});
