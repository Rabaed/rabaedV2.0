import { homeGreeting, type Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DocNo, buttonVariants } from "@rabaed/ui";
import { HomeView } from "@/components/home-view";
import { Link } from "@/i18n/navigation";
import { getHome, getMe } from "@/lib/session";

/** The greeting's name: the first word of the Member's full name. */
const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

/** A signed-in Member's Home across their Projects (RP-407); everyone else sees the welcome. */
export default async function Home({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const me = await getMe();

  if (me) {
    const home = await getHome();
    if (!home) {
      return (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      );
    }
    const now = new Date();
    const greeting = t(`greeting.${homeGreeting(now)}`, { name: firstName(me.member.fullName[locale]) });
    return <HomeView home={home} locale={locale} greeting={greeting} canCreateProjects={me.member.canCreateProjects} now={now.toISOString()} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-h3 font-semibold">{t("title")}</h1>
      <p className="text-muted">{t("tagline")}</p>
      <Link href="/sign-in" className={buttonVariants()}>
        {t("signIn")}
      </Link>
      <p>
        {t("documentNumberLabel")} <DocNo value="TWR-MAR-0000001" />
      </p>
      <Link href="/health" className="text-primary underline underline-offset-4">
        {t("healthLink")}
      </Link>
    </div>
  );
}
