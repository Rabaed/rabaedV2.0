import { describe, expect, it } from "vitest";
import { recordSealingFromEnv } from "./from-env.ts";
import { LOCAL_SEAL_NAME } from "./signer.ts";
import { parseCertificate, commonNameOf } from "./pki.ts";

// RECORD_SEALING picks the seal's adapters explicitly (ADR 0023): never the local
// test key in AWS, and nothing guessed from other settings.

const ecs = { ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/task" };

describe("RECORD_SEALING", () => {
  it("local: the in-memory test key, off ECS", async () => {
    const sealing = recordSealingFromEnv({ RECORD_SEALING: "local" });
    const signer = await sealing.signer();
    expect(commonNameOf(parseCertificate(signer.certificates[0]!))).toBe(LOCAL_SEAL_NAME);
  });

  it("local is refused outright on ECS, so AWS never seals with the test key", () => {
    expect(() => recordSealingFromEnv({ RECORD_SEALING: "local", ...ecs })).toThrow(/never sealed with the local test key/);
  });

  it("unset: nothing is guessed from the file store, and every record job fails saying so", async () => {
    const sealing = recordSealingFromEnv({ FILE_STORE_ENDPOINT: "http://127.0.0.1:9000" });
    await expect(sealing.signer()).rejects.toThrow("RECORD_SEALING is not set");
    await expect(sealing.timestamps()).rejects.toThrow("RECORD_SEALING is not set");
  });

  it("kms: fails the job when its key or timestamp authority is not configured, never falling back to local", async () => {
    const sealing = recordSealingFromEnv({ RECORD_SEALING: "kms", ...ecs, FILE_STORE_ENDPOINT: "http://127.0.0.1:9000" });
    await expect(sealing.signer()).rejects.toThrow("PDF_SEALING_KEY_ID is not set");
    await expect(sealing.timestamps()).rejects.toThrow("TIMESTAMP_AUTHORITY_URL is not set");
  });

  it("refuses any other value", () => {
    expect(() => recordSealingFromEnv({ RECORD_SEALING: "test" })).toThrow();
  });
});
