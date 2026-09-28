import { App } from "aws-cdk-lib";
import { environmentConfig } from "../src/config.ts";
import { buildEnvironment } from "../src/environment.ts";

// `cdk <command> -c env=<name>` picks the environment; dev by default.
const app = new App();
buildEnvironment(app, environmentConfig(app.node.tryGetContext("env") ?? "dev"));
