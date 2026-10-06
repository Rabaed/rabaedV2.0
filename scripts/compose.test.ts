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
