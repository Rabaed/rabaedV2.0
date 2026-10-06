import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DocNo, buttonVariants } from "@rabaed/ui";
import { Link, redirect } from "@/i18n/navigation";
import { getMe } from "@/lib/session";

/** A signed-in Member's home page is the Projects page (RP-346); everyone else sees the welcome. */
export default async function Home({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  if (await getMe()) return redirect({ href: "/projects", locale });

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
