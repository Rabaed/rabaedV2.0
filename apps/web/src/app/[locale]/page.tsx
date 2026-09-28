import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { DocumentNumber } from "@/components/document-number";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@rabaed/domain";

export default function Home({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations("home");

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="text-muted">{t("tagline")}</p>
      <p>
        {t("documentNumberLabel")} <DocumentNumber value="TWR-MAR-0000001" />
      </p>
      <Link href="/health" className="text-primary underline underline-offset-4">
        {t("healthLink")}
      </Link>
    </div>
  );
}
