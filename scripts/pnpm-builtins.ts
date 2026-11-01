// pnpm's own commands, which `pnpm <name>` runs instead of a root script of that name
// (RP-1173: `pnpm doctor` never ran our doctor). Copied from the pnpm this repo pins
// (`packageManager`: pnpm@10.34.5), its dist/pnpm.cjs as corepack installs it:
// - every `commandNames` of the `commands` array in pnpm's cmd/index (the built-ins and
//   their aliases), plus "completion-server", which it adds by hand;
// - the `switch (argv[0])` in pnpm's entry point, "commands that are passed through to npm".
// `pnpm help --all` lists fewer (no setup, server, completion, help, ci, get, set).
// When the pinned pnpm changes, read both lists again from its dist/pnpm.cjs.
const PNPM_COMMANDS = [
  "add", "approve-builds", "audit", "bin", "cache", "ci", "clean-install", "ic", "install-clean",
  "config", "c", "dedupe", "get", "set", "create", "deploy", "dlx", "doctor", "env", "exec", "fetch",
  "completion", "ignored-builds", "import", "self-update", "init", "install", "i", "install-test", "it",
  "link", "ln", "list", "ls", "ll", "la", "licenses", "outdated", "pack", "patch", "patch-commit",
  "patch-remove", "prune", "publish", "rebuild", "rb", "recursive", "multi", "m",
  "remove", "uninstall", "rm", "un", "uni", "restart", "root", "run", "run-script", "server", "setup",
  "store", "cat-file", "cat-index", "find-hash", "unlink", "dislink", "update", "up", "upgrade", "why",
  "help", "completion-server",
];

const NPM_PASSTHROUGH_COMMANDS = [
  "access", "adduser", "bugs", "deprecate", "dist-tag", "docs", "edit", "find", "home", "info", "issues",
  "login", "logout", "owner", "ping", "prefix", "profile", "pkg", "repo", "s", "se", "search",
  "set-script", "show", "star", "stars", "team", "token", "unpublish", "unstar", "v", "version", "view",
  "whoami", "xmas",
];

// Allowed although some are built-ins: pnpm's own ALL_LIFECYCLE_SCRIPTS (same dist, the
// `pnpm run` listing). pnpm runs these scripts itself on purpose: `test`, `start` and `stop`
// are not built-ins in 10.34.5 (they fall back to `run`), `restart` runs the stop, restart
// and start scripts, and the rest are hooks `install`, `pack`, `publish`, `remove` and
// `version` run around their own work. Such a key is meant to be reached through pnpm's command.
const LIFECYCLE_SCRIPTS = new Set([
  "prepublish", "prepare", "prepublishOnly", "prepack", "postpack", "publish", "postpublish",
  "preinstall", "install", "postinstall", "preuninstall", "uninstall", "postuninstall",
  "preversion", "version", "postversion", "pretest", "test", "posttest", "prestop", "stop", "poststop",
  "prestart", "start", "poststart", "prerestart", "restart", "postrestart",
  "preshrinkwrap", "shrinkwrap", "postshrinkwrap",
]);

const BUILT_INS = new Set([...PNPM_COMMANDS, ...NPM_PASSTHROUGH_COMMANDS]);

/** The script keys `pnpm <key>` would not run, because a pnpm built-in of that name runs instead. */
export function shadowedScripts(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter((name) => BUILT_INS.has(name) && !LIFECYCLE_SCRIPTS.has(name));
}
