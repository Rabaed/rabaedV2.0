import { environmentConfig, shellVariables } from "../src/config.ts";

// Usage: node packages/infra/bin/names.ts <env>
// Prints every name the deploy workflow and the setup wizard use, one
// KEY=value per line (GITHUB_ENV's format). Plain Node runs it, no install needed.
const variables = shellVariables(environmentConfig(process.argv[2] ?? ""));
for (const [key, value] of Object.entries(variables)) console.log(`${key}=${value}`);
