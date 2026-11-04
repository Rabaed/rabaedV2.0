// Flags the infrastructure sets on the migration task
// (packages/infra/src/migrations-stack.ts), read here and by the api. Defined
// once, so both sides agree on the names and values. No imports: the
// infrastructure loads this file on its own.

/** How bootstrap treats the roles' passwords (`BootstrapOptions.passwords`). */
export const ROLE_PASSWORDS_FLAG = "DATABASE_ROLE_PASSWORDS";
export const rolePasswordModes = ["always", "on-create"] as const;
export type RolePasswordMode = (typeof rolePasswordModes)[number];
/** Where rotation owns the role passwords (AWS): set them only when creating a role. */
export const ROLE_PASSWORDS_ON_CREATE = "on-create" satisfies RolePasswordMode;

/** `on` only in a demo environment; the demo command refuses to run otherwise. */
export const DEMO_FLAG = "RABAED_DEMO";
export const DEMO_ON = "on";
