import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/sign-in-form";
import { SignInFrame, SignInSubtitle, SignInTitle } from "@/components/sign-in-frame";
import { redirect } from "@/i18n/navigation";
import { getMe } from "@/lib/session";

/**
 * The owner's sign-in design (RP-1057), in its frame (`SignInFrame`). A signed-in Member goes home
 * instead, so the page never sits inside the app shell.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getMe()) return redirect({ href: "/", locale });
  const t = await getTranslations("signIn");
  return (
    <SignInFrame>
      <SignInTitle>{t("title")}</SignInTitle>
      <SignInSubtitle>{t("subtitle")}</SignInSubtitle>
      <SignInForm />
      <p className="text-center text-body text-balance text-muted">{t("invite")}</p>
    </SignInFrame>
  );
}
