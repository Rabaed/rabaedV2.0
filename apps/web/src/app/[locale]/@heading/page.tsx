import { formatDayMonthYear, type Locale } from "@rabaed/domain";
import { TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";

/** Home's title in the top bar, with today's date as the design kit writes it, "Saturday, 10 October 2026", in Saudi time (RP-407). */
export default async function Heading({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslations("shell");
  return <TopBarTitle title={t("home")} subtitle={formatDayMonthYear(new Date(), locale, { weekday: true })} />;
}
