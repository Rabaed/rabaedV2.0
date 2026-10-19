import { formatDate, type Locale } from "@rabaed/domain";
import { buttonVariants, TitledCard } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NotificationSettings } from "@/components/notification-settings";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMySignature, getNotificationSettings } from "@/lib/session";

/**
 * The signed-in Member's profile: their Signature (RP-85), which every Transition they take
 * records, and their notification settings (RP-355). The Signature card follows the design
 * kit's Company Profile cards (`RP.profile`, `.pc`); there is no Member profile screen in it yet.
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const s = await getTranslations("signature");
  const [me, settings, mine] = await Promise.all([getMe(), getNotificationSettings(), getMySignature()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  const signature = mine?.signature ?? null;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{me.member.fullName[locale]}</p>
      </div>
      <TitledCard
        title={s("title")}
        actions={
          mine && (
            <Link href="/profile/signature" className={buttonVariants({ variant: signature ? "ghost" : "primary", size: "sm" })}>
              {signature ? s("replace") : s("add")}
            </Link>
          )
        }
      >
        {!mine ? (
          <p role="alert" className="text-danger-fg">
            {t("unavailable")}
          </p>
        ) : signature ? (
          <div className="flex flex-wrap items-center gap-5">
            {/* The image as saved; a short-lived link from the API (the Member's own file). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset */}
            <img
              src={signature.image.url}
              alt={s("imageAlt")}
              className="aspect-[3/1] w-full max-w-[300px] rounded-md border border-border-subtle bg-surface-subtle object-contain p-2"
            />
            <div className="space-y-1 text-sm">
              <p className="font-medium">{s(`madeBy.${signature.method}`)}</p>
              <p className="text-muted">{s("since", { date: formatDate(new Date(signature.activeFrom), locale) })}</p>
            </div>
            <p className="basis-full text-sm text-muted">{s("help")}</p>
          </div>
        ) : (
          <p className="text-muted">{s("none")}</p>
        )}
      </TitledCard>
      <section aria-labelledby="notification-settings" className="space-y-4">
        <h2 id="notification-settings" className="text-h5 font-semibold">
          {t("notificationSettings")}
        </h2>
        {settings ? (
          <NotificationSettings value={settings} locale={locale} />
        ) : (
          <p role="alert" className="text-danger-fg">
            {t("unavailable")}
          </p>
        )}
      </section>
    </div>
  );
}
