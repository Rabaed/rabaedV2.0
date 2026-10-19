"use client";

import type { RecordLanguage } from "@rabaed/domain";
import { Field, RadioGroup, SettingsSection, Switch } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { refusalMessage, setupCall } from "@/lib/setup-call";

/**
 * Project → Settings → Documental Record (RP-151): the language the Project's records are printed in
 * (both languages, Arabic or English) and whether they show the Hijri date beside the Gregorian one.
 * Each change applies at once (PUT …/settings/record) and holds for records made afterwards; records
 * already made keep what they were made with. Only a Project Admin can change them; everyone else reads them.
 */
export function ProjectRecordSettings({
  projectId,
  recordLanguage,
  recordHijriDates,
  canEdit,
}: {
  projectId: string;
  recordLanguage: RecordLanguage;
  recordHijriDates: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("projectSettings.record");
  const [language, setLanguage] = useState(recordLanguage);
  const [hijri, setHijri] = useState(recordHijriDates);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function save(next: { language: RecordLanguage; hijriDates: boolean }) {
    setPending(true);
    setError(undefined);
    const result = await setupCall("PUT", `/projects/${encodeURIComponent(projectId)}/settings/record`, next);
    setPending(false);
    if (!result.ok) {
      setError(refusalMessage(t, {}, result.error));
      return;
    }
    setLanguage(next.language);
    setHijri(next.hijriDates);
  }

  return (
    <>
      <SettingsSection title={t("language.title")} description={t("language.description")}>
        <Field label={t("language.label")} error={error} group disabled={pending}>
          <RadioGroup
            value={language}
            onValueChange={(value) => void save({ language: value as RecordLanguage, hijriDates: hijri })}
            readOnly={!canEdit}
            options={[
              { value: "bilingual", label: t("language.bilingual") },
              { value: "ar", label: t("language.ar") },
              { value: "en", label: t("language.en") },
            ]}
          />
        </Field>
      </SettingsSection>
      <SettingsSection title={t("hijri.title")} description={t("hijri.description")}>
        <Field label={t("hijri.label")} help={t("hijri.help")} layout="inline" disabled={pending}>
          <Switch checked={hijri} onCheckedChange={(next) => void save({ language, hijriDates: next })} readOnly={!canEdit} />
        </Field>
      </SettingsSection>
    </>
  );
}
