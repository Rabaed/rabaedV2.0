import { describe, expect, it } from "vitest";
import { dockerRunArgs, playwrightImage, playwrightVersion, runnerCodename, volumeName } from "./test-stories-linux.ts";

// `pnpm test:stories:linux` runs the story suite in the Linux image CI uses (RP-388).
// The image is derived from the repository's own pins, so it cannot drift from CI.

const lockfile = `lockfileVersion: '9.0'

packages:

  playwright-core@1.63.0:
    resolution: {integrity: sha512-aaa}
    hasBin: true

  playwright@1.63.0:
    resolution: {integrity: sha512-bbb}
    hasBin: true

  playwright@1.20.0:
    resolution: {integrity: sha512-old}
`;

const ci = (runsOn: string) => `
jobs:
  lint:
    runs-on: ubuntu-latest
  stories:
    name: story tests
    runs-on: ${runsOn}
    steps: []
`;

describe("playwrightVersion", () => {
  it("reads the version of playwright @rabaed/ui resolves to from the lockfile", () => {
    expect(playwrightVersion(lockfile, "^1.63.0")).toBe("1.63.0");
  });

  it("fails naming the range when the lockfile has no matching playwright", () => {
    expect(() => playwrightVersion("packages:\n", "^1.63.0")).toThrow(/\^1\.63\.0/);
  });
});

describe("runnerCodename", () => {
  it("maps the story job's Ubuntu runner to the image's codename", () => {
    expect(runnerCodename(ci("ubuntu-24.04"))).toBe("noble");
    expect(runnerCodename(ci("ubuntu-22.04"))).toBe("jammy");
  });

  it("refuses a runner it cannot map, such as ubuntu-latest, which moves", () => {
    expect(() => runnerCodename(ci("ubuntu-latest"))).toThrow(/ubuntu-latest/);
  });
});

describe("playwrightImage", () => {
  it("is Microsoft's Playwright image for the locked version on the story job's Ubuntu", () => {
    expect(playwrightImage("1.63.0", "noble")).toBe("mcr.microsoft.com/playwright:v1.63.0-noble");
  });
});

describe("volumeName", () => {
  it("is stable per worktree and folder, and differs between worktrees", () => {
    const a = volumeName("G:\\repo-a", "packages/ui");
    expect(a).toBe(volumeName("G:\\repo-a", "packages/ui"));
    expect(a).not.toBe(volumeName("G:\\repo-b", "packages/ui"));
    expect(a).not.toBe(volumeName("G:\\repo-a", "apps/web"));
    expect(a).toMatch(/^rabaed-stories-[0-9a-f]{8}-packages-ui$/);
  });
});

describe("dockerRunArgs", () => {
  const args = dockerRunArgs({
    root: "G:\\repo-a",
    image: "mcr.microsoft.com/playwright:v1.63.0-noble",
    workspaces: ["apps/web", "packages/ui"],
    vitestArgs: ["--update=new"],
  });

  it("mounts the repository and keeps Linux node_modules in volumes, not the host's", () => {
    const mounts = args.filter((_, i) => args[i - 1] === "-v");
    expect(mounts).toContain("G:\\repo-a:/work");
    expect(mounts).toContain(`${volumeName("G:\\repo-a", ".")}:/work/node_modules`);
    expect(mounts).toContain(`${volumeName("G:\\repo-a", "packages/ui")}:/work/packages/ui/node_modules`);
    expect(mounts).toContain(`${volumeName("G:\\repo-a", "apps/web")}:/work/apps/web/node_modules`);
    expect(mounts.filter((m) => m.startsWith("G:\\repo-a:"))).toHaveLength(1);
  });

  it("runs the image with a throwaway container", () => {
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--init"]);
    expect(args).toContain("mcr.microsoft.com/playwright:v1.63.0-noble");
  });

  it("adds the runner's fallback font first: without it ✍ renders as a colour emoji, not the baselines' glyph", () => {
    expect(args.at(-1)).toMatch(/^apt-get update -qq && apt-get install -y -qq fonts-dejavu-core && /);
  });

  it("installs from the lockfile, then runs the suite with the caller's vitest arguments, quoted", () => {
    const script = args.at(-1) ?? "";
    expect(args.slice(-3, -1)).toEqual(["bash", "-c"]);
    expect(script).toContain("pnpm install --frozen-lockfile");
    expect(script).toMatch(/pnpm --filter @rabaed\/ui test:stories '--update=new'$/);
  });

  it("quotes an argument that has a quote or a space", () => {
    const quoted = dockerRunArgs({ root: "/r", image: "i", workspaces: [], vitestArgs: ["-t", "it's here"] });
    expect(quoted.at(-1)).toMatch(/test:stories '-t' 'it'\\''s here'$/);
  });

  it("tells vitest it is on Linux CI-like settings: no watch, and the host's CI untouched", () => {
    expect(args).toContain("CI=1");
  });
});
