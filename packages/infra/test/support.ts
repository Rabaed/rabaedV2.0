import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AccountStack } from "../src/account-stack.ts";
import { buildEnvironment } from "../src/environment.ts";
import { environments, type EnvironmentConfig } from "../src/config.ts";

// The feature flags `cdk` itself reads, so tests synthesise the same templates.
const cdkJson = JSON.parse(readFileSync(new URL("../cdk.json", import.meta.url), "utf8"));

// Synthesises every stack of one environment, as `cdk synth` would, and
// returns its templates. Tests assert on these only: what CloudFormation will
// be asked to create, never CDK construct internals.
export function synthesise(config: EnvironmentConfig = environments.dev) {
  const app = new App({ context: cdkJson.context });
  const stacks = buildEnvironment(app, config);
  return stacks.map((stack) => ({ stack, template: Template.fromStack(stack) }));
}

export function accountTemplate(config: EnvironmentConfig = environments.dev): Template {
  const found = synthesise(config).find(({ stack }) => stack instanceof AccountStack);
  if (!found) throw new Error("account stack not synthesised");
  return found.template;
}

// Renders a CloudFormation string expression (Ref, Fn::Join) as readable text,
// e.g. `arn:${AWS::Partition}:iam::${AWS::AccountId}:role/x`, so tests can
// assert on the value CloudFormation will produce, not on how CDK spelled it.
export function render(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(render);
  if (value && typeof value === "object") {
    const expr = value as Record<string, unknown>;
    if (typeof expr.Ref === "string") return `\${${expr.Ref}}`;
    const join = expr["Fn::Join"] as [string, unknown[]] | undefined;
    if (join) return join[1].map(render).join(join[0]);
    return Object.fromEntries(Object.entries(expr).map(([k, v]) => [k, render(v)]));
  }
  return value;
}
