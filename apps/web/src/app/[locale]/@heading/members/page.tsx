import { formatNumber, type Locale } from "@rabaed/domain";
import { TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { getMe, getMembers } from "@/lib/session";

/** The Members page's title in the top bar: "<own Company> · n Members" under it (kit "Users"). */
export default async function Heading({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const [t, me, list] = await Promise.all([getTranslations("members"), getMe(), getMembers()]);
  const shell = await getTranslations("shell");
  const subtitle =
    me && list
      ? t("headerSubtitle", {
          company: me.company.legalName[locale],
          count: list.members.length,
          n: formatNumber(list.members.length, locale),
        })
      : undefined;
  return <TopBarTitle title={shell("members")} subtitle={subtitle} />;
}
