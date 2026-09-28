import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { AppStack } from "./app-stack.ts";
import { resourceNames, serviceNames, type EnvironmentConfig, type ServiceName } from "./config.ts";
import type { DataStack } from "./data-stack.ts";
import type { StorageStack } from "./storage-stack.ts";

export interface MonitoringStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly data: DataStack;
  readonly storage: StorageStack;
  readonly app: AppStack;
}

// Finding out when dev misbehaves, and the audit trail.
//
// Every alarm emails, through the account stack's topic, when it fires and
// when it clears. Thresholds are in config.ts. The api and worker metrics come
// from their structured logs (JSON lines, no customer content): the api's
// request log (apps/api/src/logging.ts) and the worker's outbox line
// (apps/worker/src/log.ts).
//
// CloudTrail records every management call in every region of the account to
// the private logs bucket, next to the load balancer's access logs.
export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config, data, storage, app } = props;
    const names = resourceNames(config);
    const thresholds = config.alarms;

    new cloudtrail.Trail(this, "Trail", {
      trailName: names.trail,
      bucket: storage.logs,
      s3KeyPrefix: "cloudtrail",
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    // By name: the topic is in the account stack, which only the wizard deploys.
    const topic = sns.Topic.fromTopicArn(this, "AlarmTopic", this.formatArn({ service: "sns", resource: names.alarmTopic }));
    const notify = new actions.SnsAction(topic);
    const alarm = (id: string, props: cloudwatch.AlarmProps) => {
      const created = new cloudwatch.Alarm(this, id, props);
      created.addAlarmAction(notify);
      created.addOkAction(notify);
      return created;
    };

    // The services' log groups are in the app stack; by name.
    const logGroups = Object.fromEntries(
      serviceNames.map((service) => [service, logs.LogGroup.fromLogGroupName(this, `${service}Logs`, names.logGroup(service))]),
    ) as Record<ServiceName, logs.ILogGroup>;
    const fromLog = (service: ServiceName, metricName: string, filterPattern: string, metricValue = "1", defaultValue?: number) =>
      new logs.MetricFilter(this, `${metricName}Filter`, {
        logGroup: logGroups[service],
        filterPattern: logs.FilterPattern.literal(filterPattern),
        metricNamespace: names.metricNamespace,
        metricName,
        metricValue,
        defaultValue,
      });
    const fiveMinutes = Duration.minutes(5);

    // api: Fastify logs one "request completed" line per response.
    const apiErrors = fromLog("api", "Api5xx", "{ $.res.statusCode >= 500 }", "1", 0).metric({ statistic: "Sum", period: fiveMinutes });
    const apiRequests = fromLog("api", "ApiRequests", "{ $.res.statusCode > 0 }").metric({ statistic: "Sum", period: fiveMinutes });
    alarm("Api5xxRate", {
      alarmName: `rabaed-${config.name}-api-5xx-rate`,
      alarmDescription: `More than ${thresholds.api5xxPercent}% of api responses were 5xx over 5 minutes (log group ${names.logGroup("api")}).`,
      // A few requests in a quiet period are not a rate.
      metric: new cloudwatch.MathExpression({
        expression: "IF(requests >= 10, 100 * errors / requests, 0)",
        usingMetrics: { errors: apiErrors, requests: apiRequests },
        period: fiveMinutes,
        label: "api 5xx %",
      }),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: thresholds.api5xxPercent,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // The load balancer answers 5xx itself when web is down or failing.
    alarm("LoadBalancer5xx", {
      alarmName: `rabaed-${config.name}-load-balancer-5xx`,
      alarmDescription: "The load balancer answered 5 or more requests with its own 5xx in 5 minutes: web is down or not answering.",
      metric: app.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { statistic: "Sum", period: fiveMinutes }),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm("UnhealthyTargets", {
      alarmName: `rabaed-${config.name}-unhealthy-targets`,
      alarmDescription: "A web task has failed the load balancer's health check for 5 minutes in a row.",
      metric: app.webTargets.metrics.unhealthyHostCount({ statistic: "Maximum", period: Duration.minutes(1) }),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 5,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // worker: one { outbox: { backlog, oldestAgeSeconds } } line per poll.
    // No data is not an alarm, because the worker reports these only once it
    // processes the outbox (RP-195).
    const outbox = (metricName: string, field: string) =>
      fromLog("worker", metricName, `{ $.outbox.${field} >= 0 }`, `$.outbox.${field}`).metric({ statistic: "Maximum", period: fiveMinutes });
    alarm("OutboxAge", {
      alarmName: `rabaed-${config.name}-outbox-age`,
      alarmDescription: `The oldest unprocessed outbox row is more than ${thresholds.outboxOldestAgeSeconds} seconds old: notifications are late.`,
      metric: outbox("OutboxOldestAgeSeconds", "oldestAgeSeconds"),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: thresholds.outboxOldestAgeSeconds,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm("OutboxBacklog", {
      alarmName: `rabaed-${config.name}-outbox-backlog`,
      alarmDescription: `More than ${thresholds.outboxBacklog} outbox rows have waited for 15 minutes.`,
      metric: outbox("OutboxBacklog", "backlog"),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: thresholds.outboxBacklog,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const database = data.database;
    alarm("DatabaseCpu", {
      alarmName: `rabaed-${config.name}-database-cpu`,
      alarmDescription: `Database CPU averaged over ${thresholds.databaseCpuPercent}% for 15 minutes.`,
      metric: database.metricCPUUtilization({ statistic: "Average", period: fiveMinutes }),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: thresholds.databaseCpuPercent,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    alarm("DatabaseStorage", {
      alarmName: `rabaed-${config.name}-database-storage`,
      alarmDescription: `The database has less than ${thresholds.databaseFreeStorageGb} GB of storage free.`,
      metric: database.metricFreeStorageSpace({ statistic: "Minimum", period: fiveMinutes }),
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: thresholds.databaseFreeStorageGb * 1024 ** 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    alarm("DatabaseConnections", {
      alarmName: `rabaed-${config.name}-database-connections`,
      alarmDescription: `More than ${thresholds.databaseConnections} database connections for 10 minutes.`,
      metric: database.metricDatabaseConnections({ statistic: "Maximum", period: fiveMinutes }),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: thresholds.databaseConnections,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    // Logs Insights → Queries → Saved: every service's log, newest first.
    new logs.CfnQueryDefinition(this, "AllServices", {
      name: `rabaed-${config.name}/all-services`,
      logGroupNames: serviceNames.map((service) => names.logGroup(service)),
      queryString: "fields @timestamp, @logStream, @message\n| sort @timestamp desc\n| limit 200",
    });
  }
}
