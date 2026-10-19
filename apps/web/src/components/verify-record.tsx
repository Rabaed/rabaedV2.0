"use client";

import { VERIFICATION_ATTEMPTS, type Locale, type RecordVerification } from "@rabaed/domain";
import { RecordVerificationView, VerificationCodeForm, type RecordVerificationLabels, type VerificationCodeFormLabels } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { checkVerificationCode, type CodeCheck } from "@/app/[locale]/verify/actions";

// The public verification page's parts (RP-157), in the visitor's language: interim, from the kit's
// parts, no reference screen yet (RP-665; restyle RP-666).

function useLabels(): { record: RecordVerificationLabels; form: VerificationCodeFormLabels } {
  const t = useTranslations("verification");
  // Raw: `{date}` is filled in by the component, in the page's language.
  const raw = (key: string) => t.raw(key) as string;
  return {
    record: {
      genuine: t("genuine"),
      replaced: raw("replaced"),
      replacedHint: t("replacedHint"),
      documentNumber: t("documentNumber"),
      subject: t("subject"),
      project: t("project"),
      outcome: t("outcome"),
      sealed: t("sealed"),
      signers: t("signers"),
      checkCopy: t("checkCopy"),
      checkCopyHint: t("checkCopyHint"),
      chooseFile: t("chooseFile"),
      checking: t("checking"),
      original: t("original"),
      copyReplaced: raw("copyReplaced"),
      different: t("different"),
      noFile: t("noFile"),
    },
    form: {
      title: t("form.title"),
      hint: t("form.hint"),
      code: t("form.code"),
      documentNumber: t("form.documentNumber"),
      submit: t("form.submit"),
    },
  };
}

/** A record found: its status, what its first page prints, its signers and the copy check. */
export function VerifiedRecord({ verification }: { verification: RecordVerification }) {
  const locale = useLocale() as Locale;
  return <RecordVerificationView verification={verification} locale={locale} labels={useLabels().record} />;
}

/** The Verification Code and Document Number form, and the record it finds. */
export function VerifyByCode({ linkNotFound = false }: { linkNotFound?: boolean }) {
  const t = useTranslations("verification");
  const labels = useLabels();
  const locale = useLocale() as Locale;
  const [state, action] = useActionState<CodeCheck, FormData>(checkVerificationCode, { kind: "idle", code: "", documentNumber: "" });

  if (state.kind === "found") {
    return (
      <div className="flex flex-col gap-4">
        <RecordVerificationView verification={state.verification} locale={locale} labels={labels.record} />
        <VerificationCodeForm action={action} labels={{ ...labels.form, title: t("checkAnother") }} />
      </div>
    );
  }
  const refusal =
    state.kind === "not_found"
      ? { title: t("notFound.title"), body: t("notFound.body") }
      : state.kind === "too_many_attempts"
        ? { title: t("tooMany.title"), body: t("tooMany.body", { minutes: VERIFICATION_ATTEMPTS.windowMinutes }) }
        : state.kind === "unavailable"
          ? { title: t("unavailable.title"), body: t("unavailable.body") }
          : linkNotFound
            ? { title: t("linkNotFound.title"), body: t("linkNotFound.body") }
            : undefined;
  return (
    <VerificationCodeForm
      // A new key after each answer, so the form shows what was typed.
      key={`${state.kind}:${state.code}:${state.documentNumber}`}
      action={action}
      labels={labels.form}
      defaultCode={state.code}
      defaultDocumentNumber={state.documentNumber}
      refusal={refusal}
    />
  );
}
