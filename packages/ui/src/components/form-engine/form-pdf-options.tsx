"use client";

import { DISCLAIMER_MAX_LENGTH, type FormPdf } from "@rabaed/domain";
import { useId, type ReactNode } from "react";
import { Field } from "../form/field.tsx";
import { Switch } from "../form/switch.tsx";
import { Textarea } from "../form/textarea.tsx";

// The Form builder's "Documental Record" panel (form-engine.md §6 and §9; RP-650): a Form
// Version's `pdf` block, its Disclaimer in Arabic and English and whether the record shows
// the review duration. The builder keeps the block with the Form Version it edits; once
// published it never changes, and every record made with that Version prints it.

export type FormPdfOptionsLabels = {
  title: ReactNode;
  intro: ReactNode;
  disclaimerAr: ReactNode;
  disclaimerEn: ReactNode;
  disclaimerHelp: ReactNode;
  /** Shown under the empty language when only one has text: a Disclaimer is in both or neither. */
  disclaimerBothLanguages: ReactNode;
  reviewDuration: ReactNode;
  /** Says what it is: the days from the Submission Date to the reply, information only. */
  reviewDurationHelp: ReactNode;
};

export type FormPdfOptionsProps = {
  value: FormPdf;
  onChange: (value: FormPdf) => void;
  labels: FormPdfOptionsLabels;
  /** A published Form Version: shown, never changed. */
  readOnly?: boolean;
};

/** The block with `disclaimer` set to these texts, or left out when both are empty. */
function withDisclaimer(value: FormPdf, ar: string, en: string): FormPdf {
  const { disclaimer: _old, ...rest } = value;
  // The Form's own text, as the author types it: not a translation of the panel's words.
  // eslint-disable-next-line rabaed/no-ui-translations
  return ar === "" && en === "" ? rest : { ...rest, disclaimer: { ar, en } };
}

/** Edits a Form Version's `pdf` block: its Disclaimer and the review duration choice. */
export function FormPdfOptions({ value, onChange, labels, readOnly = false }: FormPdfOptionsProps) {
  const ar = value.disclaimer?.ar ?? "";
  const en = value.disclaimer?.en ?? "";
  const half = (ar.trim() === "") !== (en.trim() === "");
  const titleId = useId();
  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="font-display text-h6 font-semibold text-text">
          {labels.title}
        </h2>
        <p className="text-body text-muted">{labels.intro}</p>
      </div>
      <Field label={labels.disclaimerAr} help={labels.disclaimerHelp} error={half && ar.trim() === "" ? labels.disclaimerBothLanguages : undefined} readOnly={readOnly}>
        <Textarea dir="rtl" lang="ar" rows={4} maxLength={DISCLAIMER_MAX_LENGTH} value={ar} onChange={(e) => onChange(withDisclaimer(value, e.target.value, en))} />
      </Field>
      <Field label={labels.disclaimerEn} error={half && en.trim() === "" ? labels.disclaimerBothLanguages : undefined} readOnly={readOnly}>
        <Textarea dir="ltr" lang="en" rows={4} maxLength={DISCLAIMER_MAX_LENGTH} value={en} onChange={(e) => onChange(withDisclaimer(value, ar, e.target.value))} />
      </Field>
      <Field layout="inline" label={labels.reviewDuration} help={labels.reviewDurationHelp} readOnly={readOnly}>
        <Switch checked={value.show_review_duration ?? false} onCheckedChange={(checked) => onChange({ ...value, show_review_duration: checked })} />
      </Field>
    </section>
  );
}
