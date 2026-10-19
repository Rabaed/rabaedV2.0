import { signatureReturnPath, type Locale } from "@rabaed/domain";
import { TitledCard } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AddSignature } from "@/components/signature";
import { redirect } from "@/i18n/navigation";
import { getMe } from "@/lib/session";

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
  const me = await getMe();
  if (!me) return redirect({ href: "/sign-in", locale });
  const { returnTo } = await searchParams;
  // Only back to a page of Rabaed's own: never another site.
  const back = signatureReturnPath(typeof returnTo === "string" ? returnTo : null);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("addTitle")}</h1>
        <p className="text-muted">{t("addSubtitle")}</p>
      </div>
      <TitledCard title={t("title")}>
        <AddSignature defaultName={me.member.fullName[locale]} returnTo={back} />
      </TitledCard>
    </div>
  );
}
