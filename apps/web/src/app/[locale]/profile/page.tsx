import { formatDate, type Locale } from "@rabaed/domain";
import { buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProfileSettings } from "@/components/profile-settings";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMySignature, getNotificationSettings } from "@/lib/session";

/**
 * The signed-in Member's profile and notification settings (RP-1154), built to the owner's
 * reference "Rabaed Profile & Notification Settings.html": the Profile card with their Signature
 * (RP-85), which every Transition they take records, beside their notification settings (RP-355).
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  const s = await getTranslations("signature");
  const [me, settings, mine] = await Promise.all([getMe(), getNotificationSettings(), getMySignature()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  const signature = mine?.signature ?? null;

  const signatureCard = !mine ? (
    <p role="alert" className="text-sm text-danger-fg">
      {t("unavailable")}
    </p>
  ) : (
    <div className="flex flex-col gap-3">
      {signature ? (
        <div className="flex flex-wrap items-center gap-4">
          {/* The image as saved; a short-lived link from the API (the Member's own file). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset */}
          <img
            src={signature.image.url}
            alt={s("imageAlt")}
            className="aspect-[3/1] w-full max-w-[220px] rounded-md border border-border-subtle bg-surface-subtle object-contain p-2"
          />
          <div className="space-y-0.5 text-[12.5px]">
            <p className="font-semibold">{s(`madeBy.${signature.method}`)}</p>
            <p className="text-muted">{s("since", { date: formatDate(new Date(signature.activeFrom), locale) })}</p>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">{s("none")}</p>
      )}
      {signature && <p className="text-[12px] leading-[1.4] text-muted">{s("help")}</p>}
      <Link href="/profile/signature" className={buttonVariants({ variant: signature ? "secondary" : "primary", size: "sm", className: "self-start" })}>
        {signature ? s("replace") : s("add")}
      </Link>
    </div>
  );

  return settings ? (
    <ProfileSettings me={me} value={settings} locale={locale} signature={signatureCard} />
  ) : (
    <div className="space-y-2">
      <h1 className="text-[24px] font-semibold">{t("title")}</h1>
      <p role="alert" className="text-danger-fg">
        {t("unavailable")}
      </p>
    </div>
  );
}
