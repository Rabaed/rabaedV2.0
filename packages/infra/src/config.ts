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
  /** Monthly cost budget; an alert is emailed at 80% of actual and 100% of forecast spend. */
  readonly monthlyBudgetUsd: number;
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
   * The public host name, e.g. `dev.<domain>`: the deploy's smoke test and
   * summary use `https://<domain>`. Its ACM certificate is the
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

export const serviceNames = ["web", "api", "worker"] as const;
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

/** The account stack's name; the setup wizard deploys it by this name. */
export function accountStackName(config: EnvironmentConfig): string {
  return `Rabaed-${config.name}-Account`;
}

/**
 * Every stack's name, in deploy order. The deploy workflow deploys all but
 * the account stack, which only a person deploys, through the wizard.
 */
export function stackNames(config: EnvironmentConfig) {
  const name = (part: string) => `Rabaed-${config.name}-${part}`;
  return {
    account: accountStackName(config),
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
  return {
    cluster: prefix,
    /** One ECR repository per service, e.g. `rabaed-dev/web`. */
    repository: (service: ServiceName) => `${prefix}/${service}`,
    /** Matches every repository of the environment. */
    repositoryPattern: `${prefix}/*`,
    migrationTaskFamily: `${prefix}-migrate`,
    /** Both migration roles start with this, so the deploy role can pass only them. */
    migrationRolePrefix: `${prefix}-migrate-`,
    logGroup: (service: ServiceName | "migrate") => `/rabaed/${config.name}/${service}`,
    /** The Lambdas CDK adds for custom resources log here, one group per stack. */
    lambdaLogGroup: (stack: string) => `/rabaed/${config.name}/lambda/${stack}`,
    /** Secrets Manager's hosted rotation Lambda for one secret. */
    rotationFunction: (secret: string) => `${prefix}-rotate-${secret}`,
    /** Every alarm notifies this SNS topic (account stack), which emails the wizard's address. */
    alarmTopic: `${prefix}-alarms`,
    /** Custom metrics the monitoring stack extracts from the services' logs. */
    metricNamespace: `Rabaed/${config.name}`,
    /** e.g. `rabaed-dev-api-5xx-rate`; the wizard's test alarm uses one by name. */
    alarm: (name: string) => `${prefix}-${name}`,
    /** The saved Logs Insights query over web, api and worker. */
    allServicesQuery: `${prefix}/all-services`,
    trail: prefix,
    /** GitHub Actions' deploy role, which also builds the images (account stack). */
    deployRole: `${prefix}-github-deploy`,
    /** The last version that passed the deploy's checks; the workflow rolls back to it. */
    lastGoodVersionParameter: `/rabaed/${config.name}/deploy/last-good-version`,
    /** The api's task role; the Project files bucket refuses everyone else. */
    apiTaskRole: `${prefix}-api-task`,
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
