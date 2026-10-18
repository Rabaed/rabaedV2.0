"use client";

import { Field, SettingsSection, Switch } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { refusalMessage, setupCall } from "@/lib/setup-call";

/**
 * Project → Settings → Modules (RP-652): the switch "Show Inspections in the Submittals tab". It
 * applies at once (PUT …/settings/show-inspections-in-submittals) and refreshes the page, so the tabs
 * above follow it. Only a Project Admin can change it; everyone else reads it.
 */
export function ProjectModulesSettings({
  projectId,
  showInspectionsInSubmittals,
  canEdit,
}: {
  projectId: string;
  showInspectionsInSubmittals: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("projectSettings.modules");
  const router = useRouter();
  const [show, setShow] = useState(showInspectionsInSubmittals);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function change(next: boolean) {
    setPending(true);
    setError(undefined);
    const result = await setupCall("PUT", `/projects/${encodeURIComponent(projectId)}/settings/show-inspections-in-submittals`, { show: next });
    setPending(false);
    if (!result.ok) {
      setError(refusalMessage(t, {}, result.error));
      return;
    }
    setShow(next);
    // The tabs are drawn from the Project, so they follow the switch.
    router.refresh();
  }

  return (
    <SettingsSection title={t("inspections.title")} description={t("inspections.description")}>
      <Field label={t("inspections.label")} help={t("inspections.help")} error={error} layout="inline" disabled={pending}>
        <Switch checked={show} onCheckedChange={(next) => void change(next)} readOnly={!canEdit} />
      </Field>
    </SettingsSection>
  );
}
