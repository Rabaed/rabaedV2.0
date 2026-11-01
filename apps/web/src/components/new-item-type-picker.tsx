"use client";

import type { Locale, ModuleKey, RaisableTypes } from "@rabaed/domain";
import { Field, SegmentedControl } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { newItemHref } from "@/lib/new-item-route";

/**
 * The New item's Type picker (RP-590): the Types of the Module the viewer may
 * raise, the MAR first. The chosen Type is in the URL (`?type=SAR`), so a link
 * opens the right Form; choosing another one replaces it and the Form is that
 * Type's. The code is a Document Number segment, so it reads left to right. A Module
 * other than the Submittals (the Snag List's "+ New", RP-94) stays in the URL too.
 */
export function NewItemTypePicker({
  projectId,
  types,
  selected,
  moduleKey = "submittals",
  locale,
}: {
  projectId: string;
  types: RaisableTypes["types"];
  selected: string;
  moduleKey?: ModuleKey;
  locale: Locale;
}) {
  const t = useTranslations("workItems");
  const router = useRouter();
  return (
    <Field label={t("typePicker")} group>
      <SegmentedControl
        value={selected}
        onValueChange={(code) =>
          router.replace(newItemHref(projectId, moduleKey, code))
        }
        options={types.map((type) => ({
          value: type.code,
          label: (
            <span className="flex items-center gap-2">
              <bdi dir="ltr" className="font-mono text-xs">
                {type.code}
              </bdi>
              <span>{type.name[locale]}</span>
            </span>
          ),
        }))}
      />
    </Field>
  );
}
