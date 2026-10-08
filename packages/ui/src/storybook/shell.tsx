import type { ModuleKey } from "@rabaed/domain";
import { Button, IconButton } from "../components/button/button.tsx";
import { Icon } from "../components/icon/icon.tsx";
import { PageHeader } from "../components/shell/page-header.tsx";
import { ProjectTabs, projectTabKeys, type ProjectTabKey } from "../components/shell/project-tabs.tsx";
import { RabaedLogoTile, SidebarBrand, type SidebarProps } from "../components/shell/sidebar.tsx";
import { ProjectMark, TopBarTitle } from "../components/shell/page-frame.tsx";
import { DocNo } from "../components/doc-no/doc-no.tsx";
import { MemberMenu, type MemberMenuProps } from "../components/shell/member-menu.tsx";
import { storyLocale, storyText } from "./locale.ts";

// Story copy and fixtures shared by the shell stories.

export const projectTabLabels: Record<ProjectTabKey, { en: string; ar: string }> = {
  dashboard: { en: "Dashboard", ar: "لوحة المعلومات" },
  submittals: { en: "Submittals", ar: "التقديمات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  snag_list: { en: "Snag List", ar: "قائمة الملاحظات" },
  site_reports: { en: "Site Reports", ar: "تقارير الموقع" },
  drawings: { en: "Drawings", ar: "المخططات" },
  activity: { en: "Activity Feed", ar: "النشاط" },
  settings: { en: "Settings", ar: "الإعدادات" },
};
export const projectTabsLabel = { en: "Project", ar: "المشروع" };

type Context = { globals: Record<string, unknown> };

export function storyProjectTabs(context: Context, current: ProjectTabKey = "submittals", modules: readonly ModuleKey[] = ["submittals"]) {
  return (
    <ProjectTabs
      label={storyText(context, projectTabsLabel)}
      labels={Object.fromEntries(projectTabKeys.map((key) => [key, storyText(context, projectTabLabels[key])])) as Record<ProjectTabKey, string>}
      modules={modules}
      href={(key) => `#/projects/twr/${key}`}
      current={current}
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
  companyProjects: { en: "Company Projects", ar: "مشاريع الشركة" },
  back: { en: "Back to Projects", ar: "العودة إلى المشاريع" },
  hostCompany: { en: "Al Waha Developments", ar: "الواحة للتطوير" },
  collapse: { en: "Collapse sidebar", ar: "طي الشريط الجانبي" },
  expand: { en: "Expand sidebar", ar: "توسيع الشريط الجانبي" },
  menu: { en: "Menu", ar: "القائمة" },
  close: { en: "Close", ar: "إغلاق" },
  search: { en: "Search", ar: "بحث" },
  notifications: { en: "Notifications", ar: "الإشعارات" },
  profile: { en: "Profile", ar: "الملف الشخصي" },
  language: { en: "Language", ar: "اللغة" },
  signOut: { en: "Sign out", ar: "تسجيل الخروج" },
  person: { en: "Faisal Al Harbi", ar: "فيصل الحربي" },
  ownCompany: { en: "Tamkeen Contracting", ar: "تمكين للمقاولات" },
  project: { en: "Riyadh Tower 1", ar: "برج الرياض 1" },
  projectNumber: { en: "Project 14", ar: "المشروع 14" },
  newSubmittal: { en: "New submittal", ar: "تقديم جديد" },
  submittals: { en: "Submittals", ar: "التقديمات" },
};

export function storySidebar(context: Context, current = "projects"): SidebarProps {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return {
    brand: <SidebarBrand name={t(shellCopy.brand)} companyName={t(shellCopy.ownCompany)} />,
    brandCollapsed: <RabaedLogoTile />,
    footer: (collapsed) => storyMemberMenu(context, { placement: "sidebar", collapsed }),
    label: t(shellCopy.nav),
    collapseLabel: t(shellCopy.collapse),
    expandLabel: t(shellCopy.expand),
    current,
    sections: [
      {
        items: [
          { key: "home", label: t(shellCopy.home), icon: "home", href: "#/home" },
          { key: "projects", label: t(shellCopy.projects), icon: "buildings", href: "#/projects", count: "3" },
        ],
      },
      {
        label: t(shellCopy.myCompany),
        items: [
          { key: "members", label: t(shellCopy.members), icon: "users", href: "#/company/members" },
          { key: "company-projects", label: t(shellCopy.companyProjects), icon: "building", href: "#/company/projects" },
        ],
      },
    ],
  };
}

export function storyMemberMenu(context: Context, props: Partial<MemberMenuProps> = {}) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <MemberMenu
      name={t(shellCopy.person)}
      companyName={t(shellCopy.ownCompany)}
      label={t(shellCopy.profile)}
      locale={storyLocale(context)}
      languageLabel={t(shellCopy.language)}
      onLocaleChange={() => {}}
      {...props}
    >
      <Button variant="ghost" className="justify-start">
        <Icon name="logout" />
        {t(shellCopy.signOut)}
      </Button>
    </MemberMenu>
  );
}

/** The top bar inside a Project: back to Projects, the Project's mark, name and Host Company. */
export function storyProjectTitle(context: Context) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <TopBarTitle
      back={{ href: "#/projects", label: t(shellCopy.back) }}
      mark={<ProjectMark name={t(shellCopy.project)} />}
      title={t(shellCopy.project)}
      subtitle={t(shellCopy.hostCompany)}
    />
  );
}

export function storyTopBar(context: Context) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return {
    title: storyProjectTitle(context),
    notifications: (
      <IconButton label={t(shellCopy.notifications)}>
        <Icon name="bell" />
      </IconButton>
    ),
    member: storyMemberMenu(context),
  };
}

export function storyPageHeader(context: Context) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <PageHeader
      eyebrow={
        <>
          {t(shellCopy.projectNumber)} · <DocNo value="TWR" />
        </>
      }
      title={t(shellCopy.project)}
      actions={
        <Button>
          <Icon name="plus" />
          {t(shellCopy.newSubmittal)}
        </Button>
      }
      tabs={storyProjectTabs(context, "submittals", ["submittals", "inspections", "snag_list", "site_reports", "drawings"])}
    />
  );
}
