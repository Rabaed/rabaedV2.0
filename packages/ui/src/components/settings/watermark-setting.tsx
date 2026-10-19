"use client";

import { WATERMARK_MAX_LENGTH, workingCopyWatermarkRequest, type BilingualText } from "@rabaed/domain";
import { useState, type ReactNode } from "react";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SettingsSection } from "./settings-layout.tsx";

/** The watermark text in both languages. */
export type WatermarkText = BilingualText;

export type WatermarkSettingLabels = {
  title: ReactNode;
  description: ReactNode;
  en: ReactNode;
  ar: ReactNode;
  help: ReactNode;
  save: ReactNode;
  saved: ReactNode;
};

export type WatermarkSettingProps = {
  value: WatermarkText;
  labels: WatermarkSettingLabels;
  /** Saves the text, trimmed; resolves to an error message, or null once saved. */
  onSave: (next: WatermarkText) => Promise<ReactNode | null>;
  /** Everyone but a Project Admin reads it only. */
  readOnly?: boolean;
};

/**
 * Project → Settings → Documental Record: the Working Copy's watermark (RP-621), the text across
 * every page of the PDF of an item that isn't closed. Arabic and English, as the domain's rule has them
 * (workingCopyWatermarkRequest); Save only once it changed and fits that rule. No reference screen yet (RP-665);
 * it follows the settings cards around it.
 */
export function WatermarkSetting({ value, labels, onSave, readOnly = false }: WatermarkSettingProps) {
  const [saved, setSaved] = useState(value);
  const [text, setText] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [justSaved, setJustSaved] = useState(false);
  // The domain's rule trims both languages; Save sends what it gives.
  const parsed = workingCopyWatermarkRequest.safeParse({ watermark: text });
  const valid = parsed.success;
  const next: WatermarkText = parsed.success ? parsed.data.watermark : text;
  const changed = next.en !== saved.en || next.ar !== saved.ar;

  async function save() {
    setPending(true);
    setError(null);
    setJustSaved(false);
    const problem = await onSave(next);
    setPending(false);
    if (problem) {
      setError(problem);
      return;
    }
    setSaved(next);
    setText(next);
    setJustSaved(true);
  }

  const edit = (language: keyof WatermarkText) => (event: { target: { value: string } }) => {
    setJustSaved(false);
    setText({ ...text, [language]: event.target.value });
  };

  return (
    <SettingsSection title={labels.title} description={labels.description}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && changed && !pending) void save();
        }}
      >
        <Field label={labels.ar} required readOnly={readOnly} disabled={pending}>
          <Input dir="rtl" lang="ar" value={text.ar} maxLength={WATERMARK_MAX_LENGTH} onChange={edit("ar")} />
        </Field>
        <Field label={labels.en} required readOnly={readOnly} disabled={pending}>
          <Input dir="ltr" lang="en" value={text.en} maxLength={WATERMARK_MAX_LENGTH} onChange={edit("en")} />
        </Field>
        <p className="text-sm text-muted sm:col-span-2">{labels.help}</p>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" size="sm" disabled={!valid || !changed || pending}>
              {labels.save}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : justSaved ? (
              <p role="status" className="text-sm text-muted">
                {labels.saved}
              </p>
            ) : null}
          </div>
        )}
      </form>
    </SettingsSection>
  );
}
