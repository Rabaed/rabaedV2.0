import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

// Runs @rabaed/ui's story suite in a Linux container, with the screenshot
// comparison on, exactly as CI's `stories` job does (RP-388).
//
// Why: the harness compares screenshots only on Linux (packages/ui/vitest.config.ts),
// so on Windows or macOS a harness change, or a failure that depends on the
// screenshot step, cannot show before CI (RP-332: taking a screenshot reset the
// emulated touch screen and 10 touch-target checks failed only on CI).
//
// Nothing is pinned twice. The image is Microsoft's Playwright image for the
// playwright version pnpm-lock.yaml resolves for @rabaed/ui (it ships that
// version's Chromium and its system libraries), on the Ubuntu release of the
// `stories` job's runner in .github/workflows/ci.yml.
//
// The repository is mounted, so screenshots written by `--update` land in
// packages/ui/test/__screenshots__ on the host. Linux's node_modules live in
// Docker volumes laid over the host's node_modules folders (one per workspace
// package), so the Windows binaries are never touched. Volumes are per worktree
// and stay between runs, so only the first run installs from the network;
// `docker volume rm $(docker volume ls -q -f name=rabaed-stories-)` clears them.
//
// Usage: pnpm test:stories:linux [vitest arguments]
//   pnpm test:stories:linux                       compare, as CI does
//   pnpm test:stories:linux --update              re-render every baseline
//   pnpm test:stories:linux --update=new          write only the missing ones
//   pnpm test:stories:linux -t "Button"           any vitest argument

const rootFolder = ".";

/** The version of playwright the lockfile resolves for a dependency range such as ^1.63.0. */
export function playwrightVersion(lockfile: string, range: string): string {
  const base = range.replace(/^[\^~]/, "").split(".").map(Number);
  const versions = [...lockfile.matchAll(/^ {2}playwright@(\d+\.\d+\.\d+):/gm)]
    .map((match) => match[1]!)
    .filter((version) => {
      const parts = version.split(".").map(Number);
      return parts[0] === base[0] && (parts[1]! > base[1]! || (parts[1] === base[1] && parts[2]! >= base[2]!));
    })
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const found = versions.at(-1);
  if (!found) throw new Error(`pnpm-lock.yaml has no playwright version matching ${range}: run pnpm install.`);
  return found;
}

const codenames: Record<string, string> = { "ubuntu-24.04": "noble", "ubuntu-22.04": "jammy" };

/** The Playwright image's Ubuntu codename for the `stories` job's runner. */
export function runnerCodename(workflow: string): string {
  const jobs = parseDocument(workflow).toJS()?.jobs as Record<string, { "runs-on"?: unknown }> | undefined;
  const runsOn = jobs?.stories?.["runs-on"];
  const codename = typeof runsOn === "string" ? codenames[runsOn] : undefined;
  if (!codename) {
    throw new Error(`The stories job runs on ${JSON.stringify(runsOn)}; pin it to an Ubuntu release known here (${Object.keys(codenames).join(", ")}).`);
  }
  return codename;
}

export const playwrightImage = (version: string, codename: string) => `mcr.microsoft.com/playwright:v${version}-${codename}`;

/** The Docker volume holding one workspace folder's Linux node_modules, per worktree. */
export function volumeName(root: string, folder: string): string {
  const worktree = createHash("sha1").update(root).digest("hex").slice(0, 8);
  return `rabaed-stories-${worktree}-${folder === rootFolder ? "root" : folder.replaceAll("/", "-")}`;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export interface RunOptions {
  root: string;
  image: string;
  /** Workspace folders relative to the root, e.g. packages/ui. */
  workspaces: string[];
  vitestArgs: string[];
}

/** The arguments for `docker run`. */
export function dockerRunArgs({ root, image, workspaces, vitestArgs }: RunOptions): string[] {
  const mounts = [[root, "/work"], ...[rootFolder, ...workspaces].map((folder) => [volumeName(root, folder), `/work/${folder === rootFolder ? "" : `${folder}/`}node_modules`])];
  const script = ["apt-get update -qq && apt-get install -y -qq fonts-dejavu-core", "corepack enable","pnpm install --frozen-lockfile", ["pnpm --filter @rabaed/ui test:stories", ...vitestArgs.map(shellQuote)].join(" ")].join(" && ");
  return [
    "run",
    "--rm",
    "--init",
    "--ipc=host",
    ...mounts.flatMap(([from, to]) => ["-v", `${from}:${to}`]),
    "-w",
    "/work",
    "-e",
    "CI=1",
    image,
    "bash",
    "-c",
    script,
  ];
}

function workspaceFolders(root: string): string[] {
  return ["apps", "packages"].flatMap((parent) =>
    existsSync(join(root, parent))
      ? readdirSync(join(root, parent), { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json")))
          .map((entry) => `${parent}/${entry.name}`)
      : [],
  );
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const range = (JSON.parse(read("packages/ui/package.json")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> });
  const wanted = range.devDependencies?.playwright ?? range.dependencies?.playwright;
  if (!wanted) throw new Error("packages/ui/package.json does not list playwright.");
  const image = playwrightImage(playwrightVersion(read("pnpm-lock.yaml"), wanted), runnerCodename(read(".github/workflows/ci.yml")));
  const args = dockerRunArgs({ root, image, workspaces: workspaceFolders(root), vitestArgs: process.argv.slice(2) });
  console.log(`Story suite in ${image} (first run installs Linux node_modules into Docker volumes).`);
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Could not run docker: ${result.error.message}. Start Docker Desktop and try again.`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
