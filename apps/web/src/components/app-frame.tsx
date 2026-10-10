"use client";

import { appearanceCookie, appearanceCookieValue, type Appearance, type Locale } from "@rabaed/domain";
import {
  AppShell,
  Button,
  Icon,
  MemberMenu,
  PageContent,
  RabaedLogoTile,
  SidebarBrand,
  ToastProvider,
  buttonVariants,
  useToast,
  type SidebarSection,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
export function AppFrame(props: AppFrameProps) {
  const t = useTranslations("shell");
  // The frame's own short messages, e.g. a Theme that couldn't be kept.
  return (
    <ToastProvider label={t("notifications")} closeLabel={t("close")}>
      <Frame {...props} />
    </ToastProvider>
  );
}

/** The browser's mirror of the Member's choice, for the pages that read no Member (signing in); Secure over https. */
function mirror(value: Appearance) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${appearanceCookie}=${appearanceCookieValue(value)}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** Paints the page in a Theme and Mode, as the layout does on the server. */
function paint(value: Appearance) {
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.dataset.mode = value.mode;
}

function Frame({ locale, memberName, companyName, isAuthorizedPerson, unread, defaultCollapsed, appearance: kept, heading, tabs, children }: AppFrameProps) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [appearance, setAppearance] = useState(kept);
  // The choice the API holds now: what the page goes back to if a change isn't kept.
  const saved = useRef(kept);

  useEffect(() => mirror(kept), [kept]);
  // Repaint at once and mirror it; keep it for the Member (every device). Not kept: back to the saved choice, and say so.
  const changeAppearance = (next: Appearance) => {
    setAppearance(next);
    paint(next);
    mirror(next);
    void fetch("/api/v1/me/appearance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      .then((res) => res.ok)
      .catch(() => false)
      .then((ok) => {
        if (ok) {
          saved.current = next;
          return;
        }
        setAppearance(saved.current);
        paint(saved.current);
        mirror(saved.current);
        toast({ title: t("appearanceNotSaved"), tone: "danger" });
      });
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
