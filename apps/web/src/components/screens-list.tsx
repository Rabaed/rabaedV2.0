"use client";

import { formatNumber, type BilingualText, type Locale } from "@rabaed/domain";
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, Field, Icon, Input, SettingsSection } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { createdId, refusalMessage, setupCall } from "@/lib/setup-call";

export type ScreenRow = {
  id: string;
  key: string;
  name: BilingualText;
  owner: "project" | "rabaed";
  publishedVersions: number[];
  /** How many Workflow Versions pin one of its Versions. */
  pinnedBy: number;
  /** A Rabaed Default's published content, for copying it into the Project; null for the Project's own. */
  copy: { schema: unknown; internalFields: string[] } | null;
};

type Props = {
  projectId: string;
  canEdit: boolean;
  screens: ScreenRow[];
  /** What a new Screen starts with, in both languages whichever the author reads. */
  starting: { schema: unknown };
};

const cell = "px-5 py-3 align-middle";
const head = "border-b border-border-subtle bg-surface-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted";

/**
 * Project → Settings → Screens (RP-441; ADR 0019): the Project's Screens with their Versions
 * and how many Workflow Versions pin them, and the Rabaed Default Screens it may copy. A
 * Project Admin creates a Screen, copies a Default and edits; everyone else reads (V20).
 */
export function ScreensList({ projectId, canEdit, screens, starting }: Props) {
  const t = useTranslations("projectSettings.screens");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/projects/${projectId}/settings/screens`;
  const own = screens.filter((s) => s.owner === "project");
  const ownKeys = new Set(own.map((s) => s.key));
  const defaults = screens.filter((s) => s.owner === "rabaed" && !ownKeys.has(s.key));

  const refusal = (error: string) =>
    refusalMessage(t, { key_taken: "keyTaken", invalid_screen: "invalid", screen_problems: "problems", no_draft: "noDraft" }, error);

  /** Copies a Rabaed Default Screen in, published as it was (one call, one transaction), so Workflows can pin it at once. */
  async function copyDefault(row: ScreenRow) {
    if (!row.copy) return;
    setBusy(row.id);
    const res = await setupCall("POST", `/projects/${projectId}/screens`, {
      key: row.key,
      name: row.name,
      schema: row.copy.schema,
      internalFields: row.copy.internalFields,
      publish: true,
    });
    setBusy(null);
    const id = createdId(res);
    if (id) router.push(`${base}/${id}`);
    else setNotice(refusal(res.ok ? "unavailable" : res.error));
  }

  const table = (rows: ScreenRow[], title: string, intro: string, testId: string) => (
    <SettingsSection title={title} description={intro} bodyClassName="px-0 pt-[14px] pb-0" data-testid={testId}>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{t("none")}</p>
      ) : (
        <div role="region" aria-label={title} tabIndex={0} className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <table className="w-full min-w-[44rem] border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th scope="col" className={head}>{t("colScreen")}</th>
                <th scope="col" className={head}>{t("colVersions")}</th>
                <th scope="col" className={head}>{t("colUsedBy")}</th>
                <th scope="col" className={head}>
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const latest = row.publishedVersions.at(-1);
                return (
                  <tr key={row.id} className="border-b border-border-subtle last:border-b-0" data-testid="screen-row">
                    <th scope="row" className={`${cell} text-start font-normal`}>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold text-text">{row.name[locale]}</span>
                        <bdi dir="ltr" translate="no" className="w-fit text-caption text-muted">{row.key}</bdi>
                      </span>
                    </th>
                    <td className={cell}>
                      {latest === undefined ? <Badge tone="warning">{t("notPublished")}</Badge> : <Badge tone="success">{t("version", { n: formatNumber(latest, locale) })}</Badge>}
                    </td>
                    <td className={`${cell} text-muted`}>{row.owner === "rabaed" ? "—" : row.pinnedBy === 0 ? t("pinnedByNone") : t("pinnedByCount", { n: formatNumber(row.pinnedBy, locale) })}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      <span className="flex items-center justify-end gap-1.5">
                        {row.owner === "rabaed" ? (
                          canEdit &&
                          row.copy && (
                            <Button variant="secondary" size="sm" disabled={busy === row.id} onClick={() => void copyDefault(row)}>
                              <Icon name="copy" size={15} />
                              {t("copyIntoProject")}
                            </Button>
                          )
                        ) : (
                          <Link
                            href={`${base}/${row.id}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-brand-fg hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-focus"
                          >
                            <Icon name={canEdit ? "edit" : "eye"} size={15} />
                            {canEdit ? t("edit") : t("view")}
                          </Link>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SettingsSection>
  );

  return (
    <>
      {notice && (
        <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-fg">
          <Icon name="alert-circle" size={16} />
          {notice}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {table(own, t("ownTitle"), t("ownIntro"), "project-screens")}
        {canEdit && <NewScreen projectId={projectId} starting={starting} refusal={refusal} />}
        {table(defaults, t("defaultsTitle"), t("defaultsIntro"), "default-screens")}
      </div>
    </>
  );
}

/** "New Screen": a key and a name, with one first field; opens the editor. */
function NewScreen({ projectId, starting, refusal }: { projectId: string; starting: Props["starting"]; refusal: (error: string) => string }) {
  const t = useTranslations("projectSettings.screens");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState<BilingualText>({ en: "", ar: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-z][a-z0-9_]*$/.test(key) && name.en.trim() !== "" && name.ar.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-fit">
          <Icon name="plus" size={16} />
          {t("newScreen")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("newScreen")} description={t("newScreenHelp")} closeLabel={t("close")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await setupCall("POST", `/projects/${projectId}/screens`, { key, name, schema: starting.schema, internalFields: [] });
            setBusy(false);
            const id = createdId(res);
            if (id) router.push(`/projects/${projectId}/settings/screens/${id}`);
            else setError(refusal(res.ok ? "unavailable" : res.error));
          }}
        >
          <Field label={t("nameEn")} required>
            <Input value={name.en} dir="ltr" maxLength={120} onChange={(e) => setName({ ...name, en: e.target.value })} />
          </Field>
          <Field label={t("nameAr")} required>
            <Input value={name.ar} dir="rtl" maxLength={120} onChange={(e) => setName({ ...name, ar: e.target.value })} />
          </Field>
          <Field label={t("key")} help={t("keyHelp")} required>
            <Input value={key} dir="ltr" maxLength={64} onChange={(e) => setKey(e.target.value.toLowerCase())} />
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
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
