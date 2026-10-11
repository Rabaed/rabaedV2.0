"use client";

import { formatNumber, type ListedMember, type Locale } from "@rabaed/domain";
import { EmptyState, MembersCard, membersSearchStyle, ToastProvider, ToolbarSearch, type MemberRow } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MemberActions } from "@/components/member-actions";
import { filterMembers } from "@/lib/filter-members";

/**
 * The Members page's card (kit "Users", RP-413): search at its top, then each
 * Member with their marks, Projects and status, and for the Authorized Person a
 * "⋯" menu of commands. Search filters the Company's own list here; the API has
 * no search for it.
 */
export function MembersTable({ members, canManage }: { members: ListedMember[]; canManage: boolean }) {
  const t = useTranslations("members");
  const locale = useLocale() as Locale;
  const [words, setWords] = useState<string>();
  const shown = useMemo(() => filterMembers(members, words), [members, words]);

  if (members.length === 0) {
    return (
      <EmptyState icon="send" title={t("emptyTitle")}>
        {t("empty")}
      </EmptyState>
    );
  }

  const rows: MemberRow[] = shown.map((m) => ({
    id: m.id,
    name: m.fullName[locale],
    email: m.email,
    colourKey: m.id,
    initialsFrom: m.fullName.en,
    marks: [...(m.isAuthorizedPerson ? [t("authorizedPerson")] : []), ...(m.canCreateProjects ? [t("projectCreator")] : [])],
    projects: formatNumber(m.projectCount, locale),
    status: m.status,
    statusLabel: t(`statuses.${m.status}`),
    menu: canManage ? <MemberActions member={m} /> : undefined,
  }));

  return (
    <ToastProvider label={t("toastLabel")} closeLabel={t("close")}>
    <MembersCard
      rows={rows}
      hasMenu={canManage}
      labels={{
        table: t("tableLabel"),
        name: t("name"),
        marks: t("marks"),
        projects: t("projects"),
        status: t("status"),
        actions: t("actions"),
        none: t("none"),
      }}
      search={
        <ToolbarSearch
          key={words ?? ""}
          label={t("search")}
          placeholder={t("search")}
          description={t("searchHelp")}
          value={words}
          maxLength={100}
          {...membersSearchStyle}
          onSearch={setWords}
        />
      }
      empty={
        shown.length === 0 ? (
          <EmptyState icon="search" title={t("noMatchesTitle")}>
            {t("noMatches")}
          </EmptyState>
        ) : undefined
      }
    />
    </ToastProvider>
  );
}
