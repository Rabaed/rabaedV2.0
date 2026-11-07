"use client";

import {
  formatDate,
  formatNumber,
  locales,
  watchOutcomeNames,
  watchOutcomes,
  type BilingualText,
  type Locale,
  type NotificationEmailChoice,
  type NotificationGroup,
  type NotificationSettingsView,
  type UpdateNotificationSettingsRequest,
  type WatchOutcome,
} from "@rabaed/domain";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { CheckboxGroup } from "../form/checkbox-group.tsx";
import { focusRing } from "../form/control-styles.ts";
import { SegmentedControl } from "../form/segmented-control.tsx";
import { Switch } from "../form/switch.tsx";
import { Icon, type IconName } from "../icon/icon.tsx";
import { projectTileClasses, projectTileIndexes, projectTileSmallTextClasses } from "../views/project-tile.ts";

// The Member's profile and notification settings (RP-1154), built to the owner's reference
// "Rabaed Profile & Notification Settings.html" (gap table approved 2026-11-06). Two cards: the
// Profile (who they are, their Positions on their Projects, the language of their emails, their
// Signature) and the Notification settings (Pause all email, a mute per Project, what to email).
// In-app notifications are always sent, so every setting here is about email (docs/visibility.md,
// "Notifications and emails"); a mute stops a Project's email only (owner, 2026-11-06, RP-1238).
// Every change saves at once; a refused one is undone and its reason shows where "Saved" would.
// Presentational: the page does the calls.

/** The page's words, from the app's messages. The outcomes' own names come from `watchOutcomeNames` in `@rabaed/domain`. */
export type ProfileSettingsLabels = {
  title: string;
  subtitle: string;
  saveIdle: string;
  /** "All changes saved · {time}", given the time already formatted (Riyadh, 24-hour). */
  allSaved: (values: { time: string }) => string;
  saved: string;
  profile: string;
  email: string;
  company: string;
  positions: string;
  lock: string;
  language: string;
  signature: string;
  notifications: string;
  inAppLine: string;
  pauseAll: string;
  pauseHelp: string;
  pausedHelp: string;
  projects: string;
  mute: string;
  unmuted: string;
  muted: string;
  noProjects: string;
  whatToEmail: string;
  groupColumn: string;
  emailColumn: string;
  emailChoice: Record<NotificationEmailChoice, string>;
  group: Record<NotificationGroup, string>;
  groupHelp: Record<Exclude<NotificationGroup, "watched">, string>;
  /** "{ticked} of {total} outcomes ticked", given both counts already formatted. */
  outcomesTicked: (counts: { ticked: string; total: string }) => string;
  outcomeGroups: { review_code: string; inspection_result: string; other: string };
  digestLine: string;
  refusals: { not_found: string; unavailable: string };
};

/** A save as the page calls it: a refusal by the API's error code. */
export type SettingsCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type ProfileSettingsProps = {
  locale: Locale;
  labels: ProfileSettingsLabels;
  /** The signed-in Member, as `/v1/me` answers: nothing here edits them. */
  member: { id: string; name: BilingualText; email: string; companyName: BilingualText };
  /** The settings as the API answered. */
  value: NotificationSettingsView;
  /** Their Signature card's content (RP-85), at the end of the Profile card. */
  signature?: ReactNode;
  /** Saves every setting at once. */
  onSave: (settings: UpdateNotificationSettingsRequest) => ReturnType<SettingsCall>;
  /** Mutes (`true`) or unmutes a Project. */
  onMute: (projectId: string, muted: boolean) => ReturnType<SettingsCall>;
  /** The time a save is stamped with; stories pin it so their screenshots stay the same. */
  now?: () => Date;
};

// Each language named in itself, as language pickers do.
// eslint-disable-next-line rabaed/no-ui-translations -- a documented exception in packages/ui/README.md (language names, each in its own language, as in MemberMenu)
const languageNames: Record<Locale, string> = { en: "English", ar: "العربية" };

const outcomeGroups: Record<keyof ProfileSettingsLabels["outcomeGroups"], readonly WatchOutcome[]> = {
  review_code: ["A", "B", "C", "D"],
  inspection_result: ["passed", "passed_with_comments", "failed"],
  other: ["approved", "rejected", "cancelled"],
};

// A Review Code's letter tile, in the code's own colours. Static so Tailwind finds them.
const codeTile: Partial<Record<WatchOutcome, string>> = {
  A: "bg-code-a-bg text-code-a-fg",
  B: "bg-code-b-bg text-code-b-fg",
  C: "bg-code-c-bg text-code-c-fg",
  D: "bg-code-d-bg text-code-d-fg",
};

/** A tickable outcome: a Review Code's letter tile, then its name. */
function OutcomeLabel({ outcome, locale }: { outcome: WatchOutcome; locale: Locale }) {
  const tile = codeTile[outcome];
  return (
    <span className="inline-flex items-center gap-2">
      {tile && (
        <span aria-hidden className={cn("inline-flex size-5 items-center justify-center rounded-[5px] text-[11px] font-extrabold", tile)}>
          {outcome}
        </span>
      )}
      {watchOutcomeNames[outcome][locale]}
    </span>
  );
}

/**
 * Each group's row in "What to email": the reference's icon and tint, its control (Off /
 * Immediately / Daily digest, or a switch for the weekly report), and whether its title opens
 * the outcomes to tick (Items I watch).
 */
const groupRow: Record<NotificationGroup, { icon: IconName; tile: string; control: "choice" | "switch"; opensOutcomes?: true }> = {
  // eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy
  step_reached: { icon: "user-check", tile: "bg-brand-tint text-brand-fg", control: "choice" },
  watched: { icon: "eye", tile: "bg-info-tint text-info-fg", control: "choice", opensOutcomes: true },
  sent_back: { icon: "arrow-back-up", tile: "bg-danger-tint text-danger-fg", control: "choice" },
  weekly_report: { icon: "chart-bar", tile: "bg-segment-type-tint text-segment-type-fg", control: "switch" },
};

type Refusal = keyof ProfileSettingsLabels["refusals"];
/** Nothing saved yet; saved (`flash` while the green "Saved" shows, then "All changes saved · time"); or refused. */
type SaveState = { kind: "idle" } | { kind: "saved"; at: Date; flash: boolean } | { kind: "refused"; message: string };

/** How long the green "Saved" shows before the line settles to "All changes saved · time", as the reference. */
export const savedFlashMs = 1600;

/**
 * One of the two cards: a 14px-round surface with an icon title and no divider under it, as the
 * reference draws them. Not the kit's TitledCard, whose header is divided off, bold and has no icon.
 */
function Card({ icon, title, titleId, children }: { icon: IconName; title: string; titleId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className="min-w-0 overflow-hidden rounded-[14px] bg-surface shadow-[0_0_0_1px_var(--color-border)]">
      <h2 id={titleId} className="flex items-center gap-2 px-[18px] pt-4 text-[15px] font-semibold">
        <Icon name={icon} size={18} className="text-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The reference's segmented control (`.pseg`): a 10px track with a thin inset border, 8px
 * segments in 12.5px semibold, and a chosen "Off" kept grey.
 */
const segmented = cn(
  "rounded-[10px] border-0 bg-surface-subtle p-0.5 shadow-[inset_0_0_0_1px_var(--color-border)]",
  "[&>*]:rounded-[8px] [&>*]:text-[12.5px] [&>*]:font-semibold [&>*]:whitespace-nowrap",
  "[&>[data-state=checked][value=off]]:text-muted",
);

/** A section's small uppercase heading inside the Notification settings card. */
function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mb-2.5 text-[12px] font-bold tracking-[.04em] text-muted uppercase rtl:tracking-normal">
      {children}
    </h3>
  );
}

/** A Project's code on its coloured tile; the name beside it says the same, so screen readers skip it. */
function ProjectCodeTile({ code, colour, size }: { code: string; colour: string; size: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      dir="ltr"
      className={cn(
        "flex shrink-0 items-center justify-center font-bold",
        size === "sm" ? "size-6 rounded-[6px] text-[10px]" : "size-[30px] rounded-[8px] text-[11px]",
        colour,
      )}
    >
      {code}
    </span>
  );
}

/** A small grey field label over its value. */
function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="mb-1 block text-[11.5px] text-muted">
      {children}
    </span>
  );
}

export function ProfileSettings({ locale, labels, member, value, signature, onSave, onMute, now = () => new Date() }: ProfileSettingsProps) {
  const id = useId();
  const [saved, setSaved] = useState<UpdateNotificationSettingsRequest>({
    settings: value.settings,
    emailPaused: value.emailPaused,
    preferredLanguage: value.preferredLanguage,
  });
  const [projects, setProjects] = useState(value.projects);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [watchedOpen, setWatchedOpen] = useState(false);
  const refused = (reason: string) => setState({ kind: "refused", message: labels.refusals[reason as Refusal] ?? labels.refusals.unavailable });
  // The green "Saved" settles after a moment; a newer save restarts it.
  useEffect(() => {
    if (state.kind !== "saved" || !state.flash) return;
    const timer = setTimeout(() => setState({ ...state, flash: false }), savedFlashMs);
    return () => clearTimeout(timer);
  }, [state]);

  /** Applies a change at once, then undoes it if the API refuses. */
  async function attempt(apply: () => void, undo: () => void, call: () => ReturnType<SettingsCall>) {
    apply();
    try {
      const result = await call();
      if (result.ok) return setState({ kind: "saved", at: now(), flash: true });
      undo();
      refused(result.reason);
    } catch {
      undo();
      refused("unavailable");
    }
  }
  const change = (next: UpdateNotificationSettingsRequest) => {
    const before = saved;
    return attempt(() => setSaved(next), () => setSaved(before), () => onSave(next));
  };
  const mute = (projectId: string, muted: boolean) => {
    const set = (m: boolean) => setProjects((all) => all.map((p) => (p.id === projectId ? { ...p, muted: m } : p)));
    return attempt(() => set(muted), () => set(!muted), () => onMute(projectId, muted));
  };
  const setGroup = (group: NotificationGroup, patch: Partial<UpdateNotificationSettingsRequest["settings"][NotificationGroup]>) =>
    change({ ...saved, settings: { ...saved.settings, [group]: { ...saved.settings[group], ...patch } } });

  const tiles = projectTileIndexes(projects.map((p) => p.id));
  const tileOf = (projectId: string) => {
    const index = tiles[projects.findIndex((p) => p.id === projectId)]!;
    return cn(projectTileClasses[index], projectTileSmallTextClasses[index]);
  };
  const groups = (["step_reached", "watched", "sent_back", "weekly_report"] as const).filter((g) => g !== "weekly_report" || value.receivesWeeklyReport);
  const emailOptions = (["off", "immediate", "digest"] as const).map((choice) => ({ value: choice, label: labels.emailChoice[choice] }));
  const groupHelp: Record<NotificationGroup, string> = {
    ...labels.groupHelp,
    watched: labels.outcomesTicked({
      ticked: formatNumber(saved.settings.watched.outcomes.length, locale),
      total: formatNumber(watchOutcomes.length, locale),
    }),
  };
  const paused = saved.emailPaused;

  const flashing = state.kind === "saved" && state.flash;
  const saveLine =
    state.kind === "refused" ? (
      <p role="alert" className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-danger-tint px-[11px] text-[12.5px] font-semibold text-danger-fg">
        <Icon name="alert-circle" size={16} />
        {state.message}
      </p>
    ) : (
      <p
        role="status"
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-full px-[11px] text-[12.5px]",
          flashing ? "bg-success-tint font-semibold text-success-fg" : "font-medium text-muted",
        )}
      >
        <Icon name="circle-check" size={16} className={flashing ? undefined : "text-success"} />
        {flashing
          ? labels.saved
          : state.kind === "saved"
            ? labels.allSaved({ time: formatDate(state.at, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })
            : labels.saveIdle}
      </p>
    );

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{labels.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{labels.subtitle}</p>
        </div>
        <span className="hidden flex-1 sm:block" />
        <div className="-ms-[11px] sm:ms-0">{saveLine}</div>
      </div>

      <div className="grid items-start gap-[18px] lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
        <Card icon="user-circle" title={labels.profile} titleId={`${id}-profile`}>
          <div className="flex flex-col gap-[14px] px-[18px] pt-[14px] pb-[18px]">
            <div className="flex items-center gap-3">
              <Avatar name={member.name[locale]} initialsFrom={member.name.en} solidFrom={member.id} size="lg" decorative className="size-[52px] text-[19px]" />
              <span className="min-w-0">
                <b className="block text-[16px] font-semibold">{member.name[locale]}</b>
                <span className="text-[12.5px] text-muted">{member.companyName[locale]}</span>
              </span>
            </div>
            <div>
              <FieldLabel>{labels.email}</FieldLabel>
              <span dir="ltr" className="block text-[13.5px] font-semibold break-all [unicode-bidi:isolate]">
                {member.email}
              </span>
            </div>
            <div>
              <FieldLabel>{labels.company}</FieldLabel>
              <span className="block text-[13.5px] font-semibold">{member.companyName[locale]}</span>
            </div>
            <div>
              <FieldLabel id={`${id}-positions`}>{labels.positions}</FieldLabel>
              {/* Every Project they are on, even one where they hold no Position yet (its row names none). */}
              {projects.length === 0 ? (
                <p className="text-[13px] text-muted">{labels.noProjects}</p>
              ) : (
                <ul aria-labelledby={`${id}-positions`} className="flex flex-col gap-1.5">
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 rounded-[9px] bg-surface-subtle px-2.5 py-2 text-[13px] shadow-[inset_0_0_0_1px_var(--color-border-subtle)]"
                    >
                      <ProjectCodeTile code={p.code} colour={tileOf(p.id)} size="sm" />
                      <span className="min-w-0 font-medium">{p.name[locale]}</span>
                      <span className="ms-auto text-end text-[12px] text-muted">{p.positions.map((name) => name[locale]).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="flex gap-1.5 text-[12px] leading-[1.4] text-muted">
              <Icon name="lock" size={14} className="mt-px shrink-0" />
              {labels.lock}
            </p>
            <div>
              <FieldLabel id={`${id}-language`}>{labels.language}</FieldLabel>
              <SegmentedControl
                aria-labelledby={`${id}-language`}
                className={segmented}
                value={saved.preferredLanguage}
                onValueChange={(language) => void change({ ...saved, preferredLanguage: language as Locale })}
                options={locales.map((l) => ({ value: l, label: <span lang={l}>{languageNames[l]}</span> }))}
              />
            </div>
            {signature !== undefined && (
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-[14px]">
                <FieldLabel>{labels.signature}</FieldLabel>
                {signature}
              </div>
            )}
          </div>
        </Card>

        <Card icon="bell" title={labels.notifications} titleId={`${id}-notifications`}>
          <p className="mx-[18px] mt-1 text-[12.5px] leading-[1.45] text-muted">{labels.inAppLine}</p>
          <div
            className={cn(
              "mx-[18px] mt-[14px] flex items-center gap-3 rounded-[12px] px-[14px] py-3",
              paused ? "bg-warning-tint" : "bg-surface-subtle shadow-[inset_0_0_0_1px_var(--color-border-subtle)]",
            )}
          >
            <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-surface", paused ? "text-warning-fg" : "text-text-secondary")}>
              <Icon name="mail" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <b id={`${id}-pause`} className="block text-[14px] font-semibold">
                {labels.pauseAll}
              </b>
              <span id={`${id}-pause-help`} className={cn("text-[12.5px] leading-[1.4]", paused ? "text-warning-fg" : "text-muted")}>
                {paused ? labels.pausedHelp : labels.pauseHelp}
              </span>
            </span>
            <Switch
              aria-labelledby={`${id}-pause`}
              aria-describedby={`${id}-pause-help`}
              checked={paused}
              className="data-[state=checked]:bg-segment-location-solid data-[state=checked]:hover:bg-segment-location-solid"
              onCheckedChange={(emailPaused) => void change({ ...saved, emailPaused })}
            />
          </div>

          {/* While email is paused, nothing below can send one: dimmed and inert, as the reference. */}
          <div inert={paused} className={cn("transition-opacity", paused && "opacity-45 saturate-[.6]")}>
            <div className="px-[18px] pt-4">
              <SectionHeading id={`${id}-projects`}>{labels.projects}</SectionHeading>
              {projects.length === 0 ? (
                <p className="text-[13px] text-muted">{labels.noProjects}</p>
              ) : (
                <ul aria-labelledby={`${id}-projects`} className="flex flex-col">
                  {projects.map((p, i) => (
                    <li key={p.id} className={cn("flex items-center gap-2.5 py-2.5", i === 0 ? "pt-0" : "border-t border-border-subtle")}>
                      <ProjectCodeTile code={p.code} colour={tileOf(p.id)} size="md" />
                      <span className="min-w-0 flex-1">
                        <b id={`${id}-project-${p.id}`} className={cn("block text-[13.5px] font-semibold", p.muted && "text-muted")}>
                          {p.name[locale]}
                        </b>
                        <span className="text-[12px] text-muted">{p.muted ? labels.muted : labels.unmuted}</span>
                      </span>
                      <span aria-hidden className="text-[12px] font-semibold text-muted">
                        {labels.mute}
                      </span>
                      <Switch aria-label={labels.mute} aria-describedby={`${id}-project-${p.id}`} checked={p.muted} onCheckedChange={(muted) => void mute(p.id, muted)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-[18px] pt-4">
              <SectionHeading>{labels.whatToEmail}</SectionHeading>
              <div className="overflow-hidden rounded-[12px] shadow-[inset_0_0_0_1px_var(--color-border-subtle)]">
                <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border-subtle bg-surface-subtle px-[14px] py-[9px] text-[11.5px] font-semibold text-muted sm:grid">
                  <span>{labels.groupColumn}</span>
                  <span>{labels.emailColumn}</span>
                </div>
                {groups.map((group, i) => {
                  const titleId = `${id}-group-${group}`;
                  const row = groupRow[group];
                  const title = (
                    <>
                      <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-[9px]", row.tile)}>
                        <Icon name={row.icon} size={16} />
                      </span>
                      <span className="min-w-0 text-start">
                        <b id={titleId} className="block text-[13.5px] font-semibold">
                          {labels.group[group]}
                        </b>
                        <span className="block text-[12px] leading-[1.4] text-muted">{groupHelp[group]}</span>
                      </span>
                    </>
                  );
                  return (
                    <div
                      key={group}
                      role="group"
                      aria-labelledby={titleId}
                      className={cn("grid gap-3 px-[14px] py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", i > 0 && "border-t border-border-subtle")}
                    >
                      {row.opensOutcomes ? (
                        <button
                          type="button"
                          aria-expanded={watchedOpen}
                          aria-controls={`${id}-outcomes`}
                          onClick={() => setWatchedOpen((open) => !open)}
                          className={cn("flex min-w-0 items-center gap-2.5 self-start rounded-md text-start pointer-coarse:min-h-11", focusRing)}
                        >
                          {title}
                          <Icon name="chevron-down" size={16} className={cn("shrink-0 text-muted transition-transform", watchedOpen && "rotate-180")} />
                        </button>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2.5">{title}</div>
                      )}
                      {row.control === "switch" ? (
                        <Switch
                          aria-labelledby={titleId}
                          checked={saved.settings[group].email !== "off"}
                          onCheckedChange={(on) => void setGroup(group, { email: on ? "immediate" : "off" })}
                        />
                      ) : (
                        <SegmentedControl
                          aria-labelledby={titleId}
                          className={cn(segmented, "w-full sm:w-fit [&>*]:flex-1")}
                          value={saved.settings[group].email}
                          onValueChange={(email) => void setGroup(group, { email: email as NotificationEmailChoice })}
                          options={emailOptions}
                        />
                      )}
                      {row.opensOutcomes && watchedOpen && (
                        <div
                          id={`${id}-outcomes`}
                          className="grid gap-3 rounded-[10px] bg-surface-subtle p-3 sm:col-span-2 sm:ms-[42px] sm:grid-cols-3"
                        >
                          {Object.entries(outcomeGroups).map(([key, outcomes]) => (
                            <div key={key} className="min-w-0">
                              <h4 id={`${id}-outcomes-${key}`} className="mb-2 text-[11.5px] font-bold text-muted">
                                {labels.outcomeGroups[key as keyof typeof outcomeGroups]}
                              </h4>
                              <CheckboxGroup
                                aria-labelledby={`${id}-outcomes-${key}`}
                                className="gap-2"
                                options={outcomes.map((o) => ({ value: o, label: <OutcomeLabel outcome={o} locale={locale} /> }))}
                                value={saved.settings.watched.outcomes.filter((o) => outcomes.includes(o))}
                                onValueChange={(chosen) => {
                                  const kept = new Set([...saved.settings.watched.outcomes.filter((o) => !outcomes.includes(o)), ...chosen]);
                                  void setGroup("watched", { outcomes: watchOutcomes.filter((o) => kept.has(o as WatchOutcome)) });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2.5 flex gap-2 rounded-[10px] bg-info-tint px-3 py-2.5 text-[12.5px] leading-[1.45] text-info-fg">
                <Icon name="clock" size={15} className="mt-px shrink-0" />
                {labels.digestLine}
              </p>
            </div>
          </div>
          <div className="h-[18px]" />
        </Card>
      </div>
    </div>
  );
}
