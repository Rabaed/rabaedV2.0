"use client";

import { stageCategories, type BilingualText, type Locale, type ProjectStage } from "@rabaed/domain";
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, Field, Icon, IconButton, Input, Select, SettingsSection } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { setupCall } from "@/lib/setup-call";

type Props = {
  projectId: string;
  moduleKey: string;
  moduleName: string;
  stages: ProjectStage[];
  canEdit: boolean;
};

/**
 * Project → Settings → Stages, one Module (RP-441, WF-5; workflow-engine.md "Stages"): the
 * Stages in the Module's order, each renamed in English and Arabic, moved up or down, or
 * deleted while no Step of the Project's Workflows uses it; a new one takes a key and a
 * category. A Stage keeps its key and category. Every Project Member reads them; Project
 * Admins change them (the API refuses anyone else with the plain 404).
 */
export function StagesEditor({ projectId, moduleKey, moduleName, stages, canEdit }: Props) {
  const t = useTranslations("projectSettings.stages");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState<BilingualText>({ en: "", ar: "" });
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const path = `/projects/${projectId}/modules/${moduleKey}/stages`;

  const refusal = (error: string) =>
    ({
      not_found: t("errors.notFound"),
      project_closed: t("errors.projectClosed"),
      invalid_name: t("errors.invalidName"),
      invalid_stage: t("errors.invalidStage"),
      stage_exists: t("errors.exists"),
      invalid_order: t("errors.invalidOrder"),
      stage_in_use: t("errors.inUse"),
    })[error] ?? t("errors.unavailable");

  async function run(call: Promise<Awaited<ReturnType<typeof setupCall>>>, done: string) {
    const res = await call;
    if (res.ok) {
      setNotice({ tone: "ok", text: done });
      setEditing(null);
      router.refresh();
    } else setNotice({ tone: "error", text: refusal(res.error) });
    return res.ok;
  }

  const move = (index: number, delta: -1 | 1) => {
    const keys = stages.map((s) => s.key);
    [keys[index], keys[index + delta]] = [keys[index + delta]!, keys[index]!];
    return run(setupCall("PUT", `${path}/order`, { keys }), t("reordered"));
  };

  return (
    <SettingsSection
      title={moduleName}
      description={t("moduleIntro")}
      actions={canEdit ? <AddStage path={path} stages={stages} refusal={refusal} onDone={() => { setNotice({ tone: "ok", text: t("added") }); router.refresh(); }} /> : undefined}
      bodyClassName="px-0 pt-[14px] pb-0"
      data-testid={`stages-${moduleKey}`}
    >
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`mx-5 mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${notice.tone === "error" ? "bg-danger-tint text-danger-fg" : "bg-success-tint text-success-fg"}`}>
          <Icon name={notice.tone === "error" ? "alert-circle" : "circle-check"} size={16} />
          {notice.text}
        </p>
      )}
      <ol aria-label={moduleName} className="flex flex-col">
        {stages.map((stage, index) => (
          <li key={stage.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-5 py-3" data-testid="stage-row">
            <span className="w-6 text-caption tabular-nums text-muted">{index + 1}</span>
            {editing === stage.key ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(setupCall("PATCH", `${path}/${stage.key}`, { name }), t("renamed"));
                }}
              >
                <Field label={t("nameEn")}>
                  <Input value={name.en} dir="ltr" maxLength={80} onChange={(e) => setName({ ...name, en: e.target.value })} />
                </Field>
                <Field label={t("nameAr")}>
                  <Input value={name.ar} dir="rtl" maxLength={80} onChange={(e) => setName({ ...name, ar: e.target.value })} />
                </Field>
                <Button type="submit" size="sm" disabled={name.en.trim() === "" || name.ar.trim() === ""}>
                  {t("save")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-text">{stage.name[locale]}</span>
                  <bdi dir="ltr" translate="no" className="ms-2 text-caption text-muted">{stage.key}</bdi>
                </span>
                <Badge tone={stage.category === "closed_positive" ? "success" : stage.category === "closed_negative" ? "danger" : stage.category === "in_progress" ? "info" : "neutral"}>
                  {t(`categories.${stage.category}`)}
                </Badge>
                {stage.inUse && <span className="text-caption text-muted">{t("inUse")}</span>}
                {canEdit && (
                  <span className="flex items-center gap-0.5">
                    <IconButton label={t("rename", { stage: stage.name[locale] })} size="sm" onClick={() => { setName(stage.name); setEditing(stage.key); setNotice(null); }}>
                      <Icon name="edit" size={16} />
                    </IconButton>
                    <IconButton label={t("moveUp", { stage: stage.name[locale] })} size="sm" disabled={index === 0} onClick={() => void move(index, -1)}>
                      <Icon name="arrow-up" size={16} />
                    </IconButton>
                    <IconButton label={t("moveDown", { stage: stage.name[locale] })} size="sm" disabled={index === stages.length - 1} onClick={() => void move(index, 1)}>
                      <Icon name="arrow-down" size={16} />
                    </IconButton>
                    <IconButton
                      label={stage.inUse ? t("deleteInUse", { stage: stage.name[locale] }) : t("delete", { stage: stage.name[locale] })}
                      size="sm"
                      disabled={stage.inUse}
                      onClick={() => void run(setupCall("DELETE", `${path}/${stage.key}`), t("removed"))}
                    >
                      <Icon name="trash" size={16} />
                    </IconButton>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </SettingsSection>
  );
}

/** "Add a Stage" to the Module: its key, its names and its category (kept for good). */
function AddStage({ path, stages, refusal, onDone }: { path: string; stages: ProjectStage[]; refusal: (error: string) => string; onDone: () => void }) {
  const t = useTranslations("projectSettings.stages");
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState<BilingualText>({ en: "", ar: "" });
  const [category, setCategory] = useState<(typeof stageCategories)[number]>("in_progress");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[a-z][a-z0-9_]{0,62}$/.test(key) && name.en.trim() !== "" && name.ar.trim() !== "" && !stages.some((s) => s.key === key);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Icon name="plus" size={15} />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("add")} description={t("addHelp")} closeLabel={t("close")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await setupCall("POST", path, { key, name, category });
            setBusy(false);
            if (res.ok) {
              setOpen(false);
              setKey("");
              setName({ en: "", ar: "" });
              onDone();
            } else setError(refusal(res.error));
          }}
        >
          <Field label={t("nameEn")} required>
            <Input value={name.en} dir="ltr" maxLength={80} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </Field>
          <Field label={t("nameAr")} required>
            <Input value={name.ar} dir="rtl" maxLength={80} onChange={(e) => setName({ ...name, ar: e.target.value })} />
          </Field>
          <Field label={t("key")} help={t("keyHelp")} required>
            <Input value={key} dir="ltr" maxLength={63} onChange={(e) => setKey(e.target.value.toLowerCase())} />
          </Field>
          <Field label={t("category")} help={t("categoryHelp")} required>
            <Select
              value={category}
              onValueChange={(v) => setCategory(stageCategories.find((c) => c === v) ?? "in_progress")}
              options={stageCategories.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
            />
          </Field>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-fg">
              <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !valid}>
              {t("addSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
