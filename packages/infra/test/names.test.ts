import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { environmentConfig, environments, resourceNames, serviceNames, shellVariables, type EnvironmentConfig } from "../src/config.ts";
import { resourcesOfType, synthesise } from "./support.ts";

// ADR 0005: every Instance runs the same code. An environment's names come
// from config.ts alone, so adding one needs no edit anywhere else.
const staging: EnvironmentConfig = { ...environments.dev, name: "staging" };

describe("resource names", () => {
  it("a second environment's resources carry none of the first one's names", () => {
    const json = JSON.stringify(synthesise(staging).map(({ template }) => template.toJSON()));
    expect(json).not.toMatch(/[rR]abaed[-/]dev\b/);
  });

  // The deploy role may run only the migration task's family (account stack),
  // so the task definition must be named from the same place.
  it("names every task definition family from config, the migration task's as the deploy role expects", () => {
    const names = resourceNames(environments.dev);
    const families = resourcesOfType(synthesise(), "AWS::ECS::TaskDefinition").map((t) => t.Properties?.Family);
    expect(families.sort()).toEqual([...serviceNames, "migrate" as const].map((task) => names.taskFamily(task)).sort());
    expect(names.taskFamily("migrate")).toBe(names.migrationTaskFamily);
  });
});

describe("names for the workflows and the setup wizard", () => {
  const script = fileURLToPath(new URL("../bin/names.ts", import.meta.url));

  it("gives every name the deploy workflow and the wizard use", () => {
    expect(shellVariables(environments.dev)).toMatchObject({
      REGION: "eu-central-1",
      ACCOUNT_STACK: "Rabaed-dev-Account",
      NETWORK_STACK: "Rabaed-dev-Network",
      DATA_STACK: "Rabaed-dev-Data",
      REGISTRY_STACK: "Rabaed-dev-Registry",
      STORAGE_STACK: "Rabaed-dev-Storage",
      MIGRATIONS_STACK: "Rabaed-dev-Migrations",
      APP_STACK: "Rabaed-dev-App",
      MONITORING_STACK: "Rabaed-dev-Monitoring",
      SERVICES: "web api admin worker",
      IMAGE_REPOSITORY_PREFIX: "rabaed-dev/",
      LAST_GOOD_PARAMETER: "/rabaed/dev/deploy/last-good-version",
      DEPLOY_ROLE: "rabaed-dev-github-deploy",
      DIFF_ROLE: "rabaed-dev-github-diff",
      PERMISSIONS_BOUNDARY: "rabaed-dev-boundary",
      ALARM_TOPIC: "rabaed-dev-alarms",
      TEST_ALARM: "rabaed-dev-load-balancer-5xx",
      MAIL_CONFIGURATION_SET: "rabaed-dev",
      MONTHLY_BUDGET_USD: "150",
    });
  });

  // Plain Node, no install needed: the wizard runs it before `pnpm install`.
  it("prints them as KEY=value lines, as GITHUB_ENV and the wizard read them", () => {
    const output = execFileSync(process.execPath, [script, "dev"], { encoding: "utf8" });
    const printed = Object.fromEntries(output.trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    expect(printed).toEqual(shellVariables(environments.dev));
  });

  it("refuses an unknown environment", () => {
    expect(() => execFileSync(process.execPath, [script, "nowhere"], { stdio: "pipe" })).toThrow(/Unknown environment "nowhere"/);
  });

  // GitHub reads no `env` in a job's `environment`, so the deploy job names it
  // itself; the deploy role trusts only that environment.
  it("the deploy job runs in the GitHub environment of the environment it deploys", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/deploy-dev.yml", import.meta.url), "utf8");
    const deployed = workflow.match(/^ {2}RABAED_ENV: (\S+)\r?$/m)?.[1];
    expect(deployed).toBeDefined();
    expect(workflow.match(/^ {4}environment: (\S+)\r?$/m)?.[1]).toBe(resourceNames(environmentConfig(deployed!)).githubEnvironment);
  });

  // Only the one input that picks the environment (RABAED_ENV) may say which it is.
  it.each([
    ".github/workflows/deploy-dev.yml",
    ".github/workflows/infra-diff.yml",
    "packages/infra/scripts/setup-aws-account.sh",
    "packages/infra/scripts/run-task.sh",
  ])("%s spells no environment's names itself", (file) => {
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    expect(text.match(/.*(?:[rR]abaed[-/]dev\b|env=dev\b|[rR]abaed[-/]\$\{?RABAED_ENV|STACK_PREFIX).*/g) ?? []).toEqual([]);
  });
});
