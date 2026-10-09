"use client";

import { formatDate, type Locale, type NumberingAttributes, type NumberingPattern, type NumberingVersion } from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Badge } from "../data/badge.tsx";
import { Icon } from "../icon/icon.tsx";
import { SettingsSection } from "../settings/settings-layout.tsx";
import { NumberingDrawer, TypeCode } from "./numbering-drawer.tsx";
import { patternNumber, scopedKinds } from "./numbering-model.ts";
import { PatternNumber, toneClasses, type NumberingText } from "./numbering-text.tsx";

// The Versions card of the Numbering page (RP-412 rebuild, owner decision
// 2026-10-09; not in the kit): every saved version of the Project pattern and of
// each Type's Custom pattern, with when it took effect, who saved it and a sample
// number; "Compare" puts a version beside the current one with the differences
// marked. Who saved it comes from the API as the reader may know it (V14, V15):
// a Company's name, or "a Project Admin", the person only within their own Company.

export type NumberingVersionsProps = {
  t: NumberingText;
  locale: Locale;
  versions: readonly NumberingVersion[];
  /** The Project's Work Item Types, for each Custom pattern's group. */
  types: readonly { id: string; code: string; name: string }[];
  /** The sample numbers' item: the viewer's own Participant, sequence 1. */
  example: Omit<NumberingAttributes, "typeCode">;
};

type Group = { key: string; name: string; code?: string; typeCode: string; versions: NumberingVersion[] };

/** The Versions card. */
export function NumberingVersions({ t, locale, versions, types, example }: NumberingVersionsProps) {
  const [comparing, setComparing] = useState<{ group: Group; version: NumberingVersion } | null>(null);
  const firstCode = types[0]?.code ?? "MAR";
  const groups: Group[] = [
    { key: "project", name: t("projectScope"), typeCode: firstCode, versions: versions.filter((v) => v.workItemTypeId === null) },
    ...types.map((type) => ({
      key: type.id,
      name: type.name,
      code: type.code,
      typeCode: type.code,
      versions: versions.filter((v) => v.workItemTypeId === type.id),
    })),
  ].filter((g) => g.versions.length > 0);

  const savedBy = (v: NumberingVersion) => {
    const by = v.savedBy;
    if (by.rabaed) return t("savedByRabaed");
    if (!by.company) return t("savedByAdmin");
    return by.member ? t("savedByMember", { member: by.member[locale], company: by.company[locale] }) : by.company[locale];
  };
  const date = (v: NumberingVersion) => formatDate(new Date(v.effectiveFrom), locale);

  return (
    <SettingsSection title={t("versionsTitle")} description={t("versionsIntro")} bodyClassName="px-0 pt-[14px] pb-0" data-testid="numbering-versions">
      {groups.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{t("versionsNone")}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col">
            <h3 className="flex items-center gap-2 border-t border-border-subtle px-5 pt-3 pb-2 text-sm font-semibold text-text first:border-t-0">
              {group.code !== undefined && <TypeCode code={group.code} />}
              {group.name}
            </h3>
            <div role="region" aria-label={group.name} tabIndex={0} className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr className="bg-surface-subtle">
                    {[t("colVersion"), t("colEffective"), t("colSavedBy"), t("colSample")].map((h) => (
                      <th key={h} scope="col" className="border-y border-border-subtle px-5 py-2.5 text-start text-caption font-semibold whitespace-nowrap text-muted">
                        {h}
                      </th>
                    ))}
                    <th scope="col" className="border-y border-border-subtle px-5 py-2.5">
                      <span className="sr-only">{t("colChange")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.versions.map((v, i) => (
                    <tr key={v.version} className="border-b border-border-subtle last:border-b-0" data-testid="numbering-version">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <b className="font-semibold text-text">{t("versionN", { n: v.version })}</b>
                          {i === 0 && (
                            <Badge tone="success" className="h-[22px] rounded-[6px] px-2 text-[11.5px]">
                              {t("current")}
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-text-secondary">{date(v)}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-text-secondary">{savedBy(v)}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {v.pattern ? (
                          <bdi dir="ltr" translate="no" className="text-[12.5px] font-semibold text-text tabular-nums">
                            {patternNumber(v.pattern, { ...example, typeCode: group.typeCode }, 1).text}
                          </bdi>
                        ) : (
                          <Badge tone="neutral" className="h-[22px] rounded-[6px] px-2 text-[11.5px]">
                            {t("usesProject")}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-end whitespace-nowrap">
                        {i > 0 && (
                          <Button size="sm" variant="secondary" aria-label={t("compareWith", { n: v.version, scope: group.name })} onClick={() => setComparing({ group, version: v })}>
                            {t("compare")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {comparing && (
        <NumberingDrawer
          open
          onOpenChange={(open) => !open && setComparing(null)}
          code={comparing.group.code}
          title={t("compareTitle", { scope: comparing.group.name })}
          description={t("compareIntro", { n: comparing.version.version })}
          closeLabel={t("close")}
          testId="numbering-compare-drawer"
        >
          <div className="grid gap-[14px] sm:grid-cols-2">
            <VersionCard
              t={t}
              title={`${t("versionN", { n: comparing.version.version })} · ${date(comparing.version)}`}
              pattern={comparing.version.pattern}
              other={comparing.group.versions[0]!.pattern}
              example={{ ...example, typeCode: comparing.group.typeCode }}
              marked
            />
            <VersionCard
              t={t}
              title={`${t("current")} · ${date(comparing.group.versions[0]!)}`}
              pattern={comparing.group.versions[0]!.pattern}
              other={comparing.version.pattern}
              example={{ ...example, typeCode: comparing.group.typeCode }}
            />
          </div>
        </NumberingDrawer>
      )}
    </SettingsSection>
  );
}

/** One version in the compare drawer: its number and settings, rows that differ from `other` marked when `marked`. */
function VersionCard({
  t,
  title,
  pattern,
  other,
  example,
  marked = false,
}: {
  t: NumberingText;
  title: string;
  pattern: NumberingPattern | null;
  other: NumberingPattern | null;
  example: NumberingAttributes;
  marked?: boolean;
}) {
  const segments = (p: NumberingPattern | null) => p?.segments.map((s) => (s.kind === "text" ? `${t("kinds.text")} ${s.text}` : s.kind === "location" ? `${t("kinds.location")} (${t(`levels.${(["zone", "building", "floor"] as const)[s.level - 1]}`)})` : t(`kinds.${s.kind}`))).join(" · ") ?? "";
  const counted = (p: NumberingPattern | null) =>
    p ? p.countedBy.map((i) => p.segments[i]!).filter((s) => scopedKinds.has(s.kind)).map((s) => t(`kinds.${s.kind}`)).join(" · ") || t("none") : "";
  const rows = pattern
    ? [
        { label: t("segmentsRow"), value: segments(pattern), changed: segments(pattern) !== segments(other) },
        { label: t("separator"), value: <bdi dir="ltr">{pattern.separator}</bdi>, changed: pattern.separator !== other?.separator },
        { label: t("digits"), value: pattern.seqDigits, changed: pattern.seqDigits !== other?.seqDigits },
        { label: t("countedRow"), value: counted(pattern), changed: counted(pattern) !== counted(other) },
      ]
    : [];
  const n = pattern ? patternNumber(pattern, example, 1) : null;
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface px-5 pt-4 pb-5" data-testid="version-card">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {n && pattern ? (
        <PatternNumber parts={n.parts} separator={pattern.separator} size="md" />
      ) : (
        <p className="text-sm text-muted">{t("usesProject")}</p>
      )}
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className={cn("flex flex-col gap-0.5 rounded-sm px-2 py-1.5", marked && row.changed && toneClasses.location.tint)}>
            <dt className="flex items-center gap-1.5 text-caption text-muted">
              {row.label}
              {marked && row.changed && (
                <span className="inline-flex items-center gap-1 font-semibold text-warning-fg" data-testid="version-changed">
                  <Icon name="alert-circle" size={12} />
                  {t("changed")}
                </span>
              )}
            </dt>
            <dd className="text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
