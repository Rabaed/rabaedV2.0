"use client";

import { paperRefMaxLength } from "@rabaed/domain";
import { Button, Icon, Input } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { refusalMessage, setupCall } from "@/lib/setup-call";

/**
 * The Paper ref on the item page (RP-639, spec RP-631 story 27): the old paper number of a
 * submittal brought in while still under review on paper, never its Document Number. Read by
 * everyone who sees the item; changed by the raiser while it is their Draft (`canEdit`).
 */
export function WorkItemPaperRef({ workItemId, value, canEdit }: { workItemId: string; value: string | null; canEdit: boolean }) {
  const t = useTranslations("workItems.paperRef");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await setupCall("PUT", `/work-items/${workItemId}/paper-ref`, { paperRef: draft.trim() === "" ? null : draft });
    setBusy(false);
    if (!result.ok) {
      setError(refusalMessage(t, { paper_ref_taken: "taken", paper_ref_too_long: "tooLong", not_editable: "notEditable" }, result.error));
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {value ? (
          // A paper number reads left to right, like a Document Number.
          <bdi dir="ltr" className="font-mono text-[13px]">
            {value}
          </bdi>
        ) : (
          <span className="text-muted">{t("none")}</span>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Icon name="pencil" />
            {value ? t("change") : t("add")}
          </Button>
        )}
      </span>
    );
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("label")}
          dir="ltr"
          value={draft}
          maxLength={paperRefMaxLength}
          onChange={(e) => setDraft(e.target.value)}
          className="w-56"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={busy}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDraft(value ?? "");
            setError(null);
          }}
        >
          {t("cancel")}
        </Button>
      </span>
      <span className="text-[12.5px] text-muted">{t("help")}</span>
      {error && (
        <span role="alert" className="text-[13px] text-danger-fg">
          {error}
        </span>
      )}
    </form>
  );
}
