import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
