import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { applyUatCors, r2AdminFromEnv, uatCorsRules } from "./uat-cors.ts";

describe("the UAT files bucket's CORS", () => {
  it("lets only the UAT web origin PUT and GET, with its content type, for ten minutes", () => {
    expect(uatCorsRules("https://rabaed-uat.vercel.app")).toEqual([
      { AllowedOrigins: ["https://rabaed-uat.vercel.app"], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 600 },
    ]);
  });

  it("takes the origin with a trailing slash or capitals, as a browser sends it: without them", () => {
    expect(uatCorsRules("https://rabaed-uat.vercel.app/")[0]!.AllowedOrigins).toEqual(["https://rabaed-uat.vercel.app"]);
    expect(uatCorsRules("https://Rabaed-UAT.vercel.app")[0]!.AllowedOrigins).toEqual(["https://rabaed-uat.vercel.app"]);
  });

  it.each([
    ["*", "any origin"],
    ["", "no origin"],
    ["   ", "a blank origin"],
    ["https://*.vercel.app", "a wildcard"],
    ["http://rabaed-uat.vercel.app", "plain http"],
    ["https://rabaed-uat.vercel.app/en/sign-in", "a path"],
    ["https://rabaed-uat.vercel.app?x=1", "a query"],
    ["https://a.vercel.app,https://b.vercel.app", "two origins"],
    ["rabaed-uat.vercel.app", "no scheme"],
  ])("refuses %j (%s)", (origin) => {
    expect(() => uatCorsRules(origin)).toThrow(/UAT web origin/);
  });

  it("sets the rules on the bucket, then reads them back", async () => {
    const sent: { name: string; input: unknown }[] = [];
    const rules = uatCorsRules("https://rabaed-uat.vercel.app");
    const client = {
      send: async (command: { input: unknown }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        return command.constructor.name === "GetBucketCorsCommand" ? { CORSRules: rules } : {};
      },
    } as unknown as S3Client;
    expect(await applyUatCors(client, "rabaed-uat-files", "https://rabaed-uat.vercel.app")).toEqual(rules);
    expect(sent).toEqual([
      { name: "PutBucketCorsCommand", input: { Bucket: "rabaed-uat-files", CORSConfiguration: { CORSRules: rules } } },
      { name: "GetBucketCorsCommand", input: { Bucket: "rabaed-uat-files" } },
    ]);
  });

  it("fails when the bucket reads back other rules", async () => {
    const client = { send: async () => ({ CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["GET"] }] }) } as unknown as S3Client;
    await expect(applyUatCors(client, "rabaed-uat-files", "https://rabaed-uat.vercel.app")).rejects.toThrow(/read back/);
  });
});

describe("the key the UAT CORS is set with", () => {
  const uat = {
    PROJECT_FILES_BUCKET: "rabaed-uat-files",
    FILE_STORE_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com",
    FILE_STORE_REGION: "auto",
    FILE_STORE_ACCESS_KEY_ID: "files-id",
    FILE_STORE_SECRET_ACCESS_KEY: "files-secret",
  };

  it("is the R2 admin key, never the app's", () => {
    expect(r2AdminFromEnv({ ...uat, R2_ADMIN_ACCESS_KEY_ID: "admin-id", R2_ADMIN_SECRET_ACCESS_KEY: "admin-secret" })).toEqual({
      bucket: "rabaed-uat-files",
      endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "admin-id", secretAccessKey: "admin-secret" },
    });
  });

  it("refuses to run with only the app's key", () => {
    expect(() => r2AdminFromEnv(uat)).toThrow(/R2_ADMIN_ACCESS_KEY_ID and R2_ADMIN_SECRET_ACCESS_KEY/);
    expect(() => r2AdminFromEnv({ ...uat, R2_ADMIN_ACCESS_KEY_ID: "admin-id" })).toThrow(/R2_ADMIN_SECRET_ACCESS_KEY/);
  });

  it.each([
    ["the local store", { FILE_STORE_ENDPOINT: "http://127.0.0.1:9000" }],
    ["AWS", { FILE_STORE_ENDPOINT: undefined, AWS_REGION: "me-central-1" }],
  ])("refuses %s", (_where, env) => {
    expect(() => r2AdminFromEnv({ ...uat, R2_ADMIN_ACCESS_KEY_ID: "admin-id", R2_ADMIN_SECRET_ACCESS_KEY: "admin-secret", ...env })).toThrow(/R2's S3 address/);
  });
});
