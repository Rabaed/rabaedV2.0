import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_ENGINEER_EMAIL } from "../apps/api/src/demo/seed.ts";

// RP-1205: deploy-uat.yml publishes the Rabaed Defaults as the demo Rabaed Engineer, whose address
// the step carries as a fixed value (a variable's value would show in the public log header, and a
// real Engineer would need a secret). The workflow cannot import the constant, so this keeps the two
// from drifting: a different address, or one typed with a look-alike character (a full-width "＠"
// once slipped into a note), makes the Engineer lookup fail on the first deploy after it.
const STEP = "Publish the Rabaed Defaults";

type Step = { name?: string; run?: string; env?: Record<string, string> };
const stepsOf = (workflow: string): Step[] => (parse(workflow) as { jobs: { deploy: { steps: Step[] } } }).jobs.deploy.steps;

/** The Engineer email the workflow's publish step carries, or undefined when it has none. */
const engineerIn = (workflow: string) => stepsOf(workflow).find((step) => step.name === STEP)?.env?.DEFAULTS_ENGINEER_EMAIL;

const workflow = readFileSync(new URL("../.github/workflows/deploy-uat.yml", import.meta.url), "utf8");

describe("deploy-uat.yml's Rabaed Defaults step", () => {
  it("acts as the demo Rabaed Engineer, character for character", () => {
    expect(engineerIn(workflow)).toBe(DEMO_ENGINEER_EMAIL);
  });

  it("carries a plain ASCII address", () => {
    expect(engineerIn(workflow)).toMatch(/^[\x21-\x7e]+$/);
  });

  it("runs after the migrations and the demo, which creates the Engineer, and before anything goes live", () => {
    // A step that is not found is a failure of its own, not an index of -1 that sorts before everything.
    const indexOf = (needle: string) => {
      const index = stepsOf(workflow).findIndex((step) => step.run?.includes(needle));
      expect(index, `a step that runs "${needle}"`).toBeGreaterThan(-1);
      return index;
    };
    const at = stepsOf(workflow).findIndex((step) => step.name === STEP);
    expect(at, `the step "${STEP}"`).toBeGreaterThan(-1);
    expect(indexOf("uat-deploy.ts migrate")).toBeLessThan(at);
    expect(indexOf("uat-deploy.ts demo ensure")).toBeLessThan(at);
    expect(at).toBeLessThan(indexOf("vercel promote"));
    expect(at).toBeLessThan(indexOf("vercel deploy"));
  });

  it("calls the script that takes the Engineer from the environment", () => {
    expect(stepsOf(workflow).find((step) => step.name === STEP)?.run).toContain("node scripts/uat-deploy.ts defaults");
  });
});

describe("the drift check itself", () => {
  const swap = (from: string, to: string) => {
    const changed = workflow.replace(`DEFAULTS_ENGINEER_EMAIL: ${from}`, `DEFAULTS_ENGINEER_EMAIL: ${to}`);
    // Should the workflow and the constant drift, test 1 names it; this must not no-op beside it.
    expect(changed, "the workflow carries the line this check changes").not.toBe(workflow);
    return changed;
  };

  it("sees a different address", () => {
    expect(engineerIn(swap(DEMO_ENGINEER_EMAIL, "engineer@rabaed.example.test"))).not.toBe(DEMO_ENGINEER_EMAIL);
  });

  it("sees a look-alike character: a full-width ＠ instead of @", () => {
    const lookAlike = swap(DEMO_ENGINEER_EMAIL, DEMO_ENGINEER_EMAIL.replace("@", "＠"));
    expect(engineerIn(lookAlike)).not.toBe(DEMO_ENGINEER_EMAIL);
    expect(engineerIn(lookAlike)).not.toMatch(/^[\x21-\x7e]+$/);
  });

  it("sees the step without an address, or the step gone", () => {
    expect(engineerIn(workflow.replace(/\n\s+DEFAULTS_ENGINEER_EMAIL: .*/, ""))).toBeUndefined();
    expect(engineerIn(workflow.replace(`- name: ${STEP}`, "- name: Another step"))).toBeUndefined();
  });
});
