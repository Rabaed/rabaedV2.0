import { CfnOutput, CfnParameter, DefaultStackSynthesizer, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { oidcSubjectPrefix, repositoryName, resourceNames, stackNames, type EnvironmentConfig } from "./config.ts";

const GITHUB_OIDC_HOST = "token.actions.githubusercontent.com";
const BOOTSTRAP_ROLES = ["deploy", "file-publishing", "image-publishing", "lookup"] as const;

export interface AccountStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

// Account-level setup, deployed once by a human through the setup wizard
// (packages/infra/scripts/setup-aws-account.sh): the GitHub OIDC trust, the
// roles GitHub Actions assumes, the cost budget and where alarms are emailed.
export class AccountStack extends Stack {
  constructor(scope: Construct, id: string, props: AccountStackProps) {
    super(scope, id, props);
    const { config } = props;

    const github = new iam.OidcProviderNative(this, "GithubOidc", {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIds: ["sts.amazonaws.com"],
    });

    const githubPrincipal = (subject: string) =>
      new iam.WebIdentityPrincipal(github.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_OIDC_HOST}:sub`]: subject,
        },
      });

    const subject = oidcSubjectPrefix(config.github);
    const repository = repositoryName(config.github);

    // The CDK bootstrap roles (created by `cdk bootstrap`) do the actual work;
    // the GitHub roles can only hand over to them.
    const bootstrapRoleArn = (kind: (typeof BOOTSTRAP_ROLES)[number]) =>
      this.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: `cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-${kind}-role-${this.account}-${this.region}`,
      });

    // An ARN in this account and region, for the GitHub roles' grants.
    const regional = (service: string, resource: string) => `arn:${this.partition}:${service}:${this.region}:${this.account}:${resource}`;

    // Deploys on merge to main. It cannot be assumed from any other branch,
    // tag, pull request or fork.
    const names = resourceNames(config);
    const deploy = new iam.Role(this, "GithubDeployRole", {
      roleName: names.deployRole,
      description: `GitHub Actions deploys ${config.name} from ${repository} main only`,
      assumedBy: githubPrincipal(`${subject}:ref:refs/heads/main`),
    });
    deploy.addToPolicy(new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: BOOTSTRAP_ROLES.map(bootstrapRoleArn) }));

    // Outside CloudFormation, the deploy workflow pushes the images and runs
    // the migration task before the app stack is updated. For that it may only
    // push to this environment's repositories, run the migration task
    // definition in this environment's cluster, pass that task its own two
    // roles, and read its log. The names come from config.ts, so these grants
    // exist before the resources do. Reading the private fonts is granted by
    // the storage stack, next to the bucket.
    deploy.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    deploy.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        resources: [regional("ecr", `repository/${names.repositoryPattern}`)],
      }),
    );
    deploy.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [regional("ecs", `task-definition/${names.migrationTaskFamily}:*`)],
        conditions: { ArnEquals: { "ecs:cluster": regional("ecs", `cluster/${names.cluster}`) } },
      }),
    );
    deploy.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:DescribeTasks"], resources: [regional("ecs", `task/${names.cluster}/*`)] }));
    deploy.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [`arn:${this.partition}:iam::${this.account}:role/${names.migrationRolePrefix}*`],
        conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      }),
    );
    deploy.addToPolicy(
      new iam.PolicyStatement({ actions: ["logs:GetLogEvents"], resources: [regional("logs", `log-group:${names.logGroup("migrate")}:*`)] }),
    );

    // Runs `cdk diff --method=template` on pull requests. Code in a pull
    // request runs with this role, so it reads this environment's deployed
    // templates and the bootstrap version, nothing else: not the CDK lookup
    // role (AWS ReadOnlyAccess would expose the logs bucket, CloudWatch logs
    // and image layers). The CLI warns that it cannot assume the lookup role
    // and carries on with these credentials, which are for the right account.
    const diff = new iam.Role(this, "GithubDiffRole", {
      roleName: `rabaed-${config.name}-github-diff`,
      description: `GitHub Actions runs cdk diff for ${repository} pull requests (read-only)`,
      assumedBy: githubPrincipal(`${subject}:pull_request`),
    });
    diff.addToPolicy(
      new iam.PolicyStatement({
        // ListStackResources finds nested stacks' templates.
        actions: ["cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources"],
        resources: Object.values(stackNames(config)).map((stack) => regional("cloudformation", `stack/${stack}/*`)),
      }),
    );
    diff.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [regional("ssm", `parameter/cdk-bootstrap/${DefaultStackSynthesizer.DEFAULT_QUALIFIER}/version`)],
      }),
    );

    // The alert email is a deploy-time parameter (the wizard passes it), so
    // it is never in the repo, the template or a pull request's diff. Later
    // deploys without it keep the previous value.
    const budgetAlertEmail = new CfnParameter(this, "BudgetAlertEmail", {
      type: "String",
      noEcho: true,
      description: "Email that receives the monthly budget alerts",
    });
    const alert = (notificationType: "ACTUAL" | "FORECASTED", threshold: number) => ({
      notification: { notificationType, threshold, comparisonOperator: "GREATER_THAN", thresholdType: "PERCENTAGE" },
      subscribers: [{ subscriptionType: "EMAIL", address: budgetAlertEmail.valueAsString }],
    });
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `rabaed-${config.name}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: "USD" },
      },
      notificationsWithSubscribers: [alert("ACTUAL", 80), alert("FORECASTED", 100)],
    });

    // Every alarm (monitoring stack) notifies this topic, by name. It lives
    // here because the email, like the budget's, is a parameter only the
    // wizard passes; AWS asks the address to confirm the subscription once.
    const alarmEmail = new CfnParameter(this, "AlarmEmail", {
      type: "String",
      noEcho: true,
      description: "Email that receives the CloudWatch alarms",
    });
    const alarmTopic = new sns.Topic(this, "AlarmTopic", { topicName: names.alarmTopic, enforceSSL: true });
    alarmTopic.addSubscription(new subscriptions.EmailSubscription(alarmEmail.valueAsString));
    alarmTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [alarmTopic.topicArn],
        conditions: {
          ArnLike: { "aws:SourceArn": regional("cloudwatch", "alarm:*") },
          StringEquals: { "aws:SourceAccount": this.account },
        },
      }),
    );

    new CfnOutput(this, "AlarmTopicArn", { value: alarmTopic.topicArn });
    new CfnOutput(this, "DeployRoleArn", { value: deploy.roleArn });
    new CfnOutput(this, "DiffRoleArn", { value: diff.roleArn });
  }
}
