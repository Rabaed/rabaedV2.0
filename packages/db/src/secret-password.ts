import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

let client: SecretsManagerClient | undefined;

/**
 * Reads the `password` field of a database secret (JSON, as RDS and its
 * rotation write it) with the task role's own credentials.
 */
export function secretPassword(secretId: string): () => Promise<string> {
  return async () => {
    client ??= new SecretsManagerClient({});
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const password = SecretString ? (JSON.parse(SecretString) as { password?: unknown }).password : undefined;
    // The secret's name, not its ARN, which carries the account ID into logs.
    if (typeof password !== "string" || !password) throw new Error(`Secret ${secretId.split(":").at(-1)} has no password`);
    return password;
  };
}
