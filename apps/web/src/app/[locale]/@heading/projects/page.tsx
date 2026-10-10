import { formatNumber, type Locale } from "@rabaed/domain";
import { TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { getMe, getMyProjects } from "@/lib/session";

/**
 * The Projects page's title in the top bar, with how many Projects the Member is
 * on and their own Company, as the design kit writes it: "5 Projects · Company".
 * (This folder also holds the Project pages' own.)
 */
export default async function Heading({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const [me, list] = await Promise.all([getMe(), getMyProjects()]);
  const count = list?.projects.length;
  const subtitle =
    me && count !== undefined ? t("projects.countLine", { count, n: formatNumber(count, locale), company: me.company.legalName[locale] }) : undefined;
  return <TopBarTitle title={t("shell.projects")} subtitle={subtitle} />;
}
