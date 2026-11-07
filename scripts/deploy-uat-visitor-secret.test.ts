import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// RP-1247: deploy-uat.yml hands VISITOR_FORWARD_SECRET (RP-1230, #681) to the two steps that apply
// web's and the api's Vercel variables, and to nothing else. scripts/uat-deploy.ts sends it to both
// projects, marked Sensitive; one project without it, or with another value, puts every visitor back
// under one shared limit. Admin, the migrations and the demo never need it, so no other step, job or
// workflow carries it. The two steps run the script alone, which prints no secret.
const SECRET = "VISITOR_FORWARD_SECRET";
const FROM_UAT = "${{ secrets.VISITOR_FORWARD_SECRET }}";
const JOB = "deploy";
const STEPS = { web: "web: settings and variables", api: "api: settings and variables" } as const;
const ALLOWED: readonly string[] = Object.values(STEPS);

type Step = { name?: string; run?: string; env?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, WORKFLOWS), "utf8");
const deployUat = read("deploy-uat.yml");

const stepIn = (workflow: string, name: string) => (parse(workflow) as Workflow).jobs?.[JOB]?.steps?.find((step) => step.name === name);

/**
 * Every place in a workflow that names the secret, as "<file> <path>", anywhere in it (env, run,
 * with, secrets, container, services, workflow_call), leaving out only the env key of the steps of
 * deploy-uat.yml's deploy job that `allowed` names.
 */
function placesNamingSecret(file: string, text: string, allowed: readonly string[] = []): string[] {
  const workflow = parse(text) as Workflow;
  for (const step of workflow.jobs?.[JOB]?.steps ?? []) {
    if (allowed.includes(step.name ?? "") && step.env) delete step.env[SECRET];
  }
  // A Set: a key and its value can both name the secret, one place.
  const found = new Set<string>();
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (value.includes(SECRET)) found.add(`${file} ${path}`);
    } else if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => walk(item, `${path}[${index}]`));
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        if (key.includes(SECRET)) found.add(`${file} ${path}.${key}`);
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(workflow, "");
  return [...found];
}

const inDeployUat = (text: string) => placesNamingSecret("deploy-uat.yml", text, ALLOWED);

/** deploy-uat.yml with `from` replaced by `to`; fails when `from` is not there, so a check never no-ops. */
const changed = (from: string | RegExp, to: string) => {
  const text = deployUat.replace(from, to);
  expect(text, `deploy-uat.yml has ${String(from)}`).not.toBe(deployUat);
  return text;
};

describe("deploy-uat.yml's VISITOR_FORWARD_SECRET", () => {
  it.each(Object.entries(STEPS))("passes the uat environment's secret to %s's variables step", (project, name) => {
    const step = stepIn(deployUat, name);
    expect(step, `the step "${name}"`).toBeDefined();
    expect(step?.env?.[SECRET]).toBe(FROM_UAT);
    // The script alone: nothing in the step can print the value.
    expect(step?.run).toBe(`node scripts/uat-deploy.ts project ${project}`);
  });

  it("goes to no other step, job or workflow", () => {
    const files = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
    expect(files).toContain("deploy-uat.yml");
    expect(files.flatMap((file) => placesNamingSecret(file, read(file), file === "deploy-uat.yml" ? ALLOWED : []))).toEqual([]);
  });
});

describe("the check itself", () => {
  const line = `          ${SECRET}: ${FROM_UAT}\n`;
  const adminStep = '      - name: "Admin: settings and variables"\n        env:\n';

  it("sees the secret on Admin's step, in the job's env, in a script, or passed on as a reusable workflow's secret", () => {
    const admin = inDeployUat(changed(adminStep, adminStep + line));
    expect(admin).toEqual([expect.stringMatching(/^deploy-uat\.yml \.jobs\.deploy\.steps\[\d+\]\.env\.VISITOR_FORWARD_SECRET$/)]);

    expect(inDeployUat(changed("    env:\n      VERSION:", `    env:\n      ${SECRET}: ${FROM_UAT}\n      VERSION:`))).toEqual(["deploy-uat.yml .jobs.deploy.env.VISITOR_FORWARD_SECRET"]);

    expect(inDeployUat(changed("run: node scripts/uat-deploy.ts project web", `run: echo "$${SECRET}"`))).toEqual([expect.stringMatching(/\.steps\[\d+\]\.run$/)]);

    const reusable = `on: push\njobs:\n  call:\n    uses: ./.github/workflows/other.yml\n    secrets:\n      ${SECRET}: ${FROM_UAT}\n`;
    expect(placesNamingSecret("other.yml", reusable)).toEqual(["other.yml .jobs.call.secrets.VISITOR_FORWARD_SECRET"]);
  });

  it("leaves out only the allowed steps' env key: the same line elsewhere in those steps is seen", () => {
    expect(inDeployUat(changed("run: node scripts/uat-deploy.ts project api", `run: node scripts/uat-deploy.ts project api "$${SECRET}"`))).toEqual([expect.stringMatching(/\.steps\[\d+\]\.run$/)]);
  });

  it.each(Object.entries(STEPS))("sees %s's step lose the secret, or get another value", (_project, name) => {
    const stepStart = `      - name: "${name}"\n        env:\n          VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}\n`;
    expect(stepIn(changed(stepStart + line, stepStart), name)?.env?.[SECRET]).toBeUndefined();
    const other = "${{ secrets.CRON_SECRET }}";
    expect(stepIn(changed(stepStart + line, `${stepStart}          ${SECRET}: ${other}\n`), name)?.env?.[SECRET]).toBe(other);
  });
});
