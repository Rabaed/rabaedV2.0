import { Aspects, type App, type Stack } from "aws-cdk-lib";
import { AccountStack } from "./account-stack.ts";
import { AppStack } from "./app-stack.ts";
import { stackNames, type EnvironmentConfig } from "./config.ts";
import { DataStack } from "./data-stack.ts";
import { LambdaLogGroups } from "./lambda-logs.ts";
import { MigrationsStack } from "./migrations-stack.ts";
import { MonitoringStack } from "./monitoring-stack.ts";
import { NetworkStack } from "./network-stack.ts";
import { RegistryStack } from "./registry-stack.ts";
import { StorageStack } from "./storage-stack.ts";

// Every stack of one environment. `bin/app.ts` and the tests both build
// through here, so the tests assert on exactly what gets deployed.
export function buildEnvironment(app: App, config: EnvironmentConfig): Stack[] {
  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region };
  const names = stackNames(config);
  const account = new AccountStack(app, names.account, { env, config });
  const network = new NetworkStack(app, names.network, { env, config });
  const data = new DataStack(app, names.data, { env, config, network });
  const registry = new RegistryStack(app, names.registry, { env, config });
  const storage = new StorageStack(app, names.storage, { env, config });
  const migrations = new MigrationsStack(app, names.migrations, { env, config, network, data, registry });
  const application = new AppStack(app, names.app, { env, config, network, data, registry, storage });
  const monitoring = new MonitoringStack(app, names.monitoring, { env, config, data, storage, appStack: application });
  Aspects.of(app).add(new LambdaLogGroups(config));
  return [account, network, data, registry, storage, migrations, application, monitoring];
}
