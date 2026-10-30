# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This file is ours, not Next's: `agentRules: false` in `next.config.ts` stops `next dev` rewriting it (RP-1103: its rewrite dirtied the tree and voided verify lines). Keep this text outside Next's `nextjs-agent-rules` markers; `scripts/next-agent-files.test.ts` checks both.
