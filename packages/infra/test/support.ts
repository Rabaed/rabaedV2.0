import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AccountStack } from "../src/account-stack.ts";
import { buildEnvironment } from "../src/environment.ts";
import { environments, stackNames, type EnvironmentConfig } from "../src/config.ts";

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

type StackPart = keyof ReturnType<typeof stackNames>;
export type Resource = { Type: string; Properties?: Record<string, unknown> };

/** Every template of one environment, looked up by stack (`network`, `data`, `app`, …). */
export function environmentTemplates(config: EnvironmentConfig = environments.dev) {
  const synthesised = synthesise(config);
  const names = stackNames(config);
  const byName = new Map(synthesised.map(({ stack, template }) => [stack.stackName, template]));
  const template = (part: StackPart): Template => {
    const found = byName.get(names[part]);
    if (!found) throw new Error(`stack ${names[part]} not synthesised`);
    return found;
  };

  // Export name → the stack and logical ID it exports, so a value one stack
  // imports from another can be traced to the resource that produces it.
  const exported = new Map<string, { stack: string; logicalId: string }>();
  for (const [stack, t] of byName) {
    const outputs = (t.toJSON().Outputs ?? {}) as Record<string, { Value: Expression; Export?: { Name: string } }>;
    for (const output of Object.values(outputs)) {
      const logicalId = output.Value.Ref ?? output.Value["Fn::GetAtt"]?.[0];
      if (output.Export && logicalId) exported.set(output.Export.Name, { stack, logicalId });
    }
  }

  /** The resource a `Ref`, `Fn::GetAtt` or cross-stack `Fn::ImportValue` in `inStack` points at. */
  const resolve = (value: unknown, inStack: StackPart) => {
    const expr = value as Expression;
    const local = expr.Ref ?? expr["Fn::GetAtt"]?.[0];
    const target = local ? { stack: names[inStack], logicalId: local } : exported.get(expr["Fn::ImportValue"] ?? "");
    if (!target) throw new Error(`cannot resolve ${JSON.stringify(value)}`);
    const resource = byName.get(target.stack)?.toJSON().Resources?.[target.logicalId] as Resource | undefined;
    if (!resource) throw new Error(`no resource ${target.logicalId} in ${target.stack}`);
    return { ...target, resource };
  };

  /** Public, Private or Isolated: the subnet type CDK tags every subnet with. */
  const subnetType = (value: unknown, inStack: StackPart): string => {
    const tags = (resolve(value, inStack).resource.Properties?.Tags ?? []) as { Key: string; Value: string }[];
    const type = tags.find((tag) => tag.Key === "aws-cdk:subnet-type")?.Value;
    if (!type) throw new Error(`${JSON.stringify(value)} is not a CDK subnet`);
    return type;
  };

  /** Like `resolve`, but undefined for parameters, pseudo parameters and values that are not a resource. */
  const tryResolve = (value: unknown, inStack: StackPart) => {
    try {
      return resolve(value, inStack);
    } catch {
      return undefined;
    }
  };

  return { synthesised, template, resolve, tryResolve, subnetType };
}

/** Every reference (Ref, Fn::GetAtt, Fn::ImportValue) anywhere inside a value. */
export function references(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => references(v, found));
  else if (value && typeof value === "object") {
    if ("Ref" in value || "Fn::GetAtt" in value || "Fn::ImportValue" in value) found.push(value);
    else Object.values(value).forEach((v) => references(v, found));
  }
  return found;
}

type Expression ={ Ref?: string; "Fn::GetAtt"?: [string, string]; "Fn::ImportValue"?: string };

/** Every resource of a type, across templates. */
export function resourcesOfType(templates: { template: Template }[], type: string): Resource[] {
  return templates.flatMap(({ template }) => Object.values(template.findResources(type)) as Resource[]);
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
