// The app shell's plain rules, shared by the layout (server) and the frame (client).

/** The cookie that remembers a collapsed sidebar, read by the layout so the first paint matches. */
export const sidebarCookie = "rabaed-sidebar";

/** The sidebar items, by key. */
export type SidebarItemKey = "home" | "projects" | "members" | "company-projects";

/** Which sidebar item a path (without its locale) belongs to: a Work Item and every Project page are under Projects. */
export function sidebarItemOf(pathname: string): SidebarItemKey | undefined {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return "home";
  if (first === "projects" || first === "work-items") return "projects";
  if (first === "members") return "members";
  if (first === "participants") return "company-projects";
  return undefined;
}
