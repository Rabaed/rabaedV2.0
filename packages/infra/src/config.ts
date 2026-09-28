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
