"use client";

import { SettingsNav, type SettingsNavItem } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

/**
 * The left navigation of the Project Settings pages (RP-412): Document
 * Numbering, Workflows, Screens, Stages and Outcomes (RP-441: every Member reads
 * them, only Project Admins change them), Trades & Locations, and for a Project
 * Admin Visibility. The
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
    { key: "numbering", label: t("numbering"), icon: "list", href: `${base}/numbering` },
    { key: "workflows", label: t("workflows"), icon: "refresh", href: `${base}/workflows` },
    { key: "screens", label: t("screens"), icon: "template", href: `${base}/screens` },
    { key: "stages", label: t("stages"), icon: "flag", href: `${base}/stages` },
    { key: "outcomes", label: t("outcomes"), icon: "circle-check", href: `${base}/outcomes` },
    { key: "trades-locations", label: t("tradesLocations"), icon: "map-pin", href: `${base}/trades-locations` },
    ...(isProjectAdmin ? [{ key: "visibility", label: t("visibility"), icon: "eye", href: `${base}/visibility` } satisfies SettingsNavItem] : []),
    ...(ownParticipantId
      ? [{ key: "members-visibility", label: t("membersVisibility"), icon: "eye-off", href: `/participants/${ownParticipantId}` } satisfies SettingsNavItem]
      : []),
  ];
  // The builder takes the whole width: its page reaches under this column, so no navigation is drawn there.
  if (/\/settings\/workflows\/[^/]+$/.test(pathname)) return <div aria-hidden="true" />;
  const current =items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.key;

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
