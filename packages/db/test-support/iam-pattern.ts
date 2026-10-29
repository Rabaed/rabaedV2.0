// How IAM matches a key or action pattern in a policy (`projects/*/snag-reports/*`,
// `s3:PutObject*`): `*` is any run of characters, `/` included, and the rest is
// literal. One definition for the tests that read the infrastructure's grants
// (packages/infra test) and the key builders they cover (apps/worker,
// packages/db storage-keys, RP-1084). No imports: the infrastructure's tests
// load this file on its own, never the rest of test-support.

export function iamPatternMatches(pattern: string, value: string): boolean {
  const literal = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${literal.join(".*")}$`).test(value);
}
