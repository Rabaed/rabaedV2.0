"use client";

import type { CompanyMember, Locale } from "@rabaed/domain";
import {
  Avatar,
  Badge,
  EmptyState,
  ListToolbar,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToolbarSearch,
} from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { MemberActions } from "@/components/member-actions";
import { filterMembers } from "@/lib/filter-members";

const statusTone = { invited: "info", active: "success", locked: "warning", deactivated: "neutral" } as const;

/**
 * The Members page's body: the toolbar (Invite Member for the Authorized
 * Person, search by name or email) and the table in a card. Search filters the
 * Company's own list here; the API has no search for it.
 */
export function MembersTable({ members, canManage, invite }: { members: CompanyMember[]; canManage: boolean; invite?: ReactNode }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const [words, setWords] = useState<string>();
  const shown = useMemo(() => filterMembers(members, words), [members, words]);

  return (
    <div className="space-y-4">
      <ListToolbar label={t("toolbar")}>
        {invite}
        <ToolbarSearch
          key={words ?? ""}
          label={t("search")}
          placeholder={t("search")}
          description={t("searchHelp")}
          value={words}
          maxLength={100}
          onSearch={setWords}
        />
      </ListToolbar>
      {members.length === 0 ? (
        <EmptyState icon="send" title={t("emptyTitle")}>
          {t("empty")}
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={t("noMatchesTitle")}>
          {t("noMatches")}
        </EmptyState>
      ) : (
        <TableCard>
          <Table label={t("tableLabel")} data-testid="members" className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("projectCreator")}</TableHead>
                {canManage && <TableHead>{t("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.fullName[locale]} decorative />
                      <div className="min-w-0">
                        <div className="font-semibold">{m.fullName[locale]}</div>
                        <bdi dir="ltr" className="text-notes text-muted">
                          {m.email}
                        </bdi>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone[m.status]} dot>
                        {t(`statuses.${m.status}`)}
                      </Badge>
                      {m.isAuthorizedPerson && <Badge tone="brand">{t("authorizedPerson")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{m.canCreateProjects ? t("yes") : t("no")}</TableCell>
                  {canManage && (
                    <TableCell>
                      <MemberActions member={m} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
