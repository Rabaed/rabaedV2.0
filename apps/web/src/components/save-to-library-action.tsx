"use client";

import type { BilingualText, SavedToLibrary } from "@rabaed/domain";
import { Button, buttonVariants, Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, Field, Icon, Input, type ButtonProps } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { bilingualNameOf, setupCall } from "@/lib/setup-call";

export type SaveToLibraryActionProps = {
  /** The Workflow to copy: any the Member reads (a Project's, a Rabaed Default, their Library's). */
  workflowId: string;
  /** Its name, which the Library copy starts with. */
  name: BilingualText;
  /** Whether the viewer is their Company's Authorized Person: only they save to the Library (V18, WF-4). Without it the action is not shown. */
  isAuthorizedPerson: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
};

/**
 * "Save to my Company's Library" (RP-442, WF-19; ADR 0016): a button and the dialog it
 * opens, self-contained, so any page that lists a Workflow can offer it (the Project's
 * Settings → Workflows rows, RP-441). It copies the Workflow into the Company's Library
 * under the name the Authorized Person confirms, in English and in Arabic
 * (`POST /v1/workflows/:id/save-to-library`), then offers the Library.
 */
export function SaveToLibraryAction({ workflowId, name, isAuthorizedPerson, variant = "secondary", size = "sm", className }: SaveToLibraryActionProps) {
  const t = useTranslations("saveToLibrary");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<(SavedToLibrary & { name: string }) | null>(null);
  if (!isAuthorizedPerson) return null;

  const change = (next: boolean) => {
    setOpen(next);
    if (next) {
      setError(null);
      setSaved(null);
    }
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = bilingualNameOf(new FormData(event.currentTarget));
    if (!name) {
      setError(t("invalid"));
      return;
    }
    setPending(true);
    setError(null);
    const res = await setupCall("POST", `/workflows/${encodeURIComponent(workflowId)}/save-to-library`, { name });
    setPending(false);
    if (res.ok) {
      setSaved({ ...(res.body as SavedToLibrary), name: locale === "ar" ? name.ar : name.en });
      return;
    }
    setError(res.status === 404 ? t("notAllowed") : res.status === 400 || res.status === 422 ? t("invalid") : t("failed"));
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Icon name="folder" />
          {t("action")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("title")} description={t("description", { name: name[locale === "ar" ? "ar" : "en"] })} closeLabel={t("close")}>
        {saved ? (
          <div className="flex flex-col gap-4">
            <p role="status" className="flex items-start gap-2 text-body text-text">
              <Icon name={saved.published ? "circle-check" : "info-circle"} className={saved.published ? "text-success" : "text-muted"} />
              {saved.published ? t("notice", { name: saved.name }) : t("noticeDraft")}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t("close")}</Button>
              </DialogClose>
              <Link href="/library" className={buttonVariants({ variant: "primary" })}>
                {t("openLibrary")}
              </Link>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field label={t("nameEn")} id={`library-name-en-${workflowId}`} required>
              <Input name="nameEn" dir="ltr" lang="en" defaultValue={name.en} />
            </Field>
            <Field label={t("nameAr")} id={`library-name-ar-${workflowId}`} required>
              <Input name="nameAr" dir="rtl" lang="ar" defaultValue={name.ar} />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t("cancel")}</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
