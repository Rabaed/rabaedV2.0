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
const STEPS = { web: "web: settings and variables", api: "api: settings and variables" } as const;

type Step = { name?: string; run?: string; env?: Record<string, unknown> };
type Workflow = { env?: Record<string, unknown>; jobs: Record<string, { env?: Record<string, unknown>; steps?: Step[] }> };

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, WORKFLOWS), "utf8");
const deployUat = read("deploy-uat.yml");

const stepIn = (workflow: string, name: string) => (parse(workflow) as Workflow).jobs.deploy?.steps?.find((step) => step.name === name);

/** Every place a workflow names the secret, as "<file> <where>", leaving out the env of the steps in `allowed`. */
function mentions(file: string, text: string, allowed: readonly string[] = []): string[] {
  const workflow = parse(text) as Workflow;
  const named = (value: unknown) => JSON.stringify(value ?? null).includes(SECRET);
  const found: string[] = [];
  if (named(workflow.env)) found.push(`${file} workflow env`);
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    if (named(job.env)) found.push(`${file} job ${id} env`);
    for (const step of job.steps ?? []) {
      const { env, ...rest } = step;
      if (named(rest)) found.push(`${file} step "${step.name ?? "(unnamed)"}"`);
      if (named(env) && !(id === "deploy" && allowed.includes(step.name ?? ""))) found.push(`${file} step "${step.name ?? "(unnamed)"}" env`);
    }
  }
  return found;
}

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
    expect(files.flatMap((file) => mentions(file, read(file), file === "deploy-uat.yml" ? Object.values(STEPS) : []))).toEqual([]);
  });
});

describe("the check itself", () => {
  const line = `          ${SECRET}: ${FROM_UAT}\n`;

  it("sees the secret on Admin's step, in a job's env, or read by a script", () => {
    const admin = deployUat.replace('      - name: "Admin: settings and variables"\n        env:\n', (match) => match + line);
    expect(admin, "the workflow has Admin's step as this check expects").not.toBe(deployUat);
    expect(mentions("deploy-uat.yml", admin, Object.values(STEPS))).toEqual(['deploy-uat.yml step "Admin: settings and variables" env']);

    const job = deployUat.replace("    env:\n      VERSION:", `    env:\n      ${SECRET}: ${FROM_UAT}\n      VERSION:`);
    expect(job).not.toBe(deployUat);
    expect(mentions("deploy-uat.yml", job, Object.values(STEPS))).toEqual(["deploy-uat.yml job deploy env"]);

    const echoed = deployUat.replace("run: node scripts/uat-deploy.ts project web", `run: echo "$${SECRET}"`);
    expect(echoed).not.toBe(deployUat);
    expect(mentions("deploy-uat.yml", echoed, Object.values(STEPS))).toEqual(['deploy-uat.yml step "web: settings and variables"']);
  });

  it("sees a step that lost the secret, or another value", () => {
    const lost = deployUat.replace(new RegExp(`\\n\\s+${SECRET}: .*`), "");
    expect(lost).not.toBe(deployUat);
    expect([stepIn(lost, STEPS.web)?.env?.[SECRET], stepIn(lost, STEPS.api)?.env?.[SECRET]]).toContain(undefined);
    expect(stepIn(deployUat.replaceAll(FROM_UAT, "${{ secrets.CRON_SECRET }}"), STEPS.web)?.env?.[SECRET]).not.toBe(FROM_UAT);
  });
});
