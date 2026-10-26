import type { S3Client } from "@aws-sdk/client-s3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchThmanyahFonts, fontsBucketFromEnv, fontStaysPrivate, THMANYAH_FONTS_DIR } from "./thmanyah-fonts.ts";

/** A store holding `objects` (key → bytes) that answers ListObjectsV2 and GetObject, and records the keys asked for. */
function store(objects: Record<string, string>) {
  const got: string[] = [];
  const client = {
    send: async (command: { input: { Prefix?: string; Key?: string } }) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        return { Contents: Object.keys(objects).filter((k) => k.startsWith(command.input.Prefix!)).map((Key) => ({ Key })) };
      }
      const key = command.input.Key!;
      got.push(key);
      return { Body: { transformToByteArray: async () => new TextEncoder().encode(objects[key]) } };
    },
  } as unknown as S3Client;
  return { client, got };
}

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "rabaed-fonts-"));
  dirs.push(dir);
  return join(dir, "thmanyah");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the Thmanyah fonts for the web and Admin builds", () => {
  it("downloads every Thmanyah Sans weight under fonts/thmanyah/, and nothing else", async () => {
    const { client, got } = store({
      "fonts/thmanyah/thmanyahsans-Regular.woff2": "regular",
      "fonts/thmanyah/thmanyahsans-bold.woff2": "bold",
      "fonts/thmanyah/LICENSE.pdf": "licence",
      "fonts/thmanyah/thmanyahserif-regular.woff2": "serif",
      "fonts/other/thmanyahsans-light.woff2": "elsewhere",
    });
    const dir = scratch();
    const warnings: string[] = [];
    expect(await fetchThmanyahFonts({ client, bucket: "rabaed-uat-build-assets", dir, warn: (m) => warnings.push(m) })).toEqual([
      "thmanyahsans-Regular.woff2",
      "thmanyahsans-bold.woff2",
    ]);
    expect(got).toEqual(["fonts/thmanyah/thmanyahsans-Regular.woff2", "fonts/thmanyah/thmanyahsans-bold.woff2"]);
    expect(readdirSync(dir).sort()).toEqual(["thmanyahsans-Regular.woff2", "thmanyahsans-bold.woff2"]);
    expect(readFileSync(join(dir, "thmanyahsans-bold.woff2"), "utf8")).toBe("bold");
    expect(warnings).toEqual([]);
  });

  it("with no fonts in the bucket, warns and leaves the IBM Plex fallback", async () => {
    const { client } = store({ "fonts/thmanyah/LICENSE.pdf": "licence" });
    const warnings: string[] = [];
    expect(await fetchThmanyahFonts({ client, bucket: "rabaed-uat-build-assets", dir: scratch(), warn: (m) => warnings.push(m) })).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/No Thmanyah fonts .*IBM Plex Sans Arabic/)]);
  });

  it("writes only into the git-ignored folder the font switch reads (packages/ui/fonts/thmanyah)", () => {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    expect(relative(root, THMANYAH_FONTS_DIR).split(/[\\/]/).join("/")).toBe("packages/ui/fonts/thmanyah");
    // Exit 0: ignored, so a font fetched there can never be committed.
    execFileSync("git", ["check-ignore", "-q", join(THMANYAH_FONTS_DIR, "thmanyahsans-regular.woff2")], { cwd: root });
  });
});

describe("the fonts bucket's settings", () => {
  const uat = {
    FILE_STORE_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
    FILE_STORE_REGION: "auto",
    BUILD_ASSETS_BUCKET: "rabaed-uat-build-assets",
    FONTS_ACCESS_KEY_ID: "placeholder-id",
    FONTS_SECRET_ACCESS_KEY: "placeholder-secret",
  };

  it("reads the private bucket with the read-only fonts key, never the files key", () => {
    expect(fontsBucketFromEnv({ ...uat, FILE_STORE_ACCESS_KEY_ID: "files-id", FILE_STORE_SECRET_ACCESS_KEY: "files-secret" })).toEqual({
      bucket: "rabaed-uat-build-assets",
      endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "placeholder-id", secretAccessKey: "placeholder-secret" },
    });
  });

  it("is unset (the fallback font) when any of them is missing", () => {
    for (const name of Object.keys(uat).filter((n) => n !== "FILE_STORE_REGION")) {
      expect(fontsBucketFromEnv({ ...uat, [name]: undefined })).toBeNull();
    }
  });
});

describe("a font object without credentials", () => {
  const key = "fonts/thmanyah/thmanyahsans-regular.woff2";
  const s3Api = "https://0123456789abcdef.r2.cloudflarestorage.com/rabaed-uat-build-assets";
  const publicUrl = "https://pub-0123456789abcdef.r2.dev";

  it("is private when an unsigned GET is refused at the S3 address and at every public address the bucket could have", async () => {
    const asked: { url: string; headers: unknown }[] = [];
    const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(url), headers: init?.headers });
      return new Response("<Error><Code>AccessDenied</Code></Error>", { status: url.toString().includes("r2.dev") ? 404 : 403 });
    };
    expect(await fontStaysPrivate([s3Api, `${publicUrl}/`], key, fetchStub as typeof fetch)).toEqual({
      private: true,
      answers: [
        { url: `${s3Api}/${key}`, status: 403 },
        { url: `${publicUrl}/${key}`, status: 404 },
      ],
    });
    expect(asked.map((a) => a.headers)).toEqual([undefined, undefined]);
  });

  it("is public when any address serves it", async () => {
    const fetchStub = async (url: string | URL | Request) => new Response("font bytes", { status: url.toString().includes("r2.dev") ? 200 : 403 });
    expect((await fontStaysPrivate([s3Api, publicUrl], key, fetchStub as typeof fetch)).private).toBe(false);
  });

  it("needs an address to ask", async () => {
    await expect(fontStaysPrivate([], key)).rejects.toThrow(/address/);
  });
});