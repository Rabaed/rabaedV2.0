import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Compose = { services: Record<string, { restart?: string }> };
const composeFile = (name: string) => parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")) as Compose;

// RP-1099: a Docker Desktop update stopped every stack, and lane 7 (live UAT) stayed down for
// over 2 hours. Lane 7 alone restarts on its own: it copies docker-compose.uat.yml to the
// git-ignored docker-compose.override.yml, which compose reads beside docker-compose.yml. The
// other lanes keep no restart policy, so Docker's start never brings back every old lane at once.
describe("restart policy", () => {
  it("restarts every service in docker-compose.uat.yml, and only docker-compose.yml's services", () => {
    const services = Object.keys(composeFile("docker-compose.yml").services);
    const uat = composeFile("docker-compose.uat.yml").services;
    expect(Object.keys(uat).sort()).toEqual([...services].sort());
    for (const s of services) expect(uat[s], s).toEqual({ restart: "unless-stopped" });
  });

  it("leaves the lanes' shared docker-compose.yml without one", () => {
    for (const [name, s] of Object.entries(composeFile("docker-compose.yml").services)) expect(s.restart, name).toBeUndefined();
  });

  it("keeps docker-compose.override.yml out of git", () => {
    const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(ignore).toMatch(/^\/docker-compose\.override\.yml$/m);
  });
});

// The local db service must time plpgsql functions, so a seam-1 slowdown can be diagnosed
// from pg_stat_user_functions without a hand-run `alter system` (see README "Tests").
describe("docker-compose.yml db service", () => {
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const db = /^ {2}db:\n((?: {4}.*\n|\n)+)/m.exec(compose)?.[1] ?? "";

  it("starts postgres with track_functions=pl", () => {
    expect(db).toMatch(/^ {4}command:.*postgres\b.*-c track_functions=pl\b/m);
  });
});

// A service whose server is PID 1 never reaps exited children; rustfs turned zombie that way and
// Docker could then neither kill nor remove it, so `lanes:prune` failed on the lane (RP-983).
describe("docker-compose.yml init", () => {
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");

  it.each(["db", "mailpit", "files"])("runs an init process in the %s service", (service) => {
    const block = new RegExp(`^ {2}${service}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(compose)?.[1] ?? "";
    expect(block).toMatch(/^ {4}init: true$/m);
  });
});
