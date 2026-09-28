// One entry per environment. Everything that differs between environments
// (and later between Instances) is a parameter here, never a literal in a stack.
export interface EnvironmentConfig {
  /** Short name used in stack and resource names, e.g. `dev`. */
  readonly name: string;
  /** AWS region every regional resource is created in. */
  readonly region: string;
  /** GitHub `owner/repo` whose Actions may deploy this environment. */
  readonly githubRepository: string;
  /** Monthly cost budget; an alert is emailed at 80% of actual and 100% of forecast spend. */
  readonly monthlyBudgetUsd: number;
}

export const environments = {
  // Frankfurt for cost; dev holds seed/demo data only, never real customer data.
  dev: {
    name: "dev",
    region: "eu-central-1",
    githubRepository: "Rabaed/rabaedV2.0",
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
