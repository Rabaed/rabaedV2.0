import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";

export default async function AcceptInvitationPage({ params }: { params: Promise<{ locale: Locale }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("acceptInvitation");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <AcceptInvitationForm />
    </div>
  );
}
