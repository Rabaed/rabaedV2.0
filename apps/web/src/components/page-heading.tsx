import { TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";

/**
 * The top bar's title outside a Project (RP-406): the name of the place the
 * Member is in, from the first segment of the path (the sidebar item, or their
 * Profile or Notifications). Every page keeps its own heading.
 */
export async function PageHeading({ segment }: { segment: string }) {
  const t = await getTranslations();
  const titles: Record<string, string> = {
    "": t("shell.home"),
    projects: t("shell.projects"),
    "work-items": t("shell.projects"),
    members: t("shell.members"),
    participants: t("shell.participations"),
    profile: t("profile.title"),
    notifications: t("notifications.title"),
  };
  const title = titles[segment];
  return title === undefined ? null : <TopBarTitle title={title} />;
}
