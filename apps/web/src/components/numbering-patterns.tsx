"use client";

import {
  rabaedDefaultNumberingPattern,
  type Locale,
  type NumberingPattern,
  type NumberingSettings,
  type SaveNumberingPatternRequest,
} from "@rabaed/domain";
import { Badge, Button, NumberingPatternBuilder, NumberingPatternView, SettingsSection, type NumberingPatternLabels } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

// Project Settings → Numbering, the Numbering Pattern section (RP-313): the
// Project's pattern and each Work Item Type's override. Every Project Member
// sees them read-only; a Project Admin changes them in the builder. The other
// Numbering sections (Participant Codes, counters) sit beside it on the page.

/** The builder's and the view's words, from the app's messages. */
function usePatternLabels(): NumberingPatternLabels {
  const t = useTranslations("numbering.pattern");
  return {
    kinds: {
      project: t("kinds.project"),
      type: t("kinds.type"),
      trade: t("kinds.trade"),
      participant: t("kinds.participant"),
      location: t("kinds.location"),
      text: t("kinds.text"),
    },
    levels: [t("levels.zone"), t("levels.building"), t("levels.floor")],
    segments: t("segments"),
    segment: (n) => t("segment", { n }),
    level: t("level"),
    text: t("text"),
    textHint: t("textHint"),
    textInvalid: t("textInvalid"),
    counted: t("counted"),
    countedHint: t("countedHint"),
    moveUp: (n) => t("moveUp", { n }),
    moveDown: (n) => t("moveDown", { n }),
    remove: (n) => t("remove", { n }),
    add: t("add"),
    separator: t("separator"),
    digits: t("digits"),
    example: t("example"),
    exampleHint: t("exampleHint"),
    sharedTitle: t("sharedTitle"),
    sharedBody: t("sharedBody"),
    sharedAccept: t("sharedAccept"),
    sharedReadOnly: t("sharedReadOnly"),
    save: t("save"),
    saving: t("saving"),
    afterChange: t("afterChange"),
    countedBadge: t("countedBadge"),
    close: t("close"),
  };
}

/** Saves a pattern and refreshes the page; on a refusal, says why. */
function useSavePattern(projectId: string) {
  const t = useTranslations("numbering");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (body: SaveNumberingPatternRequest): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/numbering`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        return true;
      }
      const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
      const errors: Record<string, string> = {
        invalid_request: t("invalid"),
        invalid_pattern: t("invalid"),
        shared_counter_not_accepted: t("sharedCounterNotAccepted"),
        // No longer a Project Admin, or a Type removed from view.
        not_found: t("notFound"),
        type_not_found: t("notFound"),
        project_closed: t("projectClosed"),
      };
      setError(errors[code ?? ""] ?? t("unavailable"));
      return false;
    } catch {
      setError(t("unavailable"));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { save, pending, error };
}

/** One pattern: read-only, or for a Project Admin with a button that opens the builder. */
function PatternEditor({
  projectId,
  workItemTypeId,
  pattern,
  example,
  canEdit,
  editLabel,
  hideView = false,
}: {
  projectId: string;
  workItemTypeId: string | null;
  pattern: NumberingPattern;
  example: NumberingSettings["example"] & { typeCode: string };
  canEdit: boolean;
  editLabel: string;
  /** A Type following the Project pattern: only the button, not the Project pattern again. */
  hideView?: boolean;
}) {
  const t = useTranslations("numbering");
  const locale = useLocale() as Locale;
  const [editing, setEditing] = useState(false);
  const { save, pending, error } = useSavePattern(projectId);
  const labels = usePatternLabels();

  if (!editing) {
    return (
      <div className="space-y-3">
        {!hideView && <NumberingPatternView labels={labels} pattern={pattern} example={example} />}
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {editLabel}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <NumberingPatternBuilder
        labels={labels}
        locale={locale}
        pattern={pattern}
        example={example}
        pending={pending}
        error={error}
        onSave={async (p, sharedCounterAccepted) => {
          if (await save({ workItemTypeId, pattern: p, sharedCounterAccepted })) setEditing(false);
        }}
      />
      <Button variant="ghost" onClick={() => setEditing(false)}>
        {t("cancel")}
      </Button>
    </div>
  );
}

/** The Project's Numbering Pattern and the per-Type overrides. */
export function NumberingPatterns({ projectId, settings }: { projectId: string; settings: NumberingSettings }) {
  const t = useTranslations("numbering");
  const locale = useLocale() as Locale;
  const projectPattern = settings.project?.pattern ?? rabaedDefaultNumberingPattern;
  // The Project pattern's example shows the first Type's code.
  const firstType = settings.types[0]?.code ?? "MAR";

  return (
    <>
      <SettingsSection
        title={t("projectPattern")}
        description={settings.project ? undefined : t("rabaedDefault")}
        data-testid="numbering-project-pattern"
      >
        <PatternEditor
          projectId={projectId}
          workItemTypeId={null}
          pattern={projectPattern}
          example={{ ...settings.example, typeCode: firstType }}
          canEdit={settings.canEdit}
          editLabel={t("edit")}
        />
      </SettingsSection>

      <SettingsSection title={t("types")} data-testid="numbering-type-overrides">
        <ul className="-my-4 divide-y divide-border">
          {settings.types.map((type) => (
            <li key={type.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">
                  {type.name[locale]}{" "}
                  <bdi dir="ltr" className="text-sm font-normal text-muted">
                    {type.code}
                  </bdi>
                </h3>
                <Badge tone={type.override ? "brand" : "neutral"}>{type.override ? t("custom") : t("usesDefault")}</Badge>
              </div>
              {type.override ? (
                <PatternEditor
                  projectId={projectId}
                  workItemTypeId={type.id}
                  pattern={type.override.pattern}
                  example={{ ...settings.example, typeCode: type.code }}
                  canEdit={settings.canEdit}
                  editLabel={t("override", { type: type.code })}
                />
              ) : (
                <>
                  <p className="text-sm text-muted">{t("followsProject")}</p>
                  {settings.canEdit && (
                    <PatternEditor
                      projectId={projectId}
                      workItemTypeId={type.id}
                      pattern={projectPattern}
                      example={{ ...settings.example, typeCode: type.code }}
                      canEdit
                      hideView
                      editLabel={t("addOverride")}
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}
