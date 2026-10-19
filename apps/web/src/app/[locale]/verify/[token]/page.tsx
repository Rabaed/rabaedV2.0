import type { Locale } from "@rabaed/domain";
import { ErrorState } from "@rabaed/ui";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifiedRecord, VerifyByCode } from "@/components/verify-record";
import { verifyByLink } from "@/lib/verification";

// The page a Documental Record's QR opens, `<web>/verify/<token>` (RP-157; visibility.md, the
// Verification page row): anyone, no sign-in, no cookie needed. It shows only what the record's first
// page prints; a link that opens nothing gets the form to type the code instead.
export const dynamic = "force-dynamic";

// The token is the record's key: never sent on as a Referer.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false } };

export default async function VerifyLinkPage({ params }: { params: Promise<{ locale: Locale; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verification");
  const answer = await verifyByLink(token);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h4 font-semibold">{t("title")}</h1>
      {answer.kind === "found" ? (
        <VerifiedRecord verification={answer.verification} />
      ) : answer.kind === "unavailable" ? (
        <ErrorState title={t("unavailable.title")}>{t("unavailable.body")}</ErrorState>
      ) : (
        <VerifyByCode linkNotFound />
      )}
    </div>
  );
}
