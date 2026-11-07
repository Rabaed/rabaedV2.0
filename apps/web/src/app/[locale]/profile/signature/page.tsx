import { formatDate, signatureReturnPath, type Locale } from "@rabaed/domain";
import { TitledCard } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageBackLink } from "@/components/page-back-link";
import { AddSignature } from "@/components/signature";
import { redirect } from "@/i18n/navigation";
import { getMe, getNotificationSettings } from "@/lib/session";

/**
 * Profile → Add Signature (RP-85, ADR 0023): draw, type or upload the Member's Signature.
 * Saving it takes them back to `returnTo`, the item the pop-up sent them from, or to their
 * profile. In the design kit's card (`RP.profile`, `.pc`); there is no Signature screen in it yet.
 */
export default async function AddSignaturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("signature");
  const [me, settings] = await Promise.all([getMe(), getNotificationSettings()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // The preview card shows only the Member's own lines, as the record prints them: their name,
  // their Positions on their Projects (the profile reads the same), their Company, today's date.
  const positions = [...new Set((settings?.projects ?? []).flatMap((p) => p.positions.map((name) => name[locale])))];
  const card = { name: me.member.fullName[locale], positions, company: me.company.legalName[locale], date: formatDate(new Date(), locale) };
  const { returnTo } = await searchParams;
  // Only back to a page of Rabaed's own: never another site.
  const back = signatureReturnPath(typeof returnTo === "string" ? returnTo : null);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        {/* Back to the Profile (RP-1241). */}
        <PageBackLink parent="/profile" />
        <h1 className="text-h4 font-semibold">{t("addTitle")}</h1>
        <p className="text-muted">{t("addSubtitle")}</p>
      </div>
      <TitledCard title={t("title")}>
        <AddSignature defaultName={me.member.fullName[locale]} card={card} returnTo={back} />
      </TitledCard>
    </div>
  );
}
