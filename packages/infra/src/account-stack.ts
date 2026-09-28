import { CfnOutput, CfnParameter, DefaultStackSynthesizer, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.ts";

const GITHUB_OIDC_HOST = "token.actions.githubusercontent.com";

export interface AccountStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

// Account-level setup, deployed once by a human through the setup wizard
// (packages/infra/scripts/setup-aws-account.sh): the GitHub OIDC trust, the
// roles GitHub Actions assumes, and the cost budget.
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

    // The CDK bootstrap roles (created by `cdk bootstrap`) do the actual work;
    // the GitHub roles can only hand over to them.
    const bootstrapRoleArn = (kind: "deploy" | "file-publishing" | "image-publishing" | "lookup") =>
      this.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: `cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-${kind}-role-${this.account}-${this.region}`,
      });

    // Deploys on merge to main. It cannot be assumed from any other branch,
    // tag, pull request or fork.
    const deploy = new iam.Role(this, "GithubDeployRole", {
      roleName: `rabaed-${config.name}-github-deploy`,
      description: `GitHub Actions deploys ${config.name} from ${config.githubRepository} main only`,
      assumedBy: githubPrincipal(`repo:${config.githubRepository}:ref:refs/heads/main`),
    });
    deploy.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: (["deploy", "file-publishing", "image-publishing", "lookup"] as const).map(bootstrapRoleArn),
      }),
    );

    // Runs `cdk diff` on pull requests. The lookup role is read-only (AWS
    // ReadOnlyAccess, kms:Decrypt denied), so a pull request can read what is
    // deployed but change nothing.
    const diff = new iam.Role(this, "GithubDiffRole", {
      roleName: `rabaed-${config.name}-github-diff`,
      description: `GitHub Actions runs cdk diff for ${config.githubRepository} pull requests (read-only)`,
      assumedBy: githubPrincipal(`repo:${config.githubRepository}:pull_request`),
    });
    diff.addToPolicy(new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: [bootstrapRoleArn("lookup")] }));

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

    new CfnOutput(this, "DeployRoleArn", { value: deploy.roleArn });
    new CfnOutput(this, "DiffRoleArn", { value: diff.roleArn });
  }
}
