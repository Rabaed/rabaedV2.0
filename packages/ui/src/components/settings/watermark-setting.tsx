"use client";

import { useState, type ReactNode } from "react";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { SettingsSection } from "./settings-layout.tsx";

/** The watermark text in both languages. */
export type WatermarkText = { en: string; ar: string };

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
  /** The longest each language may be. */
  maxLength: number;
  labels: WatermarkSettingLabels;
  /** Saves the text, trimmed; resolves to an error message, or null once saved. */
  onSave: (next: WatermarkText) => Promise<ReactNode | null>;
  /** Everyone but a Project Admin reads it only. */
  readOnly?: boolean;
};

/**
 * Project → Settings → Documental Record: the Working Copy's watermark (RP-621), the text across
 * every page of the PDF of an item that isn't closed. Arabic and English, both needed, each up to
 * `maxLength`; Save only once it changed and neither is empty. No reference screen yet (RP-665);
 * it follows the settings cards around it.
 */
export function WatermarkSetting({ value, maxLength, labels, onSave, readOnly = false }: WatermarkSettingProps) {
  const [saved, setSaved] = useState(value);
  const [text, setText] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [justSaved, setJustSaved] = useState(false);
  const next: WatermarkText = { ...text, en: text.en.trim(), ar: text.ar.trim() };
  const valid = next.en !== "" && next.ar !== "" && next.en.length <= maxLength && next.ar.length <= maxLength;
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
          <Input dir="rtl" lang="ar" value={text.ar} maxLength={maxLength} onChange={edit("ar")} />
        </Field>
        <Field label={labels.en} required readOnly={readOnly} disabled={pending}>
          <Input dir="ltr" lang="en" value={text.en} maxLength={maxLength} onChange={edit("en")} />
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
