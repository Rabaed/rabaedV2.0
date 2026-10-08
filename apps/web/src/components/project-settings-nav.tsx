"use client";

import { SettingsNav, type SettingsNavItem } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

/**
 * The left navigation of the Project Settings pages (RP-412): Document
 * Numbering, Trades & Locations, and for a Project Admin Visibility. The
 * Authorized Person also reaches their Company's Members' Visibility, which
 * is the Participant's own page. The current page comes from the address.
 */
export function ProjectSettingsNav({
  projectId,
  isProjectAdmin,
  ownParticipantId,
}: {
  projectId: string;
  isProjectAdmin: boolean;
  /** The viewer's own Company's Participant, when they are its Authorized Person. */
  ownParticipantId?: string;
}) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const router = useRouter();
  const base = `/projects/${projectId}/settings`;

  const items: SettingsNavItem[] = [
    { key: "numbering", label: t("numbering"), icon: "file-text", href: `${base}/numbering` },
    { key: "trades-locations", label: t("tradesLocations"), icon: "map-pin", href: `${base}/trades-locations` },
    ...(isProjectAdmin ? [{ key: "visibility", label: t("visibility"), icon: "eye", href: `${base}/visibility` } satisfies SettingsNavItem] : []),
    ...(ownParticipantId
      ? [{ key: "members-visibility", label: t("membersVisibility"), icon: "eye-off", href: `/participants/${ownParticipantId}` } satisfies SettingsNavItem]
      : []),
  ];
  const current = items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.key;

  return (
    <SettingsNav
      heading={t("heading")}
      items={items}
      current={current}
      linkAs={Link}
      onNavigate={(href) => router.push(href)}
    />
  );
}
