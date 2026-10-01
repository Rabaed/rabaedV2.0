import { describe, expect, it } from "vitest";
import { environments, stackNames } from "../src/config.ts";
import { accountTemplate, environmentTemplates, render, resourcesOfType, type Resource } from "./support.ts";

const env = environmentTemplates();
const monitoring = env.template("monitoring");
const account = accountTemplate();
const parts = Object.keys(stackNames(environments.dev)) as (keyof ReturnType<typeof stackNames>)[];

const alarmTopicArn = "arn:aws:sns:eu-central-1:${AWS::AccountId}:rabaed-dev-alarms";

type Alarm = {
  AlarmName: string;
  Namespace?: string;
  MetricName?: string;
  Dimensions?: { Name: string; Value: unknown }[];
  Statistic?: string;
  ComparisonOperator: string;
  Threshold: number;
  EvaluationPeriods: number;
  TreatMissingData?: string;
  AlarmActions?: unknown[];
  OKActions?: unknown[];
  Metrics?: { Id: string; Expression?: string; MetricStat?: { Metric: { Namespace: string; MetricName: string } } }[];
};
const alarms = new Map(
  (Object.values(monitoring.findResources("AWS::CloudWatch::Alarm")) as Resource[]).map((r) => {
    const alarm = r.Properties as Alarm;
    return [alarm.AlarmName, alarm];
  }),
);

type MetricFilter = {
  LogGroupName: string;
  FilterPattern: string;
  MetricTransformations: { MetricNamespace: string; MetricName: string; MetricValue: string; DefaultValue?: number }[];
};
const metricFilters = (Object.values(monitoring.findResources("AWS::Logs::MetricFilter")) as Resource[]).map((r) => r.Properties as MetricFilter);
/** The log group and pattern that produce a custom metric. */
function filterFor(metricName: string): MetricFilter {
  const found = metricFilters.filter((f) => f.MetricTransformations[0]?.MetricName === metricName);
  expect(found, metricName).toHaveLength(1);
  return found[0]!;
}

describe("alarm notifications", () => {
  const topics = Object.values(account.findResources("AWS::SNS::Topic")) as Resource[];

  it("go to one topic in the account stack, which the setup wizard deploys", () => {
    expect(topics.map((t) => t.Properties?.TopicName)).toEqual(["rabaed-dev-alarms"]);
  });

  it("are emailed to the address the wizard passes at deploy time, never in the repo or the template", () => {
    const subscriptions = Object.values(account.findResources("AWS::SNS::Subscription")) as Resource[];
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.Properties).toMatchObject({ Protocol: "email", Endpoint: { Ref: "AlarmEmail" } });
    const parameter = account.toJSON().Parameters.AlarmEmail;
    expect(parameter).toMatchObject({ Type: "String", NoEcho: true });
    expect(parameter).not.toHaveProperty("Default");
  });

  it("the topic accepts messages only over TLS, and only from this account's CloudWatch alarms", () => {
    const policies = Object.values(account.findResources("AWS::SNS::TopicPolicy")) as Resource[];
    expect(policies).toHaveLength(1);
    const statements = (policies[0]!.Properties?.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement.map(render);
    expect(statements).toContainEqual(
      expect.objectContaining({ Effect: "Deny", Action: "sns:Publish", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
    );
    const allows = statements.filter((s) => (s as { Effect: string }).Effect === "Allow");
    expect(allows).toEqual([
      expect.objectContaining({
        Principal: { Service: "cloudwatch.amazonaws.com" },
        Action: "sns:Publish",
        Condition: {
          ArnLike: { "aws:SourceArn": "arn:aws:cloudwatch:eu-central-1:${AWS::AccountId}:alarm:*" },
          StringEquals: { "aws:SourceAccount": "${AWS::AccountId}" },
        },
      }),
    ]);
  });

  it("every alarm notifies the topic when it fires and when it clears", () => {
    expect(alarms.size).toBeGreaterThan(0);
    for (const [name, alarm] of alarms) {
      expect(render(alarm.AlarmActions), name).toEqual([alarmTopicArn]);
      expect(render(alarm.OKActions), name).toEqual([alarmTopicArn]);
    }
  });
});

describe("alarms", () => {
  it("are exactly the listed ones", () => {
    expect([...alarms.keys()].sort()).toEqual(
      [
        "rabaed-dev-api-5xx-rate",
        "rabaed-dev-load-balancer-5xx",
        "rabaed-dev-unhealthy-targets",
        "rabaed-dev-outbox-age",
        "rabaed-dev-outbox-backlog",
        "rabaed-dev-database-cpu",
        "rabaed-dev-database-storage",
        "rabaed-dev-database-connections",
      ].sort(),
    );
  });

  it("api 5xx rate: the share of api responses that are 5xx, from the api's own request log", () => {
    const alarm = alarms.get("rabaed-dev-api-5xx-rate")!;
    expect(alarm).toMatchObject({ ComparisonOperator: "GreaterThanThreshold", Threshold: 5, TreatMissingData: "notBreaching" });
    const byId = Object.fromEntries(alarm.Metrics!.map((m) => [m.Id, m]));
    expect(byId.errors?.MetricStat?.Metric).toMatchObject({ Namespace: "Rabaed/dev", MetricName: "Api5xx" });
    expect(byId.requests?.MetricStat?.Metric).toMatchObject({ Namespace: "Rabaed/dev", MetricName: "ApiRequests" });
    // A few requests in a quiet period are not a rate.
    expect(alarm.Metrics!.find((m) => m.Expression)?.Expression).toBe("IF(requests >= 10, 100 * errors / requests, 0)");

    // Fastify's "request completed" line carries res.statusCode (apps/api/src/logging.ts).
    expect(filterFor("Api5xx")).toMatchObject({ LogGroupName: "/rabaed/dev/api", FilterPattern: "{ $.res.statusCode >= 500 }" });
    expect(filterFor("ApiRequests")).toMatchObject({ LogGroupName: "/rabaed/dev/api", FilterPattern: "{ $.res.statusCode > 0 }" });
  });

  it("load balancer 5xx and unhealthy targets watch the load balancer and web's target group", () => {
    const lb5xx = alarms.get("rabaed-dev-load-balancer-5xx")!;
    expect(lb5xx).toMatchObject({ Namespace: "AWS/ApplicationELB", MetricName: "HTTPCode_ELB_5XX_Count", Statistic: "Sum" });
    const lbDimension = lb5xx.Dimensions!.find((d) => d.Name === "LoadBalancer")!;
    expect(env.resolve(lbDimension.Value, "monitoring").resource.Type).toBe("AWS::ElasticLoadBalancingV2::LoadBalancer");

    const unhealthy = alarms.get("rabaed-dev-unhealthy-targets")!;
    expect(unhealthy).toMatchObject({ MetricName: "UnHealthyHostCount", Statistic: "Maximum", ComparisonOperator: "GreaterThanOrEqualToThreshold", Threshold: 1 });
    const tgDimension = unhealthy.Dimensions!.find((d) => d.Name === "TargetGroup")!;
    expect(env.resolve(tgDimension.Value, "monitoring").resource.Type).toBe("AWS::ElasticLoadBalancingV2::TargetGroup");
  });

  it("outbox age and backlog come from the worker's structured log", () => {
    expect(alarms.get("rabaed-dev-outbox-age")).toMatchObject({
      Namespace: "Rabaed/dev",
      MetricName: "OutboxOldestAgeSeconds",
      Statistic: "Maximum",
      ComparisonOperator: "GreaterThanThreshold",
      Threshold: 300,
    });
    expect(alarms.get("rabaed-dev-outbox-backlog")).toMatchObject({
      Namespace: "Rabaed/dev",
      MetricName: "OutboxBacklog",
      Statistic: "Maximum",
      ComparisonOperator: "GreaterThanThreshold",
      Threshold: 100,
    });
    // The worker logs { outbox: { backlog, oldestAgeSeconds } } (apps/worker/src/log.ts).
    expect(filterFor("OutboxOldestAgeSeconds")).toMatchObject({
      LogGroupName: "/rabaed/dev/worker",
      FilterPattern: "{ $.outbox.oldestAgeSeconds >= 0 }",
      MetricTransformations: [{ MetricValue: "$.outbox.oldestAgeSeconds" }],
    });
    expect(filterFor("OutboxBacklog")).toMatchObject({
      LogGroupName: "/rabaed/dev/worker",
      FilterPattern: "{ $.outbox.backlog >= 0 }",
      MetricTransformations: [{ MetricValue: "$.outbox.backlog" }],
    });
  });

  it("database CPU, free storage and connections watch the database instance", () => {
    const expected = {
      "rabaed-dev-database-cpu": { MetricName: "CPUUtilization", ComparisonOperator: "GreaterThanThreshold", Threshold: 80 },
      // 10% of the 20 GB allocated, in bytes.
      "rabaed-dev-database-storage": { MetricName: "FreeStorageSpace", ComparisonOperator: "LessThanThreshold", Threshold: 2 * 1024 ** 3 },
      "rabaed-dev-database-connections": { MetricName: "DatabaseConnections", ComparisonOperator: "GreaterThanThreshold", Threshold: 60 },
    };
    for (const [name, fields] of Object.entries(expected)) {
      const alarm = alarms.get(name)!;
      expect(alarm, name).toMatchObject({ Namespace: "AWS/RDS", ...fields });
      const instance = alarm.Dimensions!.find((d) => d.Name === "DBInstanceIdentifier")!;
      expect(env.resolve(instance.Value, "monitoring").resource.Type, name).toBe("AWS::RDS::DBInstance");
    }
  });
});

describe("logs", () => {
  const logGroups = resourcesOfType(env.synthesised, "AWS::Logs::LogGroup");

  it("every log group has a retention", () => {
    expect(logGroups.length).toBeGreaterThan(0);
    for (const group of logGroups) expect(group.Properties?.RetentionInDays, JSON.stringify(group.Properties?.LogGroupName)).toBe(30);
  });

  it("every Lambda function writes to a log group the templates create, so none is left without retention", () => {
    for (const part of parts) {
      const template = env.template(part);
      for (const [id, fn] of Object.entries(template.findResources("AWS::Lambda::Function")) as [string, Resource][]) {
        const group = (fn.Properties?.LoggingConfig as { LogGroup?: unknown } | undefined)?.LogGroup;
        expect(group, `${part}/${id}`).toBeDefined();
        expect(env.resolve(group, part).resource.Type).toBe("AWS::Logs::LogGroup");
      }
    }
  });

  it("each hosted password-rotation Lambda has a named function whose log group the data stack creates first", () => {
    const data = env.template("data");
    const groupNames = new Map(
      Object.entries(data.findResources("AWS::Logs::LogGroup")).map(([id, g]) => [(g as Resource).Properties?.LogGroupName, id]),
    );
    const schedules = Object.values(data.findResources("AWS::SecretsManager::RotationSchedule")) as (Resource & { DependsOn?: string[] })[];
    expect(schedules).toHaveLength(4);
    for (const schedule of schedules) {
      const name = (schedule.Properties?.HostedRotationLambda as { RotationLambdaName?: string }).RotationLambdaName;
      expect(name).toMatch(/^rabaed-dev-rotate-/);
      const groupId = groupNames.get(`/aws/lambda/${name}`);
      expect(groupId, name).toBeDefined();
      expect(schedule.DependsOn).toContain(groupId);
    }
  });

  it("web, api, Rabaed Admin and worker can be searched together in one saved Logs Insights query", () => {
    const queries = Object.values(monitoring.findResources("AWS::Logs::QueryDefinition")) as Resource[];
    expect(queries).toHaveLength(1);
    expect(queries[0]!.Properties).toMatchObject({
      Name: "rabaed-dev/all-services",
      LogGroupNames: ["/rabaed/dev/web", "/rabaed/dev/api", "/rabaed/dev/admin", "/rabaed/dev/worker"],
    });
  });
});

describe("audit trail", () => {
  const logsBucket = Object.entries(env.template("storage").findResources("AWS::S3::Bucket")).find(([id]) => id.startsWith("Logs"))![0];

  it("CloudTrail records management events in every region to the private logs bucket, with file validation", () => {
    const trails = resourcesOfType(env.synthesised, "AWS::CloudTrail::Trail");
    expect(trails).toHaveLength(1);
    const trail = trails[0]!.Properties!;
    expect(trail).toMatchObject({
      TrailName: "rabaed-dev",
      IsLogging: true,
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
      S3KeyPrefix: "cloudtrail",
    });
    expect(env.resolve(trail.S3BucketName, "monitoring").logicalId).toBe(logsBucket);
  });

  it("the load balancer writes its access logs to the logs bucket", () => {
    const [lb] = Object.values(env.template("app").findResources("AWS::ElasticLoadBalancingV2::LoadBalancer")) as Resource[];
    const attributes = Object.fromEntries(
      (lb!.Properties?.LoadBalancerAttributes as { Key: string; Value: unknown }[]).map(({ Key, Value }) => [Key, Value]),
    );
    expect(attributes["access_logs.s3.enabled"]).toBe("true");
    expect(attributes["access_logs.s3.prefix"]).toBe("load-balancer");
    expect(env.resolve(attributes["access_logs.s3.bucket"], "app").logicalId).toBe(logsBucket);
  });

  it("the logs bucket lets CloudTrail and load-balancer log delivery write only under their prefixes", () => {
    const policies = Object.values(env.template("storage").findResources("AWS::S3::BucketPolicy")) as Resource[];
    const policy = policies.find((p) => (p.Properties?.Bucket as { Ref?: string }).Ref === logsBucket)!;
    type Statement = { Effect: string; Principal: { Service?: string }; Action: unknown; Resource: unknown };
    // S3's own access logging (storage.test.ts) aside.
    const puts = (policy.Properties?.PolicyDocument as { Statement: Statement[] }).Statement.filter(
      (s) => s.Effect === "Allow" && [s.Action].flat().includes("s3:PutObject") && s.Principal.Service !== "logging.s3.amazonaws.com",
    );
    const resources = puts.flatMap((s) => [s.Resource].flat()).map((r) => String(render(r)));
    expect(resources.length).toBeGreaterThanOrEqual(2);
    for (const resource of resources) expect(resource).toMatch(/\/(cloudtrail|load-balancer)\/AWSLogs\/\$\{AWS::AccountId\}\/\*$/);
    expect(resources.some((r) => r.includes("/cloudtrail/"))).toBe(true);
    expect(resources.some((r) => r.includes("/load-balancer/"))).toBe(true);
  });
});
