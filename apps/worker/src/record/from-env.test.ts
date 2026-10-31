import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordSealingFromEnv } from "./from-env.ts";
import { LOCAL_SEAL_NAME } from "./signer.ts";
import { parseCertificate, commonNameOf } from "./pki.ts";
import { LOCAL_TSA_NAME, tokenCertificates } from "./timestamp.ts";
import { newUatAuthority, UAT_AUTHORITY_NAME, UAT_SIGNER_NAME } from "./uat-signer.ts";

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

  it("local: the free fallback font, unless RECORD_FONTS_DIR names the Thmanyah files baked into the Records image (UAT)", async () => {
    expect((await recordSealingFromEnv({ RECORD_SEALING: "local" }).fonts()).family).toBe("Record Sans");
    const dir = mkdtempSync(join(tmpdir(), "rabaed-record-fonts-"));
    try {
      expect((await recordSealingFromEnv({ RECORD_SEALING: "local", RECORD_FONTS_DIR: dir }).fonts()).family).toBe("Record Sans");
      writeFileSync(join(dir, "thmanyahsans-regular.woff2"), "not really a font");
      writeFileSync(join(dir, "README.txt"), "ignored");
      const fonts = await recordSealingFromEnv({ RECORD_SEALING: "local", RECORD_FONTS_DIR: dir }).fonts();
      expect(fonts.family).toBe("'Record Thmanyah', 'Record Sans'");
      expect(fonts.css).toContain(`font-weight: 400; src: url(data:font/woff2;base64,${Buffer.from("not really a font").toString("base64")})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("uat (the UAT Records container, RP-1042)", () => {
    const secrets = async () => {
      const authority = await newUatAuthority();
      return { UAT_SEALING_AUTHORITY_KEY: authority.key, UAT_SEALING_AUTHORITY_CERTIFICATE: authority.certificate };
    };

    it("seals under the UAT authority the host's secrets hold, with the timestamp stand-in, and marks every page", async () => {
      const sealing = recordSealingFromEnv({ RECORD_SEALING: "uat", ...(await secrets()) });
      const signer = await sealing.signer();
      expect(signer.test).toBe(true);
      expect(commonNameOf(parseCertificate(signer.certificates[0]!))).toBe(UAT_SIGNER_NAME);
      expect(commonNameOf(parseCertificate(signer.certificates[1]!))).toBe(UAT_AUTHORITY_NAME);
      const token = await (await sealing.timestamps()).timestamp(new Uint8Array(32));
      expect(commonNameOf(parseCertificate(tokenCertificates(token)[0]!))).toBe(LOCAL_TSA_NAME);
      expect(sealing.uatMark).toBe(true);
    });

    it("takes secrets whose line breaks the host's dashboard kept as \\n", async () => {
      const s = await secrets();
      const escaped = { UAT_SEALING_AUTHORITY_KEY: s.UAT_SEALING_AUTHORITY_KEY.replaceAll("\n", "\\n"), UAT_SEALING_AUTHORITY_CERTIFICATE: s.UAT_SEALING_AUTHORITY_CERTIFICATE.replaceAll("\n", "\\n") };
      expect((await recordSealingFromEnv({ RECORD_SEALING: "uat", ...escaped }).signer()).test).toBe(true);
    });

    it("fails every record job, saying so, when the secrets are not set", async () => {
      await expect(recordSealingFromEnv({ RECORD_SEALING: "uat" }).signer()).rejects.toThrow("UAT_SEALING_AUTHORITY_KEY and UAT_SEALING_AUTHORITY_CERTIFICATE are not set");
    });

    it("is refused outright on ECS, as local is", () => {
      expect(() => recordSealingFromEnv({ RECORD_SEALING: "uat", ...ecs })).toThrow(/never sealed with the UAT test key/);
    });

    it("empty secrets count as unset: local still starts, and uat fails its jobs saying they are not set", async () => {
      // A lane's .env copied from .env.example once held them as "" (Main 6's review of #560).
      const empty = { UAT_SEALING_AUTHORITY_KEY: "", UAT_SEALING_AUTHORITY_CERTIFICATE: "" };
      expect((await recordSealingFromEnv({ RECORD_SEALING: "local", ...empty }).signer()).test).toBe(true);
      await expect(recordSealingFromEnv({ RECORD_SEALING: "uat", ...empty }).signer()).rejects.toThrow("UAT_SEALING_AUTHORITY_KEY and UAT_SEALING_AUTHORITY_CERTIFICATE are not set");
    });

    it("local and kms print no mark", () => {
      expect(recordSealingFromEnv({ RECORD_SEALING: "local" }).uatMark).toBe(false);
      expect(recordSealingFromEnv({ RECORD_SEALING: "kms", ...ecs }).uatMark).toBe(false);
    });

    it("uses the Thmanyah files in RECORD_FONTS_DIR, as local does", async () => {
      expect((await recordSealingFromEnv({ RECORD_SEALING: "uat" }).fonts()).family).toBe("Record Sans");
    });
  });

  it("refuses any other value", () => {
    expect(() => recordSealingFromEnv({ RECORD_SEALING: "test" })).toThrow();
  });
});
