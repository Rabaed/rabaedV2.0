import { RECORD_OBJECTS } from "@rabaed/db";
import { iamPatternMatches } from "@rabaed/db/test-support/iam-pattern";
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { replacedRecordKey } from "./reproduce.ts";
import { filesUnder, projectFilesFromEnv, recordKeys, s3Client, workingCopyKey } from "./files.ts";

// The infrastructure refuses the api any write under this pattern (RP-1084), so every record file
// the worker writes must fall inside it, or a sealed record could be overwritten through the api.
describe("every record file the worker writes is one the api may not overwrite or delete", () => {
  const { pdf, recordData } = recordKeys("p1", "w1");

  it("an item's record keeps one location for good (ADR 0023)", () => {
    expect(recordKeys("p1", "w1")).toEqual({
      pdf: "projects/p1/work-items/w1/documental-record/record.pdf",
      recordData: "projects/p1/work-items/w1/documental-record/record-data.xml",
    });
    expect(workingCopyKey("p1", "w1", "c1")).toBe("projects/p1/work-items/w1/documental-record/working-copies/c1.pdf");
  });

  it.each([pdf, recordData, replacedRecordKey(pdf, "ab12"), workingCopyKey("p1", "w1", "c1")])("%s is a record file", (key) => {
    expect(iamPatternMatches(RECORD_OBJECTS, key)).toBe(true);
  });
});

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

// ListObjectsV2 returns at most 1000 keys a call; the rest come by continuation token (RP-1086).
describe("filesUnder", () => {
  it("reads every page of the listing", async () => {
    const pages: Record<string, { keys: string[]; next?: string }> = {
      first: { keys: ["fonts/", "fonts/a.otf"], next: "second" },
      second: { keys: ["fonts/b.otf"] },
    };
    const client = {
      send: async (command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          const page = pages[command.input.ContinuationToken ?? "first"]!;
          return { Contents: page.keys.map((Key) => ({ Key })), IsTruncated: page.next !== undefined, NextContinuationToken: page.next };
        }
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => new TextEncoder().encode(command.input.Key) } };
        }
        throw new Error("unexpected command");
      },
    } as unknown as S3Client;
    const files = await filesUnder(client, "bucket", "fonts/");
    expect([...files.keys()]).toEqual(["a.otf", "b.otf"]);
  });
});
