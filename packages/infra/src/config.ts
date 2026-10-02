import type { RetentionDays } from "aws-cdk-lib/aws-logs";

// One entry per environment. Everything that differs between environments
// (and later between Instances) is a parameter here, never a literal in a stack.
export interface EnvironmentConfig {
  /** Short name used in stack and resource names, e.g. `dev`. */
  readonly name: string;
  /** AWS region every regional resource is created in. */
  readonly region: string;
  /** The GitHub repository whose Actions may deploy this environment. */
  readonly github: GithubRepository;
  /**
   * Monthly cost budget; an alert is emailed at 80% of actual and 100% of
   * forecast spend. Left out where CloudFormation has no AWS::Budgets::Budget
   * (me-central-1, see `checkBudget`): set the budget in the Billing console
   * there instead.
   */
  readonly monthlyBudgetUsd?: number;
  /** NAT gateways for the private subnets' outbound traffic (image pulls, logs, secrets). One is enough for dev. */
  readonly natGateways: number;
  readonly database: DatabaseSize;
  readonly services: Record<ServiceName, ServiceSize>;
  /** The one-off migration task that runs before each deploy. */
  readonly migrationTask: Omit<ServiceSize, "desiredCount">;
  /** Days CloudWatch keeps every log group. */
  readonly logRetentionDays: RetentionDays;
  /**
   * A demo environment holds the demo seed and nothing else: the deploy seeds
   * it, the smoke test signs in as demo people, and a manual run resets it
   * (RP-213). Never on where real Companies work.
   */
  readonly demo: boolean;
  readonly alarms: AlarmThresholds;
  /**
   * The public host name, e.g. `dev.example.sa`: the deploy's smoke test and
   * summary use `https://` + it. Its ACM certificate is the
   * `AWS_CERTIFICATE_ARN` repository variable, not this file, since an ARN
   * names the account. Left out until Rabaed has a domain: the load balancer's
   * own address, with the wizard's interim certificate. See README "Dev
   * environment on AWS".
   */
  readonly domain?: string;
}

/**
 * When each alarm fires; emailed to the address the setup wizard sets. How
 * long a value must hold is set next to each alarm (monitoring stack).
 */
export interface AlarmThresholds {
  /** Share of api responses that are 5xx, in percent. */
  readonly api5xxPercent: number;
  /** 5xx answers from the load balancer itself (web down or not answering). */
  readonly loadBalancer5xxCount: number;
  /** Age of the oldest unprocessed outbox row. */
  readonly outboxOldestAgeSeconds: number;
  /** Unprocessed outbox rows. */
  readonly outboxBacklog: number;
  /** Average database CPU. */
  readonly databaseCpuPercent: number;
  readonly databaseFreeStorageGb: number;
  /** Open database connections. */
  readonly databaseConnections: number;
}

export interface DatabaseSize {
  /** RDS instance class without the `db.` prefix, e.g. `t4g.micro`. */
  readonly instanceType: string;
  readonly allocatedStorageGb: number;
  /** Storage autoscaling up to this size; none when left out. */
  readonly maxAllocatedStorageGb?: number;
  readonly multiAz: boolean;
  readonly backupRetentionDays: number;
}

/** The long-running services; admin is Rabaed Admin (apps/admin, ADR 0010). */
export const serviceNames = ["web", "api", "admin", "worker"] as const;
export type ServiceName = (typeof serviceNames)[number];

/** A Fargate service at a fixed size: no autoscaling in dev. */
export interface ServiceSize {
  /** CPU units (1024 = one vCPU). */
  readonly cpu: number;
  readonly memoryMiB: number;
  readonly desiredCount: number;
}

// Names and numeric IDs (public, not secret). Repositories created after
// 15 July 2026 get GitHub's immutable OIDC subject, which carries both, so a
// renamed or re-created repository can never match.
export interface GithubRepository {
  readonly owner: string;
  readonly ownerId: number;
  readonly repo: string;
  readonly repoId: number;
}

const rabaedRepository: GithubRepository = { owner: "Rabaed", ownerId: 328426410, repo: "rabaedV2.0", repoId: 1391344568 };

/** `owner/repo`, as GitHub shows it. */
export function repositoryName({ owner, repo }: GithubRepository): string {
  return `${owner}/${repo}`;
}

/**
 * The start of every OIDC `sub` claim GitHub Actions issues for the
 * repository. Check it with
 * `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.
 */
export function oidcSubjectPrefix({ owner, ownerId, repo, repoId }: GithubRepository): string {
  return `repo:${owner}@${ownerId}/${repo}@${repoId}`;
}

export const environments = {
  // Frankfurt for cost; dev holds seed/demo data only, never real customer data.
  dev: {
    name: "dev",
    region: "eu-central-1",
    github: rabaedRepository,
    monthlyBudgetUsd: 150,
    natGateways: 1,
    // The dev account is on AWS's Free plan (chosen 2026-09-28), which caps
    // backup retention at one day; storage autoscaling is left off to stay
    // inside its limits. Upgrading the plan allows 7 days again.
    database: { instanceType: "t4g.micro", allocatedStorageGb: 20, multiAz: false, backupRetentionDays: 1 },
    services: {
      web: { cpu: 256, memoryMiB: 1024, desiredCount: 1 },
      api: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
      admin: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
      worker: { cpu: 256, memoryMiB: 512, desiredCount: 1 },
    },
    migrationTask: { cpu: 256, memoryMiB: 512 },
    logRetentionDays: 30,
    // Dev holds only the demo, never real customer data.
    demo: true,
    // No `domain` until Rabaed has one; README "A real domain".
    alarms: {
      api5xxPercent: 5,
      loadBalancer5xxCount: 5,
      outboxOldestAgeSeconds: 300,
      outboxBacklog: 100,
      databaseCpuPercent: 80,
      // 10% of allocatedStorageGb.
      databaseFreeStorageGb: 2,
      // A t4g.micro allows about 85.
      databaseConnections: 60,
    },
  },
} as const satisfies Record<string, EnvironmentConfig>;

export type EnvironmentName = keyof typeof environments;

export function environmentConfig(name: string): EnvironmentConfig {
  if (!Object.hasOwn(environments, name)) {
    throw new Error(`Unknown environment "${name}". Known: ${Object.keys(environments).join(", ")}`);
  }
  return environments[name as EnvironmentName];
}

// Lower-case labels with at least one dot: no scheme, port or path. The last
// label may be punycode, such as Saudi Arabia's Arabic TLD (xn--mgberp4a5d4ar).
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Throws unless `domain` is left out or a bare host name. */
export function checkDomain({ domain }: EnvironmentConfig): void {
  if (domain !== undefined && !HOST_NAME.test(domain)) {
    throw new Error(`domain "${domain}" must be a bare lower-case host name, e.g. dev.example.sa`);
  }
}

// Regions where CloudFormation offers no AWS::Budgets::Budget, so the
// account stack cannot create the budget.
const REGIONS_WITHOUT_BUDGETS: readonly string[] = ["me-central-1"];

/** Throws if config asks for a budget the account stack cannot create in its region. */
export function checkBudget({ region, monthlyBudgetUsd }: EnvironmentConfig): void {
  if (monthlyBudgetUsd !== undefined && REGIONS_WITHOUT_BUDGETS.includes(region)) {
    throw new Error(
      `CloudFormation cannot create a budget in ${region}: leave monthlyBudgetUsd out and set the budget in the Billing console`,
    );
  }
}

/** Starts every stack's name, e.g. `Rabaed-dev`. */
function stackPrefix(config: EnvironmentConfig): string {
  return `Rabaed-${config.name}`;
}

/**
 * The CDK bootstrap only the account stack is deployed through, by a person
 * (setup wizard). Its CloudFormation role keeps AdministratorAccess: the
 * account stack holds the GitHub trust, the permissions boundary and the
 * deploys' execution policy. The deploy role cannot assume its roles; every
 * other stack goes through the default bootstrap, whose CloudFormation role
 * has only the execution policy (account stack).
 */
export const accountBootstrap = { qualifier: "rabaedacct", toolkitStackName: "CDKToolkit-Account" } as const;

/** Matches every stack of the environment, its nested stacks and the roles CloudFormation names after them. */
export function stackPattern(config: EnvironmentConfig): string {
  return `${stackPrefix(config)}-*`;
}

/**
 * Every stack's name, in deploy order. The deploy workflow deploys all but
 * the account stack, which only a person deploys, through the wizard.
 */
export function stackNames(config: EnvironmentConfig) {
  const name = (part: string) => `${stackPrefix(config)}-${part}`;
  return {
    account: name("Account"),
    network: name("Network"),
    data: name("Data"),
    registry: name("Registry"),
    storage: name("Storage"),
    migrations: name("Migrations"),
    app: name("App"),
    monitoring: name("Monitoring"),
  };
}

/**
 * Physical names the GitHub deploy role is scoped to. The account stack
 * grants on them before the resources exist, so both sides read them here.
 */
export function resourceNames(config: EnvironmentConfig) {
  const prefix = `rabaed-${config.name}`;
  const repositoryPrefix = `${prefix}/`;
  const taskFamily = (task: ServiceName | "migrate") => `${prefix}-${task}`;
  return {
    /** Starts most names, e.g. `rabaed-dev`; descriptions name the environment by it. */
    prefix,
    cluster: prefix,
    /** Every ECR repository's name starts with this. */
    repositoryPrefix,
    /** One ECR repository per service, e.g. `rabaed-dev/web`. */
    repository: (service: ServiceName) => `${repositoryPrefix}${service}`,
    /** Matches every repository of the environment. */
    repositoryPattern: `${repositoryPrefix}*`,
    /** A Fargate task definition's family, e.g. `rabaed-dev-web`. */
    taskFamily,
    /** The deploy role may run only this family (account stack). */
    migrationTaskFamily: taskFamily("migrate"),
    /** Both migration roles start with this, so the deploy role can pass only them. */
    migrationRolePrefix: `${prefix}-migrate-`,
    logGroup: (service: ServiceName | "migrate") => `/rabaed/${config.name}/${service}`,
    /** The Lambdas CDK adds for custom resources log here, one group per stack. */
    lambdaLogGroup: (stack: string) => `/rabaed/${config.name}/lambda/${stack}`,
    /** The rotation Lambda for one secret. Not `-rotate-`: hosted rotation's functions had those names. */
    rotationFunction: (secret: string) => `${prefix}-rotation-${secret}`,
    /** The rotation Lambdas' role (data stack). */
    rotationRole: `${prefix}-rotation`,
    /** Every role the deploys create or change must carry it (account stack). */
    permissionsBoundary: `${prefix}-boundary`,
    /** What CloudFormation may do in a deploy, in place of AdministratorAccess (account stack). */
    executionPolicy: `${prefix}-cfn-execution`,
    /** The GitHub environment the deploy job runs in; it admits only main. */
    githubEnvironment: config.name,
    /** Every alarm notifies this SNS topic (account stack), which emails the wizard's address. */
    alarmTopic: `${prefix}-alarms`,
    /** Custom metrics the monitoring stack extracts from the services' logs. */
    metricNamespace: `Rabaed/${config.name}`,
    /** e.g. `rabaed-dev-api-5xx-rate`; the wizard's test alarm uses one by name. */
    alarm: (name: string) => `${prefix}-${name}`,
    /** The saved Logs Insights query over web, api and worker. */
    allServicesQuery: `${prefix}/all-services`,
    trail: prefix,
    /** Every role in the environment's stacks: named ones and the ones CloudFormation names after the stack. */
    rolePatterns: [`${prefix}-*`, stackPattern(config)],
    /** GitHub Actions' roles (account stack); a deploy may only add and remove their inline grants. */
    githubRoles: `${prefix}-github-*`,
    /** GitHub Actions' deploy role, which also builds the images (account stack). */
    deployRole: `${prefix}-github-deploy`,
    /** GitHub Actions' read-only role for `cdk diff` on pull requests (account stack). */
    diffRole: `${prefix}-github-diff`,
    /** The monthly cost budget (account stack). */
    budget: `${prefix}-monthly`,
    /** A KMS key's alias, e.g. `alias/rabaed-dev-database`. */
    keyAlias: (key: "database" | "storage" | "pdf-sealing") => `alias/${prefix}-${key}`,
    /** The last version that passed the deploy's checks; the workflow rolls back to it. */
    lastGoodVersionParameter: `/rabaed/${config.name}/deploy/last-good-version`,
    /** The api's task role; the Project files bucket refuses everyone else. */
    apiTaskRole: `${prefix}-api-task`,
    /** Rabaed Admin's task role: the only one that may read the rabaed_admin secret. */
    adminTaskRole: `${prefix}-admin-task`,
    /** The demo people's sign-in password (demo environments only). */
    demoPasswordSecret: `rabaed/${config.name}/demo/password`,
    /** Every Secrets Manager secret of the environment starts with this. */
    secretPrefix: `rabaed/${config.name}/`,
    /** The SES configuration set every email is sent through (app stack). */
    mailConfigurationSet: prefix,
    /** Private DNS namespace; web reaches the api at `api.<namespace>`. */
    namespace: `${prefix}.internal`,
  };
}

/**
 * Every name the deploy workflow and the setup wizard use, as shell
 * variables. `node packages/infra/bin/names.ts <env>` prints them, so neither
 * spells an environment's names itself.
 */
export function shellVariables(config: EnvironmentConfig): Record<string, string> {
  const names = resourceNames(config);
  const stacks = Object.fromEntries(Object.entries(stackNames(config)).map(([part, stack]) => [`${part.toUpperCase()}_STACK`, stack]));
  return {
    REGION: config.region,
    ...stacks,
    SERVICES: serviceNames.join(" "),
    IMAGE_REPOSITORY_PREFIX: names.repositoryPrefix,
    LAST_GOOD_PARAMETER: names.lastGoodVersionParameter,
    RESOURCE_PREFIX: names.prefix,
    REPOSITORY: repositoryName(config.github),
    OIDC_SUBJECT: oidcSubjectPrefix(config.github),
    ACCOUNT_QUALIFIER: accountBootstrap.qualifier,
    ACCOUNT_TOOLKIT: accountBootstrap.toolkitStackName,
    EXECUTION_POLICY: names.executionPolicy,
    GITHUB_ENVIRONMENT: names.githubEnvironment,
    DEPLOY_ROLE: names.deployRole,
    DIFF_ROLE: names.diffRole,
    PERMISSIONS_BOUNDARY: names.permissionsBoundary,
    ALARM_TOPIC: names.alarmTopic,
    /** The alarm the wizard triggers to prove alarm emails arrive. */
    TEST_ALARM: names.alarm("load-balancer-5xx"),
    MAIL_CONFIGURATION_SET: names.mailConfigurationSet,
    /** Empty where config sets no budget. */
    MONTHLY_BUDGET_USD: config.monthlyBudgetUsd === undefined ? "" : String(config.monthlyBudgetUsd),
  };
}
