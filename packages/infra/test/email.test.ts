import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { environmentTemplates, render, type Resource } from "./support.ts";

const env = environmentTemplates();
const app = env.template("app");
// The configuration set's logical ID; references to it render as `${id}`, which CloudFormation resolves to its name.
const [configurationSet] = Object.keys(app.findResources("AWS::SES::ConfigurationSet", { Properties: { Name: "rabaed-dev" } }));
const parts = Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[];

type Statement = { Effect: string; Action: string | string[]; Resource: unknown; Condition?: Record<string, Record<string, unknown>> };
const actions = (s: Statement) => [s.Action].flat();

// Every IAM statement in any stack that allows an SES action, with the roles it is attached to.
function sesGrants() {
  const grants: { roles: string[]; statement: Statement }[] = [];
  for (const part of parts) {
    for (const policy of Object.values(env.template(part).findResources("AWS::IAM::Policy")) as Resource[]) {
      for (const statement of (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement) {
        if (statement.Effect !== "Allow" || !actions(statement).some((a) => a.startsWith("ses:") || a === "*")) continue;
        const roles = (policy.Properties?.Roles as unknown[]).map((role) => String(env.resolve(role, part).resource.Properties?.RoleName));
        grants.push({ roles, statement });
      }
    }
    // Managed policies and inline role policies would grant just as well; there must be none for SES.
    for (const type of ["AWS::IAM::ManagedPolicy", "AWS::IAM::Role"]) {
      for (const resource of Object.values(env.template(part).findResources(type)) as Resource[]) {
        expect(JSON.stringify(resource.Properties?.PolicyDocument ?? resource.Properties?.Policies ?? {})).not.toMatch(/"ses:/);
      }
    }
  }
  return grants;
}

type Container = { Name: string; Environment?: { Name: string; Value: unknown }[] };
function environmentOf(family: string): Record<string, unknown> {
  const tasks = Object.values(app.findResources("AWS::ECS::TaskDefinition")) as Resource[];
  const task = tasks.find((t) => t.Properties?.Family === family);
  const [container] = task?.Properties?.ContainerDefinitions as Container[];
  return Object.fromEntries((container?.Environment ?? []).map(({ Name, Value }) => [Name, render(Value)]));
}

describe("email (Amazon SES)", () => {
  it("has one configuration set that publishes bounces and complaints to CloudWatch, split by template", () => {
    app.resourceCountIs("AWS::SES::ConfigurationSet", 1);
    app.hasResourceProperties("AWS::SES::ConfigurationSet", {
      Name: "rabaed-dev",
      SuppressionOptions: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] },
      DeliveryOptions: { TlsPolicy: "REQUIRE" },
      ReputationOptions: { ReputationMetricsEnabled: true },
    });
    app.hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      ConfigurationSetName: { Ref: configurationSet },
      EventDestination: {
        Enabled: true,
        MatchingEventTypes: ["bounce", "complaint"],
        CloudWatchDestination: { DimensionConfigurations: [{ DimensionName: "template", DimensionValueSource: "messageTag", DefaultDimensionValue: "none" }] },
      },
    });
  });

  it("takes the From address at deploy time, never from the repo", () => {
    const parameter = app.toJSON().Parameters.MailFromAddress;
    expect(parameter).toMatchObject({ Type: "String", Default: "" });
    const pattern = new RegExp(parameter.AllowedPattern);
    for (const ok of ["", "no-reply@rabaed.test"]) expect(ok).toMatch(pattern);
    for (const bad of ["no-reply", "a b@rabaed.test", "no-reply@rabaed", "Rabaed <no-reply@rabaed.test>"]) expect(bad).not.toMatch(pattern);
    expect(JSON.stringify(app.toJSON())).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("only the api task role may send email; the admin service joins it in RP-254", () => {
    expect(sesGrants().flatMap((g) => g.roles)).toEqual(["rabaed-dev-api-task"]);
  });

  it("may send only ses:SendEmail, only from the configured From address, only through the configuration set", () => {
    const [grant] = sesGrants();
    expect(render(grant!.statement)).toEqual({
      Effect: "Allow",
      Action: "ses:SendEmail",
      Resource: [
        `arn:aws:ses:eu-central-1:\${AWS::AccountId}:configuration-set/\${${configurationSet}}`,
        "arn:aws:ses:eu-central-1:${AWS::AccountId}:identity/*",
      ],
      Condition: { StringEquals: { "ses:FromAddress": "${MailFromAddress}" } },
    });
  });

  it("tells the api its From address and configuration set, and no task the local catcher", () => {
    expect(environmentOf("rabaed-dev-api")).toMatchObject({ MAIL_FROM: "${MailFromAddress}", MAIL_SES_CONFIGURATION_SET: "rabaed-dev" });
    for (const family of ["rabaed-dev-api", "rabaed-dev-web", "rabaed-dev-worker"]) {
      expect(environmentOf(family)).not.toHaveProperty("MAIL_CATCHER_URL");
    }
    expect(environmentOf("rabaed-dev-web")).not.toHaveProperty("MAIL_FROM");
    expect(environmentOf("rabaed-dev-worker")).not.toHaveProperty("MAIL_FROM");
  });
});
