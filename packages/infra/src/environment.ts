import type { App, Stack } from "aws-cdk-lib";
import { AccountStack } from "./account-stack.ts";
import type { EnvironmentConfig } from "./config.ts";

// Every stack of one environment. `bin/app.ts` and the tests both build
// through here, so the tests assert on exactly what gets deployed.
export function buildEnvironment(app: App, config: EnvironmentConfig): Stack[] {
  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region };
  return [new AccountStack(app, `Rabaed-${config.name}-Account`, { env, config })];
}
