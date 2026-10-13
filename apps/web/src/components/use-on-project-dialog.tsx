"use client";

import type { BilingualText, Locale, StageCopyProblem } from "@rabaed/domain";
import { Button, buttonVariants, Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, Field, Icon, Input, Select } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { copyIntoProject } from "@/lib/copy-into-project";
import { bilingualNameOf } from "@/lib/setup-call";

/** A Project the Member is Project Admin of, which a Library Workflow can be copied into. */
export type UsableProject = { id: string; code: string; name: BilingualText };

type Props = {
  workflowId: string;
  /** The Library Workflow's name, which the copy starts with. */
  name: BilingualText;
  /** The Company's open Projects the Member is Project Admin of. */
  projects: UsableProject[];
};

/**
 * "Use on a Project" (RP-442, WF-19; ADR 0016): a Library Workflow copied into one of the
 * Projects the Member is Project Admin of (copyIntoProject, the same path as Settings →
 * Workflows' "Use a Library Workflow"). The copy is a draft of the Project's own,
 * independent of the Library; the dialog then offers it in the builder. A Project whose Module lacks a Stage the Workflow uses refuses it, naming each.
 */
export function UseOnProjectDialog({ workflowId, name, projects }: Props) {
  const t = useTranslations("library.useOn");
  const tLibrary = useTranslations("library");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<StageCopyProblem[]>([]);
  const [copied, setCopied] = useState<{ id: string; projectId: string; project: string } | null>(null);

  const change = (next: boolean) => {
    setOpen(next);
    if (next) {
      setError(null);
      setProblems([]);
      setCopied(null);
    }
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = bilingualNameOf(new FormData(event.currentTarget));
    const chosen = projects.find((p) => p.id === project);
    if (!name || !chosen) {
      setError(t("invalid"));
      return;
    }
    setPending(true);
    setError(null);
    setProblems([]);
    const copy = await copyIntoProject(workflowId, chosen.id, name);
    setPending(false);
    if (copy.ok) {
      setCopied({ id: copy.id, projectId: chosen.id, project: chosen.name[locale] });
      return;
    }
    setProblems(copy.problems);
    setError(
      { stage_missing: t("stageMissing"), project_closed: t("closed"), invalid_name: t("invalid"), invalid_request: t("invalid") }[copy.error] ?? t("failed"),
    );
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Icon name="copy" />
          {tLibrary("use")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("title")} description={t("description", { name: name[locale] })} closeLabel={tLibrary("close")}>
        {copied ? (
          <div className="flex flex-col gap-4">
            <p role="status" className="flex items-start gap-2 text-body text-text">
              <Icon name="circle-check" className="text-success" />
              {t("done", { project: copied.project })}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{tLibrary("close")}</Button>
              </DialogClose>
              <Link href={`/projects/${copied.projectId}/settings/workflows/${copied.id}`} className={buttonVariants({ variant: "primary" })}>
                {t("openCopy")}
              </Link>
            </DialogFooter>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted">{t("none")}</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{tLibrary("close")}</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field label={t("project")} id={`use-project-${workflowId}`} required>
              <Select
                value={project}
                onValueChange={setProject}
                placeholder={t("choose")}
                options={projects.map((p) => ({ value: p.id, label: `${p.name[locale]} · ${p.code}` }))}
              />
            </Field>
            <Field label={t("nameEn")} id={`use-name-en-${workflowId}`} required>
              <Input name="nameEn" dir="ltr" lang="en" defaultValue={name.en} />
            </Field>
            <Field label={t("nameAr")} id={`use-name-ar-${workflowId}`} required>
              <Input name="nameAr" dir="rtl" lang="ar" defaultValue={name.ar} />
            </Field>
            {error && (
              <div role="alert" className="flex flex-col gap-1 text-sm text-danger-fg">
                <p>{error}</p>
                {problems.length > 0 && (
                  <ul className="list-disc ps-5">
                    {problems.map((p) => (
                      <li key={p.stage}>{p.message[locale]}</li>
                    ))}
                  </ul>
                )}
              </div>
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
