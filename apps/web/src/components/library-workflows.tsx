"use client";

import { formatDayMonthYear, formatNumber, type LibraryWorkflows as LibraryWorkflowsRead, type Locale } from "@rabaed/domain";
import {
  Badge,
  buttonVariants,
  EmptyState,
  IconButton,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { UseOnProjectDialog, type UsableProject } from "@/components/use-on-project-dialog";

type Props = {
  library: LibraryWorkflowsRead;
  /** The Projects the Member is Project Admin of: where a Library Workflow can be used. */
  projects: UsableProject[];
  /** Only the Company's Authorized Person edits the Library and sets its defaults. */
  isAuthorizedPerson: boolean;
};

/**
 * My Company → Library → Workflows (RP-442, WF-19; design `settings-workflows.html`, its
 * Company library tab): the Company's Workflows with their Work Item Type and Versions. A
 * row opens the map (every Member) or the builder (the Authorized Person), a Project Admin
 * uses one on a Project, and the Authorized Person marks one as the Company's default for
 * its Type (RP-517). Forms join the Library as another tab later.
 */
export function LibraryWorkflows({ library, projects, isAuthorizedPerson }: Props) {
  const t = useTranslations("library");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setDefault(id: string, typeId: string, name: string, on: boolean) {
    setBusy(id);
    try {
      const res = on
        ? await fetch("/api/v1/company-defaults", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "workflow", workItemTypeId: typeId, itemId: id }),
          })
        : await fetch(`/api/v1/company-defaults?kind=workflow&workItemTypeId=${encodeURIComponent(typeId)}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: t("defaultFailed"), tone: "danger" });
        return;
      }
      toast({ title: on ? t("defaultSet", { name }) : t("defaultCleared"), tone: "success" });
      router.refresh();
    } catch {
      toast({ title: t("defaultFailed"), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const rows = library.workflows;
  return (
    <Tabs defaultValue="workflows" className="flex flex-col gap-4">
      <TabsList aria-label={t("holds")}>
        <TabsTrigger value="workflows" icon="git-branch" count={formatNumber(rows.length, locale)}>
          {t("workflows")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="workflows" className="flex flex-col gap-3">
        <Table label={t("tableLabel")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("workflow")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("versions")}</TableHead>
              <TableHead>{t("updated")}</TableHead>
              <TableHead align="end">
                <span className="sr-only">{t("manage")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={5}>
                <EmptyState icon="git-branch" title={t("emptyTitle")}>
                  {t("empty")}
                </EmptyState>
              </TableEmpty>
            ) : (
              rows.map((w) => {
                const name = w.name[locale];
                const type = w.workItemType;
                return (
                  <TableRow key={w.id}>
                    <TableCell className="min-w-56">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/library/workflows/${w.id}`} className="font-semibold text-text hover:underline">
                          {name}
                        </Link>
                        {w.isDefault && type && (
                          <Badge tone="brand" title={t("defaultFor", { type: type.name[locale] })}>
                            {t("default")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {type ? (
                        <span className="flex items-center gap-2">
                          <Badge dir="ltr">{type.code}</Badge>
                          <span className="text-muted">{type.name[locale]}</span>
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {w.publishedVersions.length === 0 ? (
                        <Badge tone="warning">{t("notPublished")}</Badge>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {w.publishedVersions.map((v) => (
                            <Badge key={v} dir="ltr">
                              {t("version", { version: formatNumber(v, locale) })}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDayMonthYear(new Date(w.updatedAt), locale, { month: "short" })}</TableCell>
                    <TableCell align="end">
                      <span className="flex items-center justify-end gap-2">
                        <Link href={`/library/workflows/${w.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          {isAuthorizedPerson ? t("open") : t("view")}
                        </Link>
                        {w.publishedVersions.length > 0 && <UseOnProjectDialog workflowId={w.id} name={w.name} projects={projects} />}
                        {isAuthorizedPerson && type && w.publishedVersions.length > 0 && (
                          <IconButton
                            label={w.isDefault ? t("clearDefault") : t("makeDefault")}
                            size="sm"
                            aria-pressed={w.isDefault}
                            disabled={busy === w.id}
                            onClick={() => setDefault(w.id, type.id, name, !w.isDefault)}
                          >
                            <Icon name="star" className={w.isDefault ? "fill-current text-brand-fg" : undefined} />
                          </IconButton>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p className="flex items-center gap-1.5 text-caption text-muted">
          <Icon name="info-circle" size={14} />
          {t("copyHint")}
        </p>
      </TabsContent>
    </Tabs>
  );
}
