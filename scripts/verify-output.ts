import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Where `pnpm verify` prints (RP-1019). Without `--log`, to the terminal as before: progress on stdout,
// failures on stderr, a failing step's tail only. With `--log <file>`, everything goes to the file, each
// step's whole output too, and the terminal gets only the final line, so a background run's notification
// carries verify's own result beside its exit code.

export type Sinks = { stdout: (text: string) => void; stderr: (text: string) => void; log?: (text: string) => void };

export type VerifyOutput = {
  /** A progress line. */
  info: (text: string) => void;
  /** A problem or warning. */
  error: (text: string) => void;
  /** Everything a step's run printed: kept in the log only. */
  stepOutput: (step: string, output: string) => void;
  /** The end of the run, whose last line is the final line: `pnpm verify passed on …` or `pnpm verify stopped …`. */
  end: (lines: string[], failed: boolean) => void;
};

export function verifyOutput({ stdout, stderr, log }: Sinks): VerifyOutput {
  if (!log) {
    return {
      info: stdout,
      error: stderr,
      stepOutput: () => {},
      end: (lines, failed) => {
        for (const line of lines) (failed ? stderr : stdout)(`\n${line}`);
      },
    };
  }
  return {
    info: log,
    error: log,
    stepOutput: (step, output) => log(`--- what ${step} printed ---\n${output.trimEnd()}`),
    end: (lines) => {
      for (const line of lines) log(`\n${line}`);
      const last = lines.at(-1);
      if (last !== undefined) stdout(last);
    },
  };
}

/** Starts `file` afresh (and its folder) and returns a writer that appends each text as a line. Throws, naming the file, when it can't be written. */
export function openLog(file: string): (text: string) => void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  } catch (error) {
    throw new Error(`pnpm verify --log: cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return (text) => appendFileSync(file, `${text}\n`);
}
