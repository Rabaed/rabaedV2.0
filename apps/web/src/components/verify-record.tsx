"use client";

import { VERIFICATION_ATTEMPTS, type Locale, type RecordVerification } from "@rabaed/domain";
import { RecordVerificationView, VerificationCodeForm, type RecordVerificationLabels, type VerificationCodeFormLabels } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { checkVerificationCode, type CodeCheck } from "@/app/[locale]/verify/actions";

// The public verification page's parts (RP-157), in the visitor's language: interim, from the kit's
// parts, no reference screen yet (RP-665; restyle RP-666).

function useLabels(): { record: RecordVerificationLabels; form: VerificationCodeFormLabels } {
  const t = useTranslations("verification");
  return {
    record: {
      genuine: t("genuine"),
      replaced: (date) => t("replaced", { date }),
      replacedHint: t("replacedHint"),
      testKey: t("testKey"),
      testKeyHint: t("testKeyHint"),
      documentNumber: t("documentNumber"),
      project: t("project"),
      outcome: t("outcome"),
      sealed: t("sealed"),
      signers: t("signers"),
      checkCopy: t("checkCopy"),
      checkCopyHint: t("checkCopyHint"),
      chooseFile: t("chooseFile"),
      checking: t("checking"),
      original: t("original"),
      copyReplaced: (date) => t("copyReplaced", { date }),
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
  const [state, dispatch] = useActionState<CodeCheck, FormData>(checkVerificationCode, { kind: "idle" });
  // What was typed last, shown again with the answer (a form action resets the form).
  const [typed, setTyped] = useState({ code: "", documentNumber: "", attempt: 0 });
  const action = (form: FormData) => {
    setTyped((last) => ({ code: String(form.get("code") ?? ""), documentNumber: String(form.get("documentNumber") ?? ""), attempt: last.attempt + 1 }));
    dispatch(form);
  };

  if (state.kind === "found") {
    return (
      <div className="flex flex-col gap-4">
        <RecordVerificationView verification={state.verification} locale={locale} labels={labels.record} />
        <VerificationCodeForm key={typed.attempt} action={action} labels={{ ...labels.form, title: t("checkAnother") }} />
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
      // A new key with each answer, so the form shows what was typed.
      key={`${state.kind}:${typed.attempt}`}
      action={action}
      labels={labels.form}
      defaultCode={typed.code}
      defaultDocumentNumber={typed.documentNumber}
      refusal={refusal}
    />
  );
}
