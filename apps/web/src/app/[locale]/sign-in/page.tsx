import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("signIn");
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-h4 font-semibold">{t("title")}</h1>
      <SignInForm />
    </div>
  );
}
