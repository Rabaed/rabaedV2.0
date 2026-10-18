"use client";

import type { BilingualText } from "@rabaed/domain";
import { useState } from "react";
import { Button } from "../button/button.tsx";
import { Field } from "../form/field.tsx";
import { Input } from "../form/input.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "../overlay/dialog.tsx";

// Rename and delete a Package (RP-659), from its page's header. The API decides who may
// (the owning Participant; delete only while Open) and the page offers what it allows.

type Result = Promise<{ ok: true } | { ok: false; reason: string }>;
type Shared = { close: string; cancel: string; refusals: Record<string, string> & { unavailable: string } };

/** A call's refusal as the dialog says it; null when it succeeded. */
async function refusalOf(call: () => Result, refusals: Shared["refusals"]): Promise<string | null> {
  try {
    const result = await call();
    return result.ok ? null : (refusals[result.reason] ?? refusals.unavailable);
  } catch {
    return refusals.unavailable;
  }
}

export type RenamePackageLabels = {
  /** The header button. */
  trigger: string;
  title: string;
  /** Under the title: once In Progress, the rename is recorded. */
  description: string;
  nameEn: string;
  nameAr: string;
  /** Both names are needed. */
  required: string;
  save: string;
};

export function RenamePackageDialog({
  name,
  labels,
  close,
  cancel,
  refusals,
  onRename,
}: Shared & { name: BilingualText; labels: RenamePackageLabels; onRename: (name: BilingualText) => Result }) {
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState(name.en);
  const [ar, setAr] = useState(name.ar);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const missing = en.trim() === "" || ar.trim() === "";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setEn(name.en);
          setAr(name.ar);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon name="pencil" />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={labels.title} description={labels.description} closeLabel={close}>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (missing) return setError(labels.required);
            setPending(true);
            // eslint-disable-next-line rabaed/no-ui-translations -- the name the Member typed in both languages, not a label
            const refused = await refusalOf(() => onRename({ en: en.trim(), ar: ar.trim() }), refusals);
            setPending(false);
            if (refused) setError(refused);
            else setOpen(false);
          }}
        >
          <Field label={labels.nameEn} required>
            <Input dir="ltr" lang="en" value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
          <Field label={labels.nameAr} required>
            <Input dir="rtl" lang="ar" value={ar} onChange={(e) => setAr(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{cancel}</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type DeletePackageLabels = {
  trigger: string;
  /** E.g. "Delete PKG-001?". */
  title: (number: string) => string;
  /** Its submittals stay, without a Package. */
  description: string;
  confirm: string;
};

export function DeletePackageDialog({
  number,
  labels,
  close,
  cancel,
  refusals,
  onDelete,
}: Shared & { number: string; labels: DeletePackageLabels; onDelete: () => Result }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon name="trash" />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={labels.title(number)} description={labels.description} closeLabel={close}>
        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{cancel}</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const refused = await refusalOf(onDelete, refusals);
              setPending(false);
              if (refused) setError(refused);
              else setOpen(false);
            }}
          >
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
