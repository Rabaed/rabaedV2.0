import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { adminConfigFromEnv } from "../apps/admin/src/config.ts";
import { fontsBucketFromEnv } from "../apps/api/src/build-assets/thmanyah-fonts.ts";
import { apiConfigFromEnv } from "../apps/api/src/config.ts";
import { fileStoreSettingsFromEnv } from "../apps/api/src/documents/file-store.ts";
import { workerRunFromEnv } from "../apps/worker/src/outbox-mode.ts";
import { projectFilesFromEnv } from "../apps/worker/src/record/files.ts";
import { recordJobFromEnv, recordSealingFromEnv } from "../apps/worker/src/record/from-env.ts";
import { veraPdfFromEnv } from "../apps/worker/src/record/verapdf.ts";
import { connectionFromEnv, databaseUrlsFromEnv, poolMaxFromEnv } from "../packages/db/src/index.ts";
import { mailerFromEnv } from "../packages/mailer/src/index.ts";
import { laneEnv } from "./lanes.ts";

// RP-1196: every env schema the api, worker (its record job too), mailer and Rabaed Admin read, parsed against the .env a
// lane gets from .env.example (lane:env writes laneEnv's text). An empty `UAT_SEALING_AUTHORITY_KEY=` line there would have
// stopped the worker in every lane (#560), and CI never saw it: ci.yml sets its own env. Not here: r2AdminFromEnv (an
// operator's R2 admin key, never in a lane), outboxCronFromEnv (Vercel's, reads WEB_URL at its first pass), and the
// inline schemas of apps/worker/src/main.ts and apps/api/src/server.ts, which run the process when imported.

/** Each reader by name; a reader that builds something closable is closed. */
const readers: Record<string, (env: NodeJS.ProcessEnv) => unknown> = {
  apiConfigFromEnv,
  fileStoreSettingsFromEnv,
  fontsBucketFromEnv,
  adminConfigFromEnv,
  workerRunFromEnv,
  projectFilesFromEnv,
  recordSealingFromEnv,
  recordJobFromEnv: (env) => void recordJobFromEnv("http://127.0.0.1:3000", env).close(),
  veraPdfFromEnv,
  mailerFromEnv,
  "connectionFromEnv(app)": (env) => connectionFromEnv("app", env),
  "connectionFromEnv(admin)": (env) => connectionFromEnv("admin", env),
  databaseUrlsFromEnv,
  poolMaxFromEnv: (env) => poolMaxFromEnv(env, undefined),
};

/** A zod error as the variables it refused (`KEY: why`), any other as its message. */
function reason(error: unknown): string {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
  if (Array.isArray(issues)) return issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
  return error instanceof Error ? error.message : String(error);
}

/** The readers that throw on the env lane 21 would get from `example`, each with why. */
function failures(example: string): string[] {
  const env = parseEnv(laneEnv(example, 21));
  return Object.entries(readers).flatMap(([name, read]) => {
    try {
      read(env);
      return [];
    } catch (error) {
      return [`${name}: ${reason(error)}`];
    }
  });
}

const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
/** .env.example with `name`'s line, commented out or not, replaced by `name=value`. */
const withLine = (name: string, value: string) => {
  const line = new RegExp(`^(# )?${name}=.*$`, "m");
  return line.test(example) ? example.replace(line, `${name}=${value}`) : `${example}\n${name}=${value}\n`;
};

describe("the env schemas against a lane's .env from .env.example", () => {
  it("every one reads it without throwing", () => {
    expect(failures(example)).toEqual([]);
  });

  it.each(["UAT_SEALING_AUTHORITY_KEY", "UAT_SEALING_AUTHORITY_CERTIFICATE", "SENDGRID_API_KEY", "RECORD_FONTS_DIR", "CHROMIUM_PATH", "VERAPDF_PATH"])(
    "takes an empty %s= line as unset",
    (name) => {
      expect(failures(withLine(name, ""))).toEqual([]);
    },
  );

  it("names the reader that throws on an empty secret line the lane needs", () => {
    // The file store's endpoint is set, so its key must be too: empty, the api and worker cannot start.
    expect(failures(withLine("FILE_STORE_SECRET_ACCESS_KEY", ""))).toEqual([
      "fileStoreSettingsFromEnv: FILE_STORE_ENDPOINT needs FILE_STORE_ACCESS_KEY_ID and FILE_STORE_SECRET_ACCESS_KEY",
      "projectFilesFromEnv: FILE_STORE_ENDPOINT needs FILE_STORE_ACCESS_KEY_ID and FILE_STORE_SECRET_ACCESS_KEY",
      "recordJobFromEnv: FILE_STORE_ENDPOINT needs FILE_STORE_ACCESS_KEY_ID and FILE_STORE_SECRET_ACCESS_KEY",
    ]);
  });
});
