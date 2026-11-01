import { createHash } from "node:crypto";

// What names a worktree's stories volumes, kept apart from test-stories-linux.ts so the
// clean-up tools that need it (lanes:prune, worktrees:prune, worktrees:clean) import only
// Node builtins: test-stories-linux.ts imports `yaml`, and those tools must run with plain
// `node` and no installed packages (RP-1198; scripts/plain-node.test.ts checks it).

/** What every stories volume's name starts with. */
export const STORIES_VOLUME_PREFIX = "rabaed-stories-";

/** The 8 hex digits naming one worktree's stories volumes: the sha1 of its root, spelled as Node resolved it. */
export const worktreeHash = (root: string): string => createHash("sha1").update(root).digest("hex").slice(0, 8);
