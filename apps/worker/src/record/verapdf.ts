import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

// PDF/A-3 validation with veraPDF (RP-155; ADR 0023), the industry's reference validator, run
// as its command line on a copy of the PDF in a folder of its own. Two ways to reach it, as
// VERAPDF names them (never inferred): `cli` runs the `verapdf` program at VERAPDF_PATH (the
// worker image carries it); `docker` runs the verapdf/cli image, for a machine or CI job with
// Docker and no program of its own.

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

/** A validator that writes the PDF into a folder of its own and runs `command` on it; `args(dir)` are the arguments before veraPDF's own. */
function throughFolder(command: string, args: (dir: string) => { before: string[]; file: string }): PdfAValidator {
  return {
    async validate(pdf) {
      const dir = await mkdtemp(join(tmpdir(), "rabaed-verapdf-"));
      try {
        await writeFile(join(dir, "record.pdf"), pdf);
        const { before, file } = args(dir);
        // veraPDF exits non-zero for a PDF that is not compliant: its report on stdout is the answer.
        const out = await run(command, [...before, "--flavour", "3b", "--format", "xml", file], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }).catch(
          (error: { stdout?: string }) => {
            if (typeof error.stdout === "string" && error.stdout.includes("<validationReport")) return { stdout: error.stdout };
            throw error;
          },
        );
        return parseVeraPdfReport(out.stdout);
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

/** veraPDF in its Docker image (the folder is mounted read-only). */
export function veraPdfDocker(image = "verapdf/cli:latest"): PdfAValidator {
  return throughFolder("docker", (dir) => ({ before: ["run", "--rm", "-v", `${dir}:/data:ro`, image], file: "/data/record.pdf" }));
}

export interface PdfAValidatorSession extends PdfAValidator {
  /** Stops the container; a session that never validated started none. */
  close(): Promise<void>;
}

/**
 * veraPDF in one Docker container kept for many PDFs (a test file's, started at its first PDF),
 * instead of a container for each: the PDFs go in through a folder mounted into it.
 */
export function veraPdfDockerSession(image = "verapdf/cli:latest"): PdfAValidatorSession {
  let started: Promise<{ id: string; dir: string }> | undefined;
  let count = 0;
  const start = async () => {
    const dir = await mkdtemp(join(tmpdir(), "rabaed-verapdf-"));
    const { stdout } = await run("docker", ["run", "-d", "--rm", "-v", `${dir}:/data:ro`, "--entrypoint", "sleep", image, "infinity"], { timeout: TIMEOUT_MS });
    return { id: stdout.trim(), dir };
  };
  return {
    async validate(pdf) {
      const { id, dir } = await (started ??= start().catch((error: unknown) => {
        started = undefined;
        throw error;
      }));
      const name = `record-${count++}.pdf`;
      await writeFile(join(dir, name), pdf);
      try {
        const out = await run("docker", ["exec", id, "/opt/verapdf/verapdf", "--flavour", "3b", "--format", "xml", `/data/${name}`], {
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
        }).catch((error: { stdout?: string }) => {
          if (typeof error.stdout === "string" && error.stdout.includes("<validationReport")) return { stdout: error.stdout };
          throw error;
        });
        return parseVeraPdfReport(out.stdout);
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
  VERAPDF_PATH: z.string().min(1).optional(),
  VERAPDF_IMAGE: z.string().min(1).optional(),
});

/** The validator VERAPDF names (see above); unset, the record's checks fail, saying so. */
export function veraPdfFromEnv(source: NodeJS.ProcessEnv = process.env): PdfAValidator {
  const settings = env.parse(source);
  if (settings.VERAPDF === "cli") {
    if (!settings.VERAPDF_PATH) throw new Error("VERAPDF=cli needs VERAPDF_PATH");
    return veraPdfCli(settings.VERAPDF_PATH);
  }
  if (settings.VERAPDF === "docker") return veraPdfDocker(settings.VERAPDF_IMAGE);
  throw new Error("VERAPDF is not set (cli or docker)");
}
