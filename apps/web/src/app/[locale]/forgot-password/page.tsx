import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BackToSignIn } from "@/components/back-to-sign-in";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { SignInFrame, SignInSubtitle, SignInTitle } from "@/components/sign-in-frame";
import { redirect } from "@/i18n/navigation";
import { getMe } from "@/lib/session";

/** Forgot password (RP-1058): the sign-in design's "forgot" view. A signed-in Member goes home, as from sign-in. */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getMe()) return redirect({ href: "/", locale });
  const t = await getTranslations("passwordReset");
  return (
    <SignInFrame>
      <BackToSignIn />
      <SignInTitle>{t("requestTitle")}</SignInTitle>
      <SignInSubtitle>{t("requestSubtitle")}</SignInSubtitle>
      <ForgotPasswordForm />
    </SignInFrame>
  );
}
