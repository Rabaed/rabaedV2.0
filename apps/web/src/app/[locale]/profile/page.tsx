import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NotificationSettings } from "@/components/notification-settings";
import { redirect } from "@/i18n/navigation";
import { getMe, getNotificationSettings } from "@/lib/session";

/** The signed-in Member's profile: their notification settings (RP-355). */
export default async function ProfilePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const [me, settings] = await Promise.all([getMe(), getNotificationSettings()]);
  if (!me) return redirect({ href: "/sign-in", locale });

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{me.member.fullName[locale]}</p>
      </div>
      <section aria-labelledby="notification-settings" className="space-y-4">
        <h2 id="notification-settings" className="text-h5 font-semibold">
          {t("notificationSettings")}
        </h2>
        {settings ? (
          <NotificationSettings value={settings} locale={locale} />
        ) : (
          <p role="alert" className="text-danger">
            {t("unavailable")}
          </p>
        )}
      </section>
    </div>
  );
}
