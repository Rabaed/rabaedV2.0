"use client";

import { PageBackLink } from "@/components/page-back-link";
import { usePathname } from "@/i18n/navigation";
import { settingsBackParent } from "@/lib/settings-back-parent";

/** "← Back" above a Project settings page's title (RP-1241), with the page's parent read from its path. */
export function SettingsBackLink() {
  const parent = settingsBackParent(usePathname());
  return parent && <PageBackLink parent={parent} />;
}
