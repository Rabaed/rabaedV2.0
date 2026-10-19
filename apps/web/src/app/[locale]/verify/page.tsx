import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyByCode } from "@/components/verify-record";

// The public verification page, without a link (RP-157): anyone types a record's Verification Code
// with its Document Number. No sign-in, no cookie needed.
export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("verification");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-body text-muted">{t("intro")}</p>
      </div>
      <VerifyByCode />
    </div>
  );
}
