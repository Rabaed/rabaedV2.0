import { describe, expect, it } from "vitest";
import { isPinnedImage, parseVeraPdfReport, PINNED_VERAPDF_IMAGE, veraPdfFromEnv, veraPdfSessionArgs } from "./verapdf.ts";

// veraPDF's XML report as the checks read it (the real validation runs at seam 1).

const report = (attrs: string, body = "") => `<report><jobs><job><validationReport ${attrs}>${body}</validationReport></job></jobs></report>`;

describe("parseVeraPdfReport", () => {
  it("passes a compliant file", () => {
    expect(parseVeraPdfReport(report('jobEndStatus="normal" isCompliant="true"', '<details passedRules="146" failedRules="0"/>'))).toEqual({ compliant: true, problems: [] });
  });

  it("names each failed rule by its clause", () => {
    const body = `<details>
      <rule specification="ISO 19005-3:2012" clause="6.6.2.1" testNumber="1" status="failed" failedChecks="1">
        <description>The Catalog dictionary shall contain the Metadata key &amp; more</description>
        <check status="failed"><errorMessage>no metadata</errorMessage></check>
      </rule>
      <rule specification="ISO 19005-3:2012" clause="6.2.4.3" testNumber="2" status="failed" failedChecks="779">
        <description>DeviceRGB shall only be
          used with an output intent</description>
      </rule>
    </details>`;
    expect(parseVeraPdfReport(report('jobEndStatus="normal" isCompliant="false"', body))).toEqual({
      compliant: false,
      problems: [
        "PDF/A-3 6.6.2.1: The Catalog dictionary shall contain the Metadata key & more",
        "PDF/A-3 6.2.4.3: DeviceRGB shall only be used with an output intent",
      ],
    });
  });

  it("fails a file veraPDF could not read", () => {
    expect(parseVeraPdfReport("<report><jobs><job><taskResult><exceptionMessage>not a PDF</exceptionMessage></taskResult></job></jobs></report>")).toEqual({
      compliant: false,
      problems: ["veraPDF could not validate it: not a PDF"],
    });
    expect(parseVeraPdfReport(report('jobEndStatus="timeout" isCompliant="false"')).compliant).toBe(false);
  });

  it("never passes a report it does not understand", () => {
    expect(parseVeraPdfReport("nothing").compliant).toBe(false);
  });
});

describe("veraPdfSessionArgs (RP-1122)", () => {
  const args = veraPdfSessionArgs({ image: "verapdf/cli:1.28.2", dir: "/tmp/rabaed-verapdf-x", hash: "0a1b2c3d", pid: 4312, n: 2 });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("names and labels the container so lanes:prune finds it after a killed test", () => {
    expect(after("--name")).toBe("rabaed-verapdf-0a1b2c3d-4312-2");
    expect(after("--label")).toBe("rabaed.verapdf=0a1b2c3d");
  });

  it("sleeps an hour, not forever, and is removed when the sleep ends", () => {
    expect(args).toContain("--rm");
    expect(after("--entrypoint")).toBe("sleep");
    expect(args.slice(-2)).toEqual(["verapdf/cli:1.28.2", "3600"]);
    expect(args).not.toContain("infinity");
  });

  it("mounts the PDF folder read-only and runs detached", () => {
    expect(args.slice(0, 2)).toEqual(["run", "-d"]);
    expect(after("-v")).toBe("/tmp/rabaed-verapdf-x:/data:ro");
  });
});

describe("veraPdfFromEnv", () => {
  it("is never inferred", () => {
    expect(() => veraPdfFromEnv({})).toThrow(/VERAPDF is not set/);
    expect(() => veraPdfFromEnv({ VERAPDF: "cli" })).toThrow(/VERAPDF_PATH/);
    expect(veraPdfFromEnv({ VERAPDF: "docker", VERAPDF_IMAGE: PINNED_VERAPDF_IMAGE }).validate).toBeTypeOf("function");
  });

  it("runs only a pinned image: a version tag or a digest, never latest, an untagged name or none", () => {
    for (const image of [undefined, "verapdf/cli", "verapdf/cli:latest", "verapdf/cli:", "registry:5000/verapdf/cli"]) {
      expect(() => veraPdfFromEnv({ VERAPDF: "docker", ...(image ? { VERAPDF_IMAGE: image } : {}) }), String(image)).toThrow(/VERAPDF_IMAGE/);
    }
    for (const image of ["verapdf/cli:1.28.2", "registry:5000/verapdf/cli:1.28.2", PINNED_VERAPDF_IMAGE]) expect(isPinnedImage(image), image).toBe(true);
  });
});
