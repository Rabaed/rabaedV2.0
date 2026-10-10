"use client";

import { appearanceCookie, appearanceCookieValue, type Appearance, type Locale } from "@rabaed/domain";
import { AppShell, Button, Icon, MemberMenu, PageContent, RabaedLogoTile, SidebarBrand, buttonVariants, type SidebarSection } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { sidebarCookie, sidebarItemOf } from "@/lib/shell";
import { NotificationBell } from "./notification-bell";

export type AppFrameProps = {
  locale: Locale;
  /** The signed-in Member's name and their Company's, in the page's language. */
  memberName: string;
  companyName: string;
  /** Only an Authorized Person sees Company Projects today. */
  isAuthorizedPerson: boolean;
  /** Unread notifications; null when they couldn't be read. */
  unread: number | null;
  defaultCollapsed: boolean;
  /** The Member's Theme and Mode, as the API keeps them; the layout painted <html> in it already. */
  appearance: Appearance;
  /** The top bar's title, from the `@heading` slot. */
  heading: ReactNode;
  /** The band under the top bar, from the `@tabs` slot: a Project's tabs. */
  tabs: ReactNode;
  children: ReactNode;
};

/**
 * The app shell every signed-in page sits in (RP-406): the sidebar (Home,
 * Projects, My Company), the top bar (the page's title, the bell, the Member's
 * menu) and the page's content beside them. The layout fetches the data; this
 * wires the shell to the URL, the language switch and signing out.
 */
export function AppFrame({ locale, memberName, companyName, isAuthorizedPerson, unread, defaultCollapsed, appearance: kept, heading, tabs, children }: AppFrameProps) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const [appearance, setAppearance] = useState(kept);

  // The browser's mirror of the Member's choice, for the pages that read no Member (signing in).
  const mirror = (value: Appearance) => {
    document.cookie = `${appearanceCookie}=${appearanceCookieValue(value)}; path=/; max-age=31536000; samesite=lax`;
  };
  useEffect(() => mirror(kept), [kept]);
  // Repaint at once, keep it for the Member (every device), and mirror it.
  const changeAppearance = (next: Appearance) => {
    setAppearance(next);
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.dataset.mode = next.mode;
    mirror(next);
    void fetch("/api/v1/me/appearance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
  };

  const sections: SidebarSection[] = [
    {
      items: [
        { key: "home", label: t("home"), icon: "home", href: "/" },
        { key: "projects", label: t("projects"), icon: "buildings", href: "/projects" },
      ],
    },
    {
      label: t("myCompany"),
      items: [
        // eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy
        { key: "members", label: t("members"), icon: "users", href: "/members" },
        ...(isAuthorizedPerson ? [{ key: "company-projects", label: t("participations"), icon: "building" as const, href: "/participants" }] : []),
      ],
    },
  ];

  const changeLocale = (next: Locale) => {
    // Same page, same query: only the language changes.
    router.replace(`${pathname}${window.location.search}`, { locale: next });
  };
  const signOut = async () => {
    await fetch("/api/v1/session", { method: "DELETE" });
    router.replace("/sign-in");
    router.refresh();
  };
  const rememberCollapsed = (collapsed: boolean) => {
    document.cookie = `${sidebarCookie}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  const memberMenu = (placement: "topBar" | "sidebar", collapsed = false) => (
    <MemberMenu
      name={memberName}
      companyName={companyName}
      label={t("memberMenu")}
      locale={locale}
      languageLabel={t("language")}
      onLocaleChange={changeLocale}
      appearance={{
        value: appearance,
        onChange: changeAppearance,
        labels: {
          theme: t("theme"),
          mode: t("mode"),
          themes: { grey: t("themes.grey"), warm: t("themes.warm") },
          modes: { light: t("modes.light"), dark: t("modes.dark"), system: t("modes.system") },
        },
      }}
      placement={placement}
      collapsed={collapsed}
    >
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <Link href="/profile" className={buttonVariants({ variant: "ghost", className: "justify-start" })}>
          {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
          <Icon name="user" />
          {t("profileSettings")}
        </Link>
        <Button variant="ghost" className="justify-start text-danger-fg" onClick={signOut}>
          <Icon name="logout" />
          {t("signOut")}
        </Button>
      </div>
    </MemberMenu>
  );

  return (
    <AppShell
      sidebar={{
        brand: <SidebarBrand name={t("appName")} companyName={companyName} />,
        brandCollapsed: <RabaedLogoTile />,
        footer: (collapsed) => memberMenu("sidebar", collapsed),
        label: t("nav"),
        sections,
        current: sidebarItemOf(pathname),
        linkAs: Link,
        collapseLabel: t("collapseSidebar"),
        expandLabel: t("expandSidebar"),
        defaultCollapsed,
        onCollapsedChange: rememberCollapsed,
      }}
      topBar={{
        title: heading,
        notifications: unread !== null ? <NotificationBell unread={unread} /> : undefined,
        member: memberMenu("topBar"),
      }}
      menuLabel={t("menu")}
      closeLabel={t("close")}
    >
      {tabs}
      <PageContent>{children}</PageContent>
    </AppShell>
  );
}
