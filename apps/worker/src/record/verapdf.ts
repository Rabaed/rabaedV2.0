import { execFile } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { optionalSecret } from "@rabaed/domain";
import { z } from "zod";

// PDF/A-3 validation with veraPDF (RP-155; ADR 0023), the industry's reference validator, run
// as its command line on a copy of the PDF in a folder of its own. Two ways to reach it, as
// VERAPDF names them (never inferred): `cli` runs the `verapdf` program at VERAPDF_PATH (the
// worker image carries it); `docker` runs the image VERAPDF_IMAGE names, for a machine or CI job
// with Docker and no program of its own. The image is always pinned (a version tag or a digest,
// never `latest`), so what validates a record does not change under us.

/** The veraPDF image the tests and `.env.example` use: the one the worker image copies (Dockerfile), by digest. */
export const PINNED_VERAPDF_IMAGE = "verapdf/cli@sha256:d565095c67a083e693aebf7d1a15784007370571053fc1aa5b502665b9a78f9c";

export interface PdfAValidation {
  readonly compliant: boolean;
  /** What breaks PDF/A-3b, one line for each rule, with its clause in ISO 19005-3. Empty when compliant. */
  readonly problems: readonly string[];
}

export interface PdfAValidator {
  validate(pdf: Uint8Array): Promise<PdfAValidation>;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** What veraPDF's XML report says of the one file it validated. */
export function parseVeraPdfReport(xml: string): PdfAValidation {
  const report = /<validationReport\b([^>]*)>/.exec(xml);
  if (!report) {
    const failure = /<taskResult[^>]*>[\s\S]*?<exceptionMessage>([\s\S]*?)<\/exceptionMessage>/.exec(xml)?.[1];
    return { compliant: false, problems: [`veraPDF could not validate it${failure ? `: ${decode(failure).trim()}` : ""}`] };
  }
  const attrs = report[1]!;
  if (!/jobEndStatus="normal"/.test(attrs)) return { compliant: false, problems: ["veraPDF could not finish validating it"] };
  if (/isCompliant="true"/.test(attrs)) return { compliant: true, problems: [] };
  const problems = [...xml.matchAll(/<rule\b[^>]*\bclause="([^"]+)"[^>]*\bstatus="failed"[^>]*>\s*<description>([\s\S]*?)<\/description>/g)].map(
    (m) => `PDF/A-3 ${m[1]!}: ${decode(m[2]!).trim().replace(/\s+/g, " ")}`,
  );
  return { compliant: false, problems: problems.length > 0 ? problems : ["it is not compliant with PDF/A-3b"] };
}

const run = promisify(execFile);
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs veraPDF through `command`; its report. veraPDF exits non-zero for a PDF that is not compliant, and its report on stdout is still the answer. */
async function reportOf(command: string, args: string[]): Promise<PdfAValidation> {
  const out = await run(command, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }).catch((error: { stdout?: string }) => {
    if (typeof error.stdout === "string" && error.stdout.includes("<validationReport")) return { stdout: error.stdout };
    throw error;
  });
  return parseVeraPdfReport(out.stdout);
}

/**
 * A folder for the PDFs a veraPDF container reads. The image runs as its own non-root user, which on
 * Linux is not the one that made the folder: mkdtemp's 0700 would leave it unable to read the PDF
 * (it reports a missing file, and no verdict). The folder and files are readable by all, and are
 * removed after each use; they hold only a record the Members of the item may download anyway.
 */
async function sharedFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rabaed-verapdf-"));
  await chmod(dir, 0o755);
  return dir;
}

/** Writes `pdf` as `name` in `dir`, readable by the container's user. */
async function putPdf(dir: string, name: string, pdf: Uint8Array): Promise<void> {
  await writeFile(join(dir, name), pdf, { mode: 0o644 });
  await chmod(join(dir, name), 0o644);
}

const veraArgs = (file: string) => ["--flavour", "3b", "--format", "xml", file];

/** A validator that writes the PDF into a folder of its own and runs `command` on it; `args(dir)` are the arguments before veraPDF's own. */
function throughFolder(command: string, args: (dir: string) => { before: string[]; file: string }): PdfAValidator {
  return {
    async validate(pdf) {
      const dir = await sharedFolder();
      try {
        await putPdf(dir, "record.pdf", pdf);
        const { before, file } = args(dir);
        return await reportOf(command, [...before, ...veraArgs(file)]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/** veraPDF's command line program at `path`. */
export function veraPdfCli(path: string): PdfAValidator {
  return throughFolder(path, (dir) => ({ before: [], file: join(dir, "record.pdf") }));
}

/** veraPDF in its Docker image `image` (the folder is mounted read-only). */
export function veraPdfDocker(image: string): PdfAValidator {
  return throughFolder("docker", (dir) => ({ before: ["run", "--rm", "-v", `${dir}:/data:ro`, image], file: "/data/record.pdf" }));
}

export interface PdfAValidatorSession extends PdfAValidator {
  /** Stops the container; a session that never validated started none. */
  close(): Promise<void>;
}

/**
 * How long a session's container lives (RP-1122): longer than the longest test file, so a test
 * that is killed or times out (its afterAll never calls close) still leaves no container behind:
 * the sleep ends and `--rm` removes it.
 */
export const VERAPDF_SESSION_SECONDS = 3600;

/**
 * The `docker run` arguments of a session's container (RP-1122). Its name and label let
 * `pnpm lanes:prune` (scripts/verapdf-containers.ts, which reads this name back) find it and
 * remove it once the process `pid` that started it is gone. `hash` names the worktree, as
 * scripts/test-stories-linux.ts's worktreeHash does; `n` is random, so two sessions never share a
 * name (worker threads share one pid, and a killed run's pid may be reused).
 */
export function veraPdfSessionArgs({ image, dir, hash, pid, n }: { image: string; dir: string; hash: string; pid: number; n: number }): string[] {
  return [
    "run",
    "-d",
    "--rm",
    "--name",
    `rabaed-verapdf-${hash}-${pid}-${n}`,
    "--label",
    `rabaed.verapdf=${hash}`,
    "-v",
    `${dir}:/data:ro`,
    "--entrypoint",
    "sleep",
    image,
    String(VERAPDF_SESSION_SECONDS),
  ];
}

/** This worktree's hash: the sha1 of its root, spelled as Node resolves it (worktreeHash in scripts/test-stories-linux.ts; scripts/verapdf-containers.test.ts checks they agree). */
export const veraPdfWorktreeHash = (): string => createHash("sha1").update(resolve(import.meta.dirname, "../../../..")).digest("hex").slice(0, 8);

/**
 * veraPDF in one Docker container kept for many PDFs (a test file's, started at its first PDF),
 * instead of a container for each: the PDFs go in through a folder mounted into it.
 */
export function veraPdfDockerSession(image: string): PdfAValidatorSession {
  let started: Promise<{ id: string; dir: string }> | undefined;
  let count = 0;
  const start = async () => {
    const dir = await sharedFolder();
    const args = veraPdfSessionArgs({ image, dir, hash: veraPdfWorktreeHash(), pid: process.pid, n: randomInt(1_000_000_000) });
    const { stdout } = await run("docker", args, { timeout: TIMEOUT_MS });
    return { id: stdout.trim(), dir };
  };
  return {
    async validate(pdf) {
      const { id, dir } = await (started ??= start().catch((error: unknown) => {
        started = undefined;
        throw error;
      }));
      const name = `record-${count++}.pdf`;
      await putPdf(dir, name, pdf);
      try {
        return await reportOf("docker", ["exec", id, "/opt/verapdf/verapdf", ...veraArgs(`/data/${name}`)]);
      } finally {
        await rm(join(dir, name), { force: true });
      }
    },
    async close() {
      const open = started;
      started = undefined;
      if (!open) return;
      const { id, dir } = await open;
      await run("docker", ["rm", "-f", id]).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const env = z.object({
  VERAPDF: z.enum(["cli", "docker"]).optional(),
  VERAPDF_PATH: optionalSecret,
  VERAPDF_IMAGE: optionalSecret,
});

/** Whether `image` names one exact image: a digest, or a version tag that is not `latest`. */
export const isPinnedImage = (image: string): boolean => /@sha256:[0-9a-f]{64}$/.test(image) || /^[^@]*:(?!latest$)[^:/@]+$/.test(image);

/**
 * The validator VERAPDF names (see above). Never inferred: unset, or a `docker` without a pinned
 * VERAPDF_IMAGE, it throws, so the record job is retried and no record is judged by a missing tool.
 */
export function veraPdfFromEnv(source: NodeJS.ProcessEnv = process.env): PdfAValidator {
  const settings = env.parse(source);
  if (settings.VERAPDF === "cli") {
    if (!settings.VERAPDF_PATH) throw new Error("VERAPDF=cli needs VERAPDF_PATH");
    return veraPdfCli(settings.VERAPDF_PATH);
  }
  if (settings.VERAPDF === "docker") {
    if (!settings.VERAPDF_IMAGE || !isPinnedImage(settings.VERAPDF_IMAGE)) throw new Error("VERAPDF=docker needs VERAPDF_IMAGE, pinned to a version tag or a digest (never latest)");
    return veraPdfDocker(settings.VERAPDF_IMAGE);
  }
  throw new Error("VERAPDF is not set (cli or docker)");
}
