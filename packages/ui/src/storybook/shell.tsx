import { Button, IconButton } from "../components/button/button.tsx";
import { Icon } from "../components/icon/icon.tsx";
import { PageHeader } from "../components/shell/page-header.tsx";
import { ProjectTabs, projectTabKeys, type ProjectTabKey } from "../components/shell/project-tabs.tsx";
import type { SidebarProps } from "../components/shell/sidebar.tsx";
import { UserMenu, type UserMenuProps } from "../components/shell/user-menu.tsx";
import { storyLocale, storyText } from "./locale.ts";

// Story copy and fixtures shared by the shell stories.

export const projectTabLabels: Record<ProjectTabKey, { en: string; ar: string }> = {
  dashboard: { en: "Dashboard", ar: "لوحة المعلومات" },
  submittals: { en: "Submittals", ar: "التقديمات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  "snag-list": { en: "Snag List", ar: "قائمة الملاحظات" },
  "site-reports": { en: "Site Reports", ar: "تقارير الموقع" },
  drawings: { en: "Drawings", ar: "المخططات" },
  files: { en: "Files", ar: "الملفات" },
  views: { en: "Views", ar: "العروض" },
  schedule: { en: "Schedule", ar: "الجدول الزمني" },
  settings: { en: "Settings", ar: "الإعدادات" },
};
export const projectTabsLabel = { en: "Project", ar: "المشروع" };
export const comingSoon = { en: "Coming soon", ar: "قريبًا" };

type Context = { globals: Record<string, unknown> };

export function storyProjectTabs(context: Context, current: ProjectTabKey = "submittals") {
  return (
    <ProjectTabs
      label={storyText(context, projectTabsLabel)}
      labels={Object.fromEntries(projectTabKeys.map((key) => [key, storyText(context, projectTabLabels[key])])) as Record<ProjectTabKey, string>}
      href={(key) => `#/projects/twr/${key}`}
      current={current}
      comingSoonLabel={storyText(context, comingSoon)}
    />
  );
}


export const shellCopy = {
  brand: { en: "Rabaed", ar: "Rabaed" },
  nav: { en: "Main", ar: "الرئيسية" },
  home: { en: "Home", ar: "الصفحة الرئيسية" },
  projects: { en: "Projects", ar: "المشاريع" },
  myCompany: { en: "My Company", ar: "شركتي" },
  members: { en: "Members", ar: "الأعضاء" },
  company: { en: "Company profile", ar: "ملف الشركة" },
  collapse: { en: "Collapse sidebar", ar: "طي الشريط الجانبي" },
  expand: { en: "Expand sidebar", ar: "توسيع الشريط الجانبي" },
  menu: { en: "Menu", ar: "القائمة" },
  close: { en: "Close", ar: "إغلاق" },
  search: { en: "Search", ar: "بحث" },
  notifications: { en: "Notifications", ar: "الإشعارات" },
  account: { en: "Account", ar: "الحساب" },
  language: { en: "Language", ar: "اللغة" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
  person: { en: "Faisal Al Harbi", ar: "فيصل الحربي" },
  ownCompany: { en: "Tamkeen Contracting", ar: "تمكين للمقاولات" },
  project: { en: "Riyadh Tower 1", ar: "برج الرياض 1" },
  projectNumber: { en: "Project TWR-2026-014", ar: "المشروع TWR-2026-014" },
  newSubmittal: { en: "New submittal", ar: "تقديم جديد" },
};

export function storySidebar(context: Context, current = "projects"): SidebarProps {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return {
    brand: t(shellCopy.brand),
    label: t(shellCopy.nav),
    collapseLabel: t(shellCopy.collapse),
    expandLabel: t(shellCopy.expand),
    current,
    sections: [
      {
        items: [
          { key: "home", label: t(shellCopy.home), icon: "home", href: "#/home" },
          { key: "projects", label: t(shellCopy.projects), icon: "folder", href: "#/projects", count: "3" },
        ],
      },
      {
        label: t(shellCopy.myCompany),
        items: [
          { key: "members", label: t(shellCopy.members), icon: "users", href: "#/company/members" },
          { key: "company", label: t(shellCopy.company), icon: "building", href: "#/company" },
        ],
      },
    ],
  };
}

export function storyUserMenu(context: Context, props: Partial<UserMenuProps> = {}) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <UserMenu
      name={t(shellCopy.person)}
      companyName={t(shellCopy.ownCompany)}
      label={t(shellCopy.account)}
      locale={storyLocale(context)}
      languageLabel={t(shellCopy.language)}
      onLocaleChange={() => {}}
      {...props}
    >
      <Button variant="ghost" className="justify-start">
        <Icon name="logout" />
        {t(shellCopy.signOut)}
      </Button>
    </UserMenu>
  );
}

export function storyTopBar(context: Context) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return {
    search: (
      <Button variant="secondary" className="w-full max-w-sm justify-start">
        <Icon name="search" />
        {t(shellCopy.search)}
      </Button>
    ),
    notifications: (
      <IconButton label={t(shellCopy.notifications)}>
        <Icon name="bell" />
      </IconButton>
    ),
    user: storyUserMenu(context),
  };
}

export function storyPageHeader(context: Context) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <PageHeader
      eyebrow={t(shellCopy.projectNumber)}
      title={t(shellCopy.project)}
      actions={
        <Button>
          <Icon name="plus" />
          {t(shellCopy.newSubmittal)}
        </Button>
      }
      tabs={storyProjectTabs(context)}
    />
  );
}
