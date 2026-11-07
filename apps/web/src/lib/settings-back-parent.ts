import { locales } from "@rabaed/domain";

// Where "Back" leads from a Project settings page when the page before wasn't inside Rabaed
// (RP-1241): a settings page to Project Settings, a page inside one (a Checklist Template, a
// Screen, a Workflow's Version) to that page. Built from the path alone, so it names nothing the
// current URL doesn't.

const settingsPath = new RegExp(String.raw`^(?:/(?:${locales.join("|")}))?(/projects/[^/?#]+/settings)((?:/[^/?#]+)*)/?$`);

/** The fixed parent of the Project settings page at `path` (its locale optional), or null where the page draws no Back. */
export function settingsBackParent(path: string): string | null {
  const match = settingsPath.exec(path);
  if (!match) return null;
  const settings = match[1]!;
  const parts = match[2]!.split("/").filter(Boolean);
  // Project Settings itself is a top-level page.
  if (parts.length === 0) return null;
  if (parts.length === 1) return settings;
  if (parts[0] === "workflows") {
    // The Workflow builder's own bar has its way back; a Workflow's Version leads to that Workflow.
    if (parts.length === 2) return null;
    if (parts[2] === "versions") return `${settings}/workflows/${parts[1]}`;
  }
  // Any other page inside a settings page leads to that page.
  return `${settings}/${parts[0]}`;
}
