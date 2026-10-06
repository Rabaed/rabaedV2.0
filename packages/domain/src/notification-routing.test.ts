import { describe, expect, it } from "vitest";
import {
  defaultNotificationSettings,
  notificationEmailChoices,
  notificationGroupOf,
  notificationKinds,
  routeNotification,
  watchOutcomes,
  type NotificationGroupSetting,
  type NotificationKind,
  type NotificationSettings,
  type RouteNotificationInput,
} from "./notification-routing.ts";

// The routing rule (spec RP-344, "Notifications"; RP-355): for one recipient of
// one event, whether it reaches their bell and how it is emailed.

/** Settings where `group` is set to `setting` and every other group is the default. */
function withGroup(kind: NotificationKind, setting: Partial<NotificationGroupSetting>): NotificationSettings {
  const group = notificationGroupOf(kind);
  return { ...defaultNotificationSettings, [group]: { ...defaultNotificationSettings[group], ...setting } };
}

const input = (over: Partial<RouteNotificationInput> & Pick<RouteNotificationInput, "kind">): RouteNotificationInput => ({
  outcome: null,
  settings: defaultNotificationSettings,
  muted: false,
  emailPaused: false,
  ...over,
});

describe("the defaults", () => {
  it("are in-app on, email immediately for Step reached and Sent Back, a digest for the rest, every outcome ticked, and the weekly report emailed", () => {
    expect(defaultNotificationSettings).toEqual({
      step_reached: { inApp: true, email: "immediate" },
      watched: { inApp: true, email: "digest", outcomes: ["A", "B", "C", "D", "passed", "passed_with_comments", "failed", "approved", "rejected", "cancelled"] },
      sent_back: { inApp: true, email: "immediate" },
      vacancy: { inApp: true, email: "digest" },
      weekly_report: { inApp: false, email: "immediate" },
    });
  });

  it("route each kind to the bell and its default email", () => {
    expect(notificationKinds.map((kind) => [kind, routeNotification(input({ kind }))])).toEqual([
      ["step_reached", { inApp: true, email: "immediate" }],
      ["watched_event", { inApp: true, email: "digest" }],
      ["sent_back", { inApp: true, email: "immediate" }],
      ["vacancy", { inApp: true, email: "digest" }],
      ["weekly_report", { inApp: false, email: "immediate" }],
    ]);
  });
});

describe("a group's own setting", () => {
  it("turns the bell off without touching email", () => {
    expect(routeNotification(input({ kind: "step_reached", settings: withGroup("step_reached", { inApp: false }) }))).toEqual({
      inApp: false,
      email: "immediate",
    });
  });

  it("chooses the email: off is none, otherwise as chosen", () => {
    expect(notificationEmailChoices.map((email) => routeNotification(input({ kind: "vacancy", settings: withGroup("vacancy", { email }) })).email)).toEqual([
      "none",
      "immediate",
      "digest",
    ]);
  });

  it("applies only to its own group", () => {
    const settings = withGroup("sent_back", { inApp: false, email: "off" });
    expect(routeNotification(input({ kind: "step_reached", settings }))).toEqual({ inApp: true, email: "immediate" });
    expect(routeNotification(input({ kind: "sent_back", settings }))).toEqual({ inApp: false, email: "none" });
  });
});

describe("the weekly report", () => {
  const weekly = (email: NotificationGroupSetting["email"], inApp = true) =>
    routeNotification(input({ kind: "weekly_report", settings: withGroup("weekly_report", { inApp, email }) }));

  it("is an email only: never the bell, whatever is stored", () => {
    expect(weekly("immediate").inApp).toBe(false);
    expect(weekly("immediate", false).inApp).toBe(false);
  });

  it("is emailed when its email is on, on its own schedule (a stored digest counts as on), and not when off", () => {
    expect(weekly("immediate").email).toBe("immediate");
    expect(weekly("digest").email).toBe("immediate");
    expect(weekly("off").email).toBe("none");
  });
});

describe("outcome ticks on watched items", () => {
  const onlyAB = withGroup("watched_event", { outcomes: ["A", "B"] });

  it("notify a watcher who ticked A and B of Code B, not of Code C", () => {
    expect(routeNotification(input({ kind: "watched_event", outcome: "B", settings: onlyAB }))).toEqual({ inApp: true, email: "digest" });
    expect(routeNotification(input({ kind: "watched_event", outcome: "C", settings: onlyAB }))).toEqual({ inApp: false, email: "none" });
  });

  it("never hold back an event with no outcome, such as a Transition or a new Revision", () => {
    expect(routeNotification(input({ kind: "watched_event", outcome: null, settings: withGroup("watched_event", { outcomes: [] }) }))).toEqual({
      inApp: true,
      email: "digest",
    });
  });

  it("never hold back an outcome nobody can tick", () => {
    expect(routeNotification(input({ kind: "watched_event", outcome: "closed", settings: withGroup("watched_event", { outcomes: [] }) }))).toEqual({
      inApp: true,
      email: "digest",
    });
  });

  it("apply only to watched items", () => {
    const settings = withGroup("watched_event", { outcomes: [] });
    expect(routeNotification(input({ kind: "step_reached", outcome: "C", settings }))).toEqual({ inApp: true, email: "immediate" });
  });
});

describe("mute and pause", () => {
  it("a muted Project silences the bell and the email", () => {
    for (const kind of notificationKinds) expect(routeNotification(input({ kind, muted: true })), kind).toEqual({ inApp: false, email: "none" });
  });

  it("pausing all email stops every email and leaves the bell", () => {
    for (const kind of notificationKinds)
      expect(routeNotification(input({ kind, emailPaused: true })), kind).toEqual({ inApp: kind !== "weekly_report", email: "none" });
  });
});

describe("every combination", () => {
  const outcomes = [null, ...watchOutcomes, "closed"] as const;
  const tickSets = [watchOutcomes, [], ["A", "B"]] as const;
  const cases = notificationKinds.flatMap((kind) =>
    outcomes.flatMap((outcome) =>
      [true, false].flatMap((inApp) =>
        notificationEmailChoices.flatMap((email) =>
          tickSets.flatMap((outcomesTicked) =>
            [true, false].flatMap((muted) =>
              [true, false].map((emailPaused) => ({
                kind,
                outcome,
                muted,
                emailPaused,
                inApp,
                email,
                ticks: outcomesTicked as readonly string[],
                settings: withGroup(kind, { inApp, email, outcomes: [...outcomesTicked] }),
              })),
            ),
          ),
        ),
      ),
    ),
  );

  it("covers every kind, outcome, switch, email choice, tick set, mute and pause", () => {
    expect(cases).toHaveLength(5 * 12 * 2 * 3 * 3 * 2 * 2);
  });

  it.each(cases)("$kind $outcome inApp=$inApp email=$email ticks=$ticks muted=$muted paused=$emailPaused", (c) => {
    const route = routeNotification(c);
    const heldBack = c.kind === "watched_event" && c.outcome !== null && c.outcome !== "closed" && !c.ticks.includes(c.outcome);
    // Nothing when muted or when the watcher didn't tick the outcome.
    if (c.muted || heldBack) return expect(route).toEqual({ inApp: false, email: "none" });
    const emailed = !c.emailPaused && c.email !== "off";
    // The weekly report: never the bell; emailed on its schedule while on.
    if (c.kind === "weekly_report") return expect(route).toEqual({ inApp: false, email: emailed ? "immediate" : "none" });
    // Otherwise the bell follows the switch, and email the choice unless paused.
    expect(route.inApp).toBe(c.inApp);
    expect(route.email).toBe(emailed ? c.email : "none");
  });
});
