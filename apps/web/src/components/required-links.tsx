"use client";

import type { BilingualText, Locale, RequiredLinkField } from "@rabaed/domain";
import { Field, SettingsSection, Switch, useToast } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { refusalMessage, setupCall } from "@/lib/setup-call";

/**
 * Project → Settings → Required links (RP-82; form-engine.md §2.13): one card per Work
 * Item Type with link questions, each with a switch "Required on this Project", such as
 * the WIR's Approved submittals. Every Project Member reads it (V20); a Project Admin's
 * switch applies at once, and a refused one is undone and says why. A link question its
 * Form already makes required always shows on and can't be turned off here.
 */
export function RequiredLinks({ projectId, canEdit, fields }: { projectId: string; canEdit: boolean; fields: RequiredLinkField[] }) {
  const t = useTranslations("projectSettings.requiredLinks");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  // What a switch shows while its change is on its way; the page's data once refreshed.
  const [pending, setPending] = useState<Readonly<Record<string, boolean>>>({});
  const keyOf = (f: RequiredLinkField) => `${f.type}/${f.key}`;

  const types: { code: string; name: BilingualText; fields: RequiredLinkField[] }[] = [];
  for (const f of fields) {
    const type = types.find((x) => x.code === f.type);
    if (type) type.fields.push(f);
    else types.push({ code: f.type, name: f.typeName, fields: [f] });
  }

  const change = async (f: RequiredLinkField, required: boolean) => {
    setPending((p) => ({ ...p, [keyOf(f)]: required }));
    const res = await setupCall("PUT", `/projects/${projectId}/required-fields`, { type: f.type, key: f.key, required });
    const names = { field: f.label[locale], type: f.typeName[locale] };
    if (res.ok) {
      toast({ title: t(required ? "on" : "off", names), tone: "success" });
      router.refresh();
    } else {
      setPending((p) => {
        const { [keyOf(f)]: _undone, ...rest } = p;
        return rest;
      });
      toast({ title: refusalMessage(t, { type_not_found: "gone", field_not_found: "gone" }, res.error), tone: "danger" });
    }
  };

  if (types.length === 0) return <p className="text-sm text-muted">{t("none")}</p>;
  return (
    <>
      {types.map((type) => (
        <SettingsSection
          key={type.code}
          title={
            <>
              {type.name[locale]}{" "}
              <bdi dir="ltr" translate="no" className="text-caption font-normal text-muted">
                {type.code}
              </bdi>
            </>
          }
          bodyClassName="px-5 py-2"
          data-testid={`required-links-${type.code}`}
        >
          <ul className="divide-y divide-border">
            {type.fields.map((f) => (
              <li key={f.key} className="py-3">
                <Field label={f.label[locale]} help={f.requiredByForm ? t("byForm") : t("requiredHelp")} layout="inline" readOnly={!canEdit || f.requiredByForm}>
                  <Switch
                    checked={f.requiredByForm || (pending[keyOf(f)] ?? f.required)}
                    onCheckedChange={(on) => void change(f, on)}
                  />
                </Field>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ))}
    </>
  );
}
