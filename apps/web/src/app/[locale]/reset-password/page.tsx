import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BackToSignIn } from "@/components/back-to-sign-in";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { SignInFrame, SignInSubtitle, SignInTitle } from "@/components/sign-in-frame";
import { redirect } from "@/i18n/navigation";
import { getMe } from "@/lib/session";

/**
 * Sets a new password from the emailed link (RP-1058), in the sign-in design's frame. A signed-in
 * Member goes home: the link is for whoever can't sign in (the fragment holding the token never
 * reaches the server, so it is simply dropped).
 */
export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (await getMe()) return redirect({ href: "/", locale });
  const t = await getTranslations("passwordReset");
  return (
    <SignInFrame>
      <BackToSignIn />
      <SignInTitle>{t("resetTitle")}</SignInTitle>
      <SignInSubtitle>{t("resetSubtitle")}</SignInSubtitle>
      <ResetPasswordForm />
    </SignInFrame>
  );
}
