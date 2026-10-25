import { describe, expect, it } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { contentDisposition, createFileStore, ensureLocalBucket, fileStoreSettingsFromEnv, isLocalFileStore } from "./file-store.ts";

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

describe("signed URLs a browser can use on R2", () => {
  const r2 = fileStoreSettingsFromEnv({
    PROJECT_FILES_BUCKET: "rabaed-uat-files",
    FILE_STORE_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
    FILE_STORE_REGION: "auto",
    FILE_STORE_ACCESS_KEY_ID: "placeholder-id",
    FILE_STORE_SECRET_ACCESS_KEY: "placeholder-secret",
  });
  const signedAt = new Date("2026-10-26T09:00:00Z");

  it("signs an upload over its type and length only, asking for no checksum the browser cannot send", async () => {
    const upload = await createFileStore(r2).signUpload("projects/p/work-items/w/documents/d", { contentType: "application/pdf", sizeBytes: 1234 }, signedAt);
    const url = new URL(upload.url);
    expect(url.host).toBe("0123456789abcdef.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/rabaed-uat-files/projects/p/work-items/w/documents/d");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("placeholder-id/20261026/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    expect(upload.headers).toEqual({ "content-type": "application/pdf" });
  });

  it("signs a download for five minutes, with no checksum mode", async () => {
    const download = await createFileStore(r2).signDownload("projects/p/work-items/w/documents/d", { fileName: "a.pdf", contentType: "application/pdf" }, signedAt);
    const url = new URL(download.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    expect(download.expiresAt).toBe("2026-10-26T09:05:00.000Z");
  });
});

describe("the local store's bucket", () => {
  /** A client that records the commands it is sent; HeadBucket answers 404 so the bucket is "missing". */
  const recording = () => {
    const sent: string[] = [];
    const client = {
      send: async (command: object) => {
        sent.push(command.constructor.name);
        if (command.constructor.name === "HeadBucketCommand") throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
        return {};
      },
    } as unknown as S3Client;
    return { sent, client };
  };

  it("on this machine, is created and opened to the lane's browser", async () => {
    const { sent, client } = recording();
    expect(isLocalFileStore(fileStoreSettingsFromEnv(local))).toBe(true);
    expect(await ensureLocalBucket(fileStoreSettingsFromEnv(local), client)).toBe(true);
    expect(sent).toEqual(["HeadBucketCommand", "CreateBucketCommand", "PutBucketCorsCommand"]);
  });

  it("on localhost and ::1 too", () => {
    for (const endpoint of ["http://localhost:9300", "http://[::1]:9000"]) {
      expect(isLocalFileStore(fileStoreSettingsFromEnv({ ...local, FILE_STORE_ENDPOINT: endpoint }))).toBe(true);
    }
  });

  it("on R2 or any other host, is never touched: its CORS stays limited to the UAT web origin", async () => {
    for (const endpoint of ["https://0123456789abcdef.r2.cloudflarestorage.com", "http://127.0.0.1.example.com:9000", "http://files:9000"]) {
      const { sent, client } = recording();
      const settings = fileStoreSettingsFromEnv({ ...local, FILE_STORE_ENDPOINT: endpoint });
      expect(isLocalFileStore(settings)).toBe(false);
      expect(await ensureLocalBucket(settings, client)).toBe(false);
      expect(sent).toEqual([]);
    }
  });

  it("in AWS, the storage stack's", () => {
    expect(isLocalFileStore({ bucket: "rabaed-dev-files", region: "me-central-1" })).toBe(false);
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
