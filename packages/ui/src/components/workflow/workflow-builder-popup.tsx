"use client";

import { itemsToCreateKey, type BilingualText, type FormValue, type Locale, type WorkflowScreenOption, type WorkflowTransition } from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { ActionForm, type ActionFormLabels } from "../form-engine/action-form.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Textarea } from "../form/textarea.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import type { WorkflowBuilderLabels } from "./workflow-builder-labels.ts";
import { askedFields, askedForm, codeColour } from "./workflow-builder-side.tsx";
import { referenceModal, referenceModalBody, referenceModalFooter } from "./workflow-parts.tsx";
import { focusRing } from "../form/control-styles.ts";

export type ActionPopupProps = {
  transition: WorkflowTransition;
  screens: readonly WorkflowScreenOption[];
  /** `preview`: as the holder sees it; `test`: a test run's move, with Skip. Nothing is saved either way. */
  mode: "preview" | "test";
  /** "Contractor Engineer → Contractor PM review". */
  route: string;
  locale: Locale;
  labels: WorkflowBuilderLabels;
  /** The Form engine's words: given, the pop-up is drawn by the real renderer; without, a plain stand-in. */
  actionFormLabels?: ActionFormLabels | undefined;
  onCancel: () => void;
  /** Confirmed: how many items its table of items to create lists. */
  onConfirm: (items: number) => void;
  /** A test run's move taken without filling the pop-up. */
  onSkip?: () => void;
  /**
   * From a Step that recommends a code: the codes it may recommend (the Type's closing outcomes), as the
   * Transition dialog asks them, optional; null or none: no Recommended Code.
   */
  recommend?: readonly { code: string; name: BilingualText }[] | null;
};

const empty = (v: unknown) => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/** The rows of a table answer that say something. */
const filledRows = (v: unknown) => (Array.isArray(v) ? v.filter((row) => row && typeof row === "object" && Object.values(row as object).some((c) => !empty(c))).length : 0);

/**
 * A Transition's pop-up (its Action Form, ADR 0019) from the builder (RP-555, the owner's V2):
 * the chosen Screen as the holder sees it, with the Internal Note under it, and its required
 * parts named in the footer until filled. Opened by "Preview pop-up", and by each move of a test
 * run, which may also Skip it. Nothing is ever saved or created.
 */
export function ActionPopup({ transition, screens, mode, route, locale, labels, actionFormLabels, onCancel, onConfirm, onSkip, recommend }: ActionPopupProps) {
  const schema = askedForm(transition, screens);
  const fields = askedFields(schema);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [internalNote, setInternalNote] = useState("");
  const [recommended, setRecommended] = useState<string | null>(null);
  // A table asks at least one row that says something; any other field an answer.
  const missing = fields.filter((f) => "required" in f && f.required === true && (f.type === "table" ? filledRows(answers[f.key]) === 0 : empty(answers[f.key])));
  const code = transition.outcome;
  const colour = code ? codeColour(code) : null;
  const items = filledRows(answers[itemsToCreateKey]);
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        title={
          <span className="flex items-center gap-3 font-sans text-lg font-bold">
            {code && colour ? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[11px] font-bold text-on-primary" style={{ background: colour.dot }} dir="ltr">
                {labels.codeChip(code)}
              </span>
            ) : (
              <Icon name="forms" size={18} className="text-primary" />
            )}
            <span className="flex min-w-0 flex-col">
              <bdi>{transition.label[locale]}</bdi>
              <span className="text-[12px] font-normal text-muted">{mode === "preview" ? labels.popupPreview(route) : labels.popupTestRun(route)}</span>
            </span>
          </span>
        }
        closeLabel={labels.close}
        className={cn(referenceModal, "w-[min(720px,calc(100%-2rem))]")}
      >
        <div className={referenceModalBody}>
          {recommend && recommend.length > 0 && (
            // The Recommended Code, as the reference's code cards; optional, as the Transition dialog asks it.
            <div role="radiogroup" aria-label={labels.recommendCode} className="flex flex-col gap-1.5">
              <span className="text-body font-medium">{labels.recommendCode}</span>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
                {recommend.map((o) => {
                  const tone = codeColour(o.code);
                  const on = recommended === o.code;
                  return (
                    <button
                      key={o.code}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setRecommended(on ? null : o.code)}
                      className={cn("flex flex-col items-start gap-0.5 rounded-[10px] bg-surface px-3 py-2.5 text-start", focusRing)}
                      style={{ boxShadow: on ? `inset 0 0 0 2px ${tone.dot}` : "inset 0 0 0 1.5px var(--border)", background: on ? tone.bg : undefined }}
                    >
                      <b className="text-[13px]" dir="ltr">
                        {labels.codeChip(o.code)}
                      </b>
                      <small className="text-[11.5px] font-medium text-muted">{o.name[locale]}</small>
                    </button>
                  );
                })}
              </div>
              <span className="text-caption text-muted">{labels.recommendCodeHelp}</span>
            </div>
          )}
          {actionFormLabels ? (
            <ActionForm
              schema={schema}
              answers={answers}
              internalNote={internalNote}
              locale={locale}
              labels={actionFormLabels}
              onChange={(changes: Readonly<Record<string, FormValue | undefined>>) => setAnswers((a) => ({ ...a, ...changes }))}
              onInternalNoteChange={setInternalNote}
              idPrefix={`popup-${transition.key}`}
            />
          ) : (
            // Without the Form engine's words (Rabaed Admin): each field as a plain box, then the Internal Note.
            <div className="flex flex-col gap-4">
              {fields.map((f) =>
                f.type === "table" ? (
                  // A table as a table: its columns, a row each, and Add row (a required one needs a row that says something).
                  <fieldset key={f.key} className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="mb-1 text-body font-medium">
                      {f.label[locale]}
                      {f.required === true && <span aria-hidden="true" className="ms-0.5 text-danger-fg">*</span>}
                    </legend>
                    {((answers[f.key] as Record<string, string>[] | undefined) ?? []).map((row, i) => (
                      <div key={i} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${f.columns.length}, minmax(0, 1fr))` }}>
                        {f.columns.map((c) => (
                          <Input
                            key={c.key}
                            aria-label={`${c.label[locale]} ${i + 1}`}
                            placeholder={c.label[locale]}
                            value={row[c.key] ?? ""}
                            onChange={(e) =>
                              setAnswers((a) => ({ ...a, [f.key]: ((a[f.key] as Record<string, string>[] | undefined) ?? []).map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)) }))
                            }
                          />
                        ))}
                      </div>
                    ))}
                    <Button variant="secondary" size="sm" className="self-start" onClick={() => setAnswers((a) => ({ ...a, [f.key]: [...((a[f.key] as unknown[] | undefined) ?? []), {}] }))}>
                      <Icon name="plus" />
                      {labels.addRow}
                    </Button>
                  </fieldset>
                ) : (
                <Field key={f.key} label={f.label[locale]} required={"required" in f && f.required === true}>
                  {f.type === "textarea" ? (
                    <Textarea value={String(answers[f.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} />
                  ) : (
                    <Input value={String(answers[f.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} />
                  )}
                </Field>
                ),
              )}
              <Field label={labels.internalNote}>
                <Textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        <DialogFooter className={cn(referenceModalFooter, "items-center")}>
          {missing.length > 0 && <span className="me-auto text-[12.5px] text-muted">{labels.requiredMissing(missing.map((f) => f.label[locale]).join(locale === "ar" ? "، " : ", "))}</span>}
          <Button variant="secondary" onClick={onCancel}>
            {labels.cancel}
          </Button>
          {mode === "test" && onSkip && (
            <Button variant="secondary" onClick={onSkip}>
              {labels.skip}
            </Button>
          )}
          <Button disabled={missing.length > 0} onClick={() => onConfirm(items)}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
