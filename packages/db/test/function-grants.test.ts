// Seam 2: every function's EXECUTE grants are explicit (RP-319), and no
// function has a stale second overload (RP-341). Reads the
// catalog, as the same style of check as the search_path scan (RP-287).
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { functionGrantProblems, overloadProblems, readFunctionGrants, type GrantAllowList } from "../test-support/function-grants.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(() => migrator.destroy());

// Functions that rabaed_app may NOT run alone: the ones rabaed_admin runs, and
// the plain helpers both roles use in policies, defaults and checks. Every
// other function is for rabaed_app only.
const both = ["rabaed_app", "rabaed_admin"];
const allow: GrantAllowList = {
  "app.convert_onboarding_leads": ["rabaed_admin"],
  "app.engineer_sign_in_candidate": ["rabaed_admin"],
  "app.lock_cr_number": ["rabaed_admin"],
  "app.work_item_chain_intact": ["rabaed_admin"],
  // Rabaed Admin writes Numbering Patterns, Participant Codes and counters (RP-313, RP-317).
  "app.is_numbering_pattern": ["rabaed_admin"],
  "app.counts_by_participant": ["rabaed_admin"],
  "app.apply_numbering_pattern": ["rabaed_admin"],
  "app.assign_participant_code": ["rabaed_admin"],
  "app.numbering_counter_for": ["rabaed_admin"],
  "app.start_numbering_counter": ["rabaed_admin"],
  "app.current_member_id": both,
  "app.is_bilingual": both,
};

// Function names with more than one overload on purpose. Empty: a second
// overload is almost always a stale copy left by `create or replace` with a
// changed signature (RP-341).
const overloadsAllowed: readonly string[] = [];

const grantOf = (fn: string, grantees: string[], owner = "rabaed_migrator") => ({
  fn: `${fn}()`,
  name: fn,
  owner,
  grantees,
});

describe("function grants in the database", () => {
  it("are explicit: no function is open to PUBLIC or to a role outside its allow-list", async () => {
    const grants = await readFunctionGrants(migrator);
    expect(grants.length).toBeGreaterThan(100); // the scan is not blind
    expect(functionGrantProblems(grants, allow)).toEqual([]);
  });

  it("has no allow-list entry for a function that does not exist", async () => {
    const names = new Set((await readFunctionGrants(migrator)).map((g) => g.name));
    expect(Object.keys(allow).filter((name) => !names.has(name))).toEqual([]);
  });

  it("have one overload per name: no stale copy left beside the current signature", async () => {
    expect(overloadProblems(await readFunctionGrants(migrator), overloadsAllowed)).toEqual([]);
  });
});

describe("the check", () => {
  it("names a function nobody revoked from PUBLIC (a null proacl is that default)", () => {
    const problems = functionGrantProblems([grantOf("app.forgot", ["PUBLIC", "rabaed_migrator"])], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^app\.forgot\(\): PUBLIC may execute it/);
  });

  it("names a grant to a role outside the allow-list", () => {
    const problems = functionGrantProblems([grantOf("app.stray", ["rabaed_app", "rabaed_admin", "rabaed_migrator"])], {});
    expect(problems).toEqual(["app.stray(): rabaed_admin may execute it, not in its allow-list"]);
  });

  it("passes a grant the allow-list names, and the owner's own", () => {
    const grants = [grantOf("app.shared", ["rabaed_app", "rabaed_admin", "rabaed_migrator"]), grantOf("app.mine", ["rabaed_app", "rabaed_migrator"])];
    expect(functionGrantProblems(grants, { "app.shared": ["rabaed_app", "rabaed_admin"] })).toEqual([]);
  });

  it("names a function with a second overload, with both signatures", () => {
    const overload = (args: string) => ({ fn: `app.take(${args})`, name: "app.take", owner: "rabaed_migrator", grantees: ["rabaed_app"] });
    expect(overloadProblems([overload("uuid, jsonb"), overload("uuid, text")], [])).toEqual([
      "app.take has 2 overloads: app.take(uuid, jsonb), app.take(uuid, text) (drop the stale one in a new migration)",
    ]);
  });

  it("passes an overload the allow-list names", () => {
    const grants = [grantOf("app.both", ["rabaed_app"]), grantOf("app.both", ["rabaed_app"])];
    expect(overloadProblems(grants, ["app.both"])).toEqual([]);
  });
});
