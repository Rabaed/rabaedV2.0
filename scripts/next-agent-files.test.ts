import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// RP-1103: `next dev` rewrote apps/web/AGENTS.md, which dirtied the tree and voided verify lines. Next 16.4 syncs a
// managed block in it (next/dist/server/lib/app-info-log.js `syncAgentRulesForDev`): with `agentRules` on it rewrites
// any block that differs from its own version's text (16.3's "# " heading became "## "), so every Next upgrade would
// dirty the file again; with `agentRules: false` it only removes that block. So the config turns it off and
// AGENTS.md holds our own text, outside Next's markers.

const web = join(dirname(import.meta.filename), "..", "apps", "web");
const agentFiles = createRequire(join(web, "package.json"))("next/dist/server/lib/generate-agent-files.js") as {
  AGENT_RULES_START_MARKER: string;
  removeAgentRulesFiles(dir: string): { agentsMd: string };
  removeAgentFeedbackFiles(dir: string): { agentsMd: string };
};

describe("apps/web/AGENTS.md and next dev", () => {
  it("turns off Next's agent rules in next.config.ts", () => {
    expect(readFileSync(join(web, "next.config.ts"), "utf8")).toMatch(/^\s*agentRules: false,/m);
  });

  it("is left unchanged by what next dev does with agent rules off", () => {
    const dir = mkdtempSync(join(tmpdir(), "next-agent-files-"));
    try {
      copyFileSync(join(web, "AGENTS.md"), join(dir, "AGENTS.md"));
      const before = readFileSync(join(dir, "AGENTS.md"), "utf8");
      expect(before).not.toContain(agentFiles.AGENT_RULES_START_MARKER);
      expect(agentFiles.removeAgentRulesFiles(dir).agentsMd).toBe("unchanged");
      expect(agentFiles.removeAgentFeedbackFiles(dir).agentsMd).toBe("unchanged");
      expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
