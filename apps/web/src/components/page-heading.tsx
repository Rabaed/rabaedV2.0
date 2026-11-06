import { TopBarTitle } from "@rabaed/ui";
import type { Locale } from "@rabaed/domain";
import { getLocale, getTranslations } from "next-intl/server";
import { getMe } from "@/lib/session";

/**
 * The top bar's title outside a Project (RP-406): the name of the place the
 * Member is in, from the first segment of the path (the sidebar item, or their
 * Profile or Notifications). Every page keeps its own heading. Notifications has its
 * Company's name under it (RP-1153, the owner's design).
 */
export async function PageHeading({ segment }: { segment: string }) {
  const t = await getTranslations();
  const titles: Record<string, string> = {
    "": t("shell.home"),
    projects: t("shell.projects"),
    "work-items": t("shell.projects"),
    packages: t("shell.projects"),
    members: t("shell.members"),
    participants: t("shell.participations"),
    library: t("shell.library"),
    profile: t("profile.title"),
    notifications: t("notifications.title"),
  };
  const title = titles[segment];
  if (title === undefined) return null;
  if (segment === "notifications") {
    const [me, locale] = await Promise.all([getMe(), getLocale()]);
    return <TopBarTitle title={title} subtitle={me?.company.legalName[locale as Locale]} />;
  }
  return <TopBarTitle title={title} />;
}
