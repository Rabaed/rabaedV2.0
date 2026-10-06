"use client";

import {
  notificationGroups,
  type Locale,
  type NotificationEmailChoice,
  type NotificationGroup,
  type NotificationSettingsView,
  type UpdateNotificationSettingsRequest,
  type WatchOutcome,
  watchOutcomeNames,
  watchOutcomes,
} from "@rabaed/domain";
import { useState } from "react";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { Field } from "../form/field.tsx";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Switch } from "../form/switch.tsx";

// The Member's notification settings, in their profile (RP-355; spec RP-344
// "Notification settings"; design/prompts/views-dashboard-notifications.md §7).
// At the top: Pause all email, the language of emails, and a mute per Project.
// Then one row per group with an In-app switch and an Email choice; "Items I
// watch" also ticks the outcomes that notify. The Weekly Step Age report row is
// shown only to its recipients, with an Email switch only: it is an email on its
// own schedule, never in the bell. Every change applies at once; a refused one is
// undone and says so. Presentational: the page does the calls.

/* eslint-disable rabaed/no-ui-translations -- existing labels, still to move to the app's messages (RP-362 retro) */
const copy = {
  en: {
    email: "Email",
    pauseAll: "Pause all email",
    pauseHelp: "Stops every email until you turn it back on. Notifications still reach your bell.",
    language: "Language of emails",
    projects: "Projects",
    projectsHelp: "A muted Project sends you no notifications or emails. Items waiting on you still show as yours.",
    mute: "Mute",
    noProjects: "You are not on any Project yet.",
    groups: "Notifications",
    inApp: "In-app",
    emailChoice: { off: "Off", immediate: "Immediately", digest: "Daily digest" },
    group: {
      step_reached: "Step reached me or my pool",
      watched: "Items I watch",
      sent_back: "Sent Back to my Participant",
      vacancy: "Vacancy in my Company",
      weekly_report: "Weekly Step Age report",
    },
    weeklyHelp: "Emailed on Sunday mornings.",
    outcomes: "Outcomes that notify me",
    outcomeGroups: { review_code: "Review Codes", inspection_result: "Inspection Results", other: "Other outcomes" },
    refusals: { not_found: "That Project is no longer available to you.", unavailable: "That didn't save. Try again." },
  },
  ar: {
    email: "البريد الإلكتروني",
    pauseAll: "إيقاف كل الرسائل مؤقتًا",
    pauseHelp: "يوقف كل الرسائل حتى تعيد تشغيلها. تبقى الإشعارات تصلك في الجرس.",
    language: "لغة الرسائل",
    projects: "المشاريع",
    projectsHelp: "المشروع المكتوم لا يرسل إليك إشعارات ولا رسائل. وتبقى البنود التي تنتظرك ظاهرة لك.",
    mute: "كتم",
    noProjects: "لست في أي مشروع بعد.",
    groups: "الإشعارات",
    inApp: "داخل التطبيق",
    emailChoice: { off: "إيقاف", immediate: "فورًا", digest: "ملخص يومي" },
    group: {
      step_reached: "وصلتني خطوة أو وصلت مجموعتي",
      watched: "البنود التي أراقبها",
      sent_back: "أُرجع إلى المشارك الذي أنتمي إليه",
      vacancy: "شاغر في شركتي",
      weekly_report: "تقرير عمر الخطوة الأسبوعي",
    },
    weeklyHelp: "يُرسل بالبريد صباح كل أحد.",
    outcomes: "النتائج التي تُشعرني",
    outcomeGroups: { review_code: "رموز المراجعة", inspection_result: "نتائج الفحص", other: "نتائج أخرى" },
    refusals: { not_found: "لم يعد هذا المشروع متاحًا لك.", unavailable: "لم يُحفظ ذلك. حاول مرة أخرى." },
  },
} satisfies Record<Locale, unknown>;
/* eslint-enable rabaed/no-ui-translations */

// Each language named in itself, as language pickers do.
// eslint-disable-next-line rabaed/no-ui-translations -- a documented exception in packages/ui/README.md (language names, each in its own language, as in MemberMenu)
const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

const outcomeGroups: Record<keyof (typeof copy)["en"]["outcomeGroups"], readonly WatchOutcome[]> = {
  review_code: ["A", "B", "C", "D"],
  inspection_result: ["passed", "passed_with_comments", "failed"],
  other: ["approved", "rejected", "cancelled"],
};

const reviewCodes: readonly WatchOutcome[] = outcomeGroups.review_code;

/** A tickable outcome's name; a Review Code beside its letter ("A · Approved"). */
function outcomeLabel(outcome: WatchOutcome, locale: Locale): string {
  const name = watchOutcomeNames[outcome][locale];
  return reviewCodes.includes(outcome) ? `${outcome} · ${name}` : name;
}

type Refusal = keyof (typeof copy)["en"]["refusals"];
/** A save as the page calls it: a refusal by the API's error code. */
export type SettingsCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type NotificationSettingsFormProps = {
  locale: Locale;
  /** The settings as the API answered. */
  value: NotificationSettingsView;
  /** Saves every setting at once. */
  onSave: (settings: UpdateNotificationSettingsRequest) => ReturnType<SettingsCall>;
  /** Mutes (`true`) or unmutes a Project. */
  onMute: (projectId: string, muted: boolean) => ReturnType<SettingsCall>;
};

export function NotificationSettingsForm({ locale, value, onSave, onMute }: NotificationSettingsFormProps) {
  const t = copy[locale];
  const [saved, setSaved] = useState<UpdateNotificationSettingsRequest>({
    settings: value.settings,
    emailPaused: value.emailPaused,
    preferredLanguage: value.preferredLanguage,
  });
  const [projects, setProjects] = useState(value.projects);
  const [error, setError] = useState<string | null>(null);

  const refused = (reason: string) => setError(t.refusals[reason as Refusal] ?? t.refusals.unavailable);

  async function change(next: UpdateNotificationSettingsRequest) {
    const before = saved;
    setSaved(next);
    setError(null);
    try {
      const result = await onSave(next);
      if (!result.ok) {
        setSaved(before);
        refused(result.reason);
      }
    } catch {
      setSaved(before);
      refused("unavailable");
    }
  }

  async function mute(projectId: string, muted: boolean) {
    const set = (m: boolean) => setProjects((all) => all.map((p) => (p.id === projectId ? { ...p, muted: m } : p)));
    set(muted);
    setError(null);
    try {
      const result = await onMute(projectId, muted);
      if (!result.ok) {
        set(!muted);
        refused(result.reason);
      }
    } catch {
      set(!muted);
      refused("unavailable");
    }
  }

  const setGroup = (group: NotificationGroup, patch: Partial<UpdateNotificationSettingsRequest["settings"][NotificationGroup]>) =>
    change({ ...saved, settings: { ...saved.settings, [group]: { ...saved.settings[group], ...patch } } });

  const groups = notificationGroups.filter((g) => g !== "weekly_report" || value.receivesWeeklyReport);
  const emailOptions = (["off", "immediate", "digest"] as const satisfies readonly NotificationEmailChoice[]).map((choice) => ({
    value: choice,
    label: t.emailChoice[choice],
  }));

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <section aria-labelledby="notification-email" className="space-y-4">
        <h2 id="notification-email" className="text-h6 font-semibold">
          {t.email}
        </h2>
        <Field label={t.pauseAll} help={t.pauseHelp} layout="inline">
          <Switch checked={saved.emailPaused} onCheckedChange={(emailPaused) => void change({ ...saved, emailPaused })} />
        </Field>
        <Field label={t.language} group>
          <SegmentedControl
            value={saved.preferredLanguage}
            onValueChange={(language) => void change({ ...saved, preferredLanguage: language as Locale })}
            options={(["ar", "en"] as const).map((l) => ({ value: l, label: <span lang={l}>{languageNames[l]}</span> }))}
          />
        </Field>
      </section>

      <section aria-labelledby="notification-groups" className="space-y-4">
        <h2 id="notification-groups" className="text-h6 font-semibold">
          {t.groups}
        </h2>
        <ul className="divide-y divide-border border-y border-border">
          {groups.map((group) => {
            const setting = saved.settings[group];
            return (
              <li key={group} className="space-y-3 py-4" data-group={group}>
                <h3 className="font-medium">{t.group[group]}</h3>
                {group === "weekly_report" ? (
                  // An email only, on its own schedule: on or off.
                  <Field label={t.email} help={t.weeklyHelp} layout="inline">
                    <Switch
                      checked={setting.email !== "off"}
                      aria-describedby={`group-${group}`}
                      onCheckedChange={(on) => void setGroup(group, { inApp: false, email: on ? "immediate" : "off" })}
                    />
                  </Field>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                    <Field label={t.inApp} layout="inline">
                      <Switch
                        checked={setting.inApp}
                        aria-describedby={`group-${group}`}
                        onCheckedChange={(inApp) => void setGroup(group, { inApp })}
                      />
                    </Field>
                    <Field label={t.email} group>
                      <SegmentedControl
                        value={setting.email}
                        aria-describedby={`group-${group}`}
                        onValueChange={(email) => void setGroup(group, { email: email as NotificationEmailChoice })}
                        options={emailOptions}
                      />
                    </Field>
                  </div>
                )}
                {/* Names the row's controls for a screen reader: "In-app" alone doesn't say which group. */}
                <span id={`group-${group}`} hidden>
                  {t.group[group]}
                </span>
                {group === "watched" && (
                  <details className="group/outcomes">
                    <summary className="cursor-pointer text-sm font-medium text-primary pointer-coarse:min-h-11 pointer-coarse:py-3">{t.outcomes}</summary>
                    <div className="mt-3 grid gap-6 sm:grid-cols-3">
                      {Object.entries(outcomeGroups).map(([key, outcomes]) => (
                        <Field key={key} label={t.outcomeGroups[key as keyof typeof outcomeGroups]} group>
                          <CheckboxGroup
                            options={outcomes.map((o) => ({ value: o, label: outcomeLabel(o, locale) }))}
                            value={saved.settings.watched.outcomes.filter((o) => outcomes.includes(o))}
                            onValueChange={(ticked) => {
                              const kept = new Set([...saved.settings.watched.outcomes.filter((o) => !outcomes.includes(o)), ...ticked]);
                              void setGroup(group, { outcomes: watchOutcomes.filter((o) => kept.has(o)) });
                            }}
                          />
                        </Field>
                      ))}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="notification-projects" className="space-y-4">
        <div className="space-y-1">
          <h2 id="notification-projects" className="text-h6 font-semibold">
            {t.projects}
          </h2>
          <p className="text-sm text-muted">{t.projectsHelp}</p>
        </div>
        {projects.length === 0 ? (
          <p className="text-muted">{t.noProjects}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span id={`project-${project.id}`} className="font-medium">
                    {project.name[locale]}
                  </span>{" "}
                  <span className="text-sm text-muted" dir="ltr">
                    {project.code}
                  </span>
                </span>
                <Field label={t.mute} layout="inline">
                  <Switch
                    checked={project.muted}
                    aria-describedby={`project-${project.id}`}
                    onCheckedChange={(muted) => void mute(project.id, muted)}
                  />
                </Field>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
