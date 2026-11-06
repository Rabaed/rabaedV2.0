import type { ItemNotification, Notification, PackageNotification } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import {
  filterNotifications,
  groupByProject,
  notificationFilterOf,
  notificationHref,
  notificationLook,
  notificationQuery,
  projectsOf,
  timeLabel,
  whatHappened,
} from "./notifications.ts";

const b = (en: string, ar = en) => ({ en, ar });
const TWR = { id: "11111111-1111-4111-8111-111111111111", code: "TWR", name: b("Tower Residences", "أبراج السكن") };
const MRM = { id: "22222222-2222-4222-8222-222222222222", code: "MRM", name: b("Marina Mall", "مارينا مول") };
const DC = b("Design Consultants LLC", "ديزاين للاستشارات");
const TMC = b("TMC Constructions", "تي إم سي للمقاولات");

let seq = 0;
function item(over: Partial<ItemNotification> = {}): ItemNotification {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    kind: "step_reached",
    workItemId: "33333333-3333-4333-8333-333333333333",
    documentNumber: "TWR-TMC-EL-MAR-0005",
    title: "Distribution boards — Tower 2",
    project: TWR,
    revisionNo: 0,
    step: { name: b("Review & issue Code") },
    pool: null,
    event: null,
    createdAt: "2026-11-05T09:00:00.000Z",
    readAt: null,
    ...over,
  };
}
const event = (over: Partial<NonNullable<ItemNotification["event"]>>): NonNullable<ItemNotification["event"]> => ({
  type: "transition",
  transition: b("Submit"),
  outcome: null,
  outcomeName: null,
  outcomeKind: null,
  companyName: TMC,
  ownCompany: false,
  ...over,
});
const watched = (over: Partial<NonNullable<ItemNotification["event"]>>, rest: Partial<ItemNotification> = {}) =>
  item({ kind: "watched_event", step: null, event: event(over), ...rest });
const pkg = (over: Partial<PackageNotification> = {}): PackageNotification => ({
  id: "44444444-4444-4444-8444-444444444444",
  kind: "package_submitted",
  workItemId: null,
  project: MRM,
  step: null,
  pool: null,
  event: null,
  package: { id: "55555555-5555-4555-8555-555555555555", number: "PKG-003", name: b("Level 1 electrical"), companyName: TMC, count: 3 },
  createdAt: "2026-11-04T09:00:00.000Z",
  readAt: "2026-11-04T10:00:00.000Z",
  ...over,
});

describe("whatHappened", () => {
  it("a Step reached them alone, or their Step Pool", () => {
    expect(whatHappened(item(), "en")).toEqual({ key: "reached", values: { step: "Review & issue Code" } });
    expect(whatHappened(item({ pool: { waiting: true } }), "en")).toEqual({ key: "reachedPool", values: { step: "Review & issue Code" } });
  });

  it("a Review Code: the code, its name and the Company, by name only", () => {
    const n = watched({ type: "issue_code", transition: b("Revise · C"), outcome: "C", outcomeName: b("Revise and Resubmit"), outcomeKind: "review_code", companyName: DC });
    expect(whatHappened(n, "en")).toEqual({ key: "reviewCode", values: { code: "C", name: "Revise and Resubmit", company: "Design Consultants LLC" } });
  });

  it("an Inspection Result by its name", () => {
    const n = watched({ outcome: "failed", outcomeName: b("Failed", "راسب"), outcomeKind: "inspection_result" });
    expect(whatHappened(n, "ar")).toEqual({ key: "inspectionResult", values: { name: "راسب" } });
  });

  it("any other move: its Transition by the Company, the Member's own too", () => {
    expect(whatHappened(watched({}), "en")).toEqual({ key: "transitionBy", values: { transition: "Submit", company: "TMC Constructions" } });
    expect(whatHappened(watched({ ownCompany: true }), "en")).toEqual({ key: "transitionBy", values: { transition: "Submit", company: "TMC Constructions" } });
    // An outcome of no Code or Inspection Result (an approval) reads as its Transition.
    expect(whatHappened(watched({ transition: b("Approve"), outcome: "approved", outcomeName: b("Approved") }), "en").key).toBe("transitionBy");
    expect(whatHappened(watched({ companyName: null }), "en")).toEqual({ key: "transition", values: { transition: "Submit" } });
  });

  it("Sent Back to them, by the Company", () => {
    expect(whatHappened(item({ kind: "sent_back", step: null, event: event({ companyName: DC }) }), "en")).toEqual({ key: "sentBack", values: { company: "Design Consultants LLC" } });
  });

  it("a new Revision: from another Company, or the Member's own", () => {
    const rev = (ownCompany: boolean) => watched({ type: "revision_created", transition: null, ownCompany }, { revisionNo: 1 });
    expect(whatHappened(rev(false), "en")).toEqual({ key: "revisionFrom", values: { company: "TMC Constructions", n: "1" } });
    expect(whatHappened(rev(true), "en")).toEqual({ key: "revision", values: { n: "1" } });
  });

  it("cancelled: by another Company, or the Member's own", () => {
    expect(whatHappened(watched({ type: "cancelled", transition: null }), "en")).toEqual({ key: "cancelledBy", values: { company: "TMC Constructions" } });
    expect(whatHappened(watched({ type: "transition", transition: b("Cancel"), outcome: "cancelled", ownCompany: true }), "en")).toEqual({ key: "cancelled", values: {} });
  });

  it("a Record ready, and a Package Submit", () => {
    expect(whatHappened(item({ kind: "record_ready", step: null }), "en")).toEqual({ key: "recordReady", values: {} });
    expect(whatHappened(pkg(), "en")).toEqual({ key: "packageSubmitted", values: { company: "TMC Constructions", count: 3, n: "3" } });
  });
});

describe("notificationLook", () => {
  it("gives each kind its icon and tone", () => {
    const look = (n: Notification) => notificationLook(n);
    expect(look(item())).toEqual({ icon: "user-check", tone: "brand" });
    expect(look(item({ pool: { waiting: false } }))).toEqual({ icon: "users", tone: "brand" });
    expect(look(watched({ outcome: "C", outcomeKind: "review_code" }))).toEqual({ icon: "gavel", tone: "warning" });
    expect(look(item({ kind: "sent_back", step: null, event: event({}) }))).toEqual({ icon: "arrow-back-up", tone: "danger" });
    expect(look(watched({ outcome: "failed", outcomeKind: "inspection_result" }))).toEqual({ icon: "clipboard-check", tone: "success" });
    expect(look(watched({}))).toEqual({ icon: "send", tone: "info" });
    expect(look(watched({ type: "revision_created" }))).toEqual({ icon: "git-branch", tone: "violet" });
    expect(look(watched({ type: "cancelled" }))).toEqual({ icon: "circle-x", tone: "neutral" });
    expect(look(watched({ outcome: "cancelled" }))).toEqual({ icon: "circle-x", tone: "neutral" });
    expect(look(item({ kind: "record_ready", step: null }))).toEqual({ icon: "file-download", tone: "success" });
    expect(look(pkg())).toEqual({ icon: "package", tone: "info" });
  });
});

describe("notificationHref", () => {
  it("opens the item, or the Package", () => {
    expect(notificationHref(item())).toBe("/work-items/33333333-3333-4333-8333-333333333333");
    expect(notificationHref(pkg())).toBe("/packages/55555555-5555-4555-8555-555555555555");
  });
});

describe("timeLabel", () => {
  // 2026-11-06 12:00 in Riyadh (UTC+3).
  const now = new Date("2026-11-06T09:00:00.000Z");
  const at = (iso: string) => timeLabel(new Date(iso), now, "en");

  it("minutes, then hours, within the last day", () => {
    expect(at("2026-11-06T08:55:00.000Z")).toEqual({ key: "minutes", values: { n: "5" } });
    expect(at("2026-11-06T08:59:50.000Z")).toEqual({ key: "minutes", values: { n: "1" } });
    expect(at("2026-11-06T07:00:00.000Z")).toEqual({ key: "hours", values: { n: "2" } });
    expect(at("2026-11-05T22:00:00.000Z")).toEqual({ key: "hours", values: { n: "11" } });
  });

  it("yesterday with its Riyadh time, older ones by date; the year only when it isn't this year", () => {
    // 2026-11-05 10:10 Riyadh: a day before, by the calendar in Riyadh.
    expect(at("2026-11-05T07:10:00.000Z")).toEqual({ key: "yesterday", values: { time: "10:10" } });
    expect(at("2026-10-28T07:00:00.000Z")).toEqual({ key: "date", values: { date: "28 Oct" } });
    expect(at("2025-12-28T07:00:00.000Z")).toEqual({ key: "date", values: { date: "28 Dec 2025" } });
  });

  it("writes Arabic with Latin digits", () => {
    expect(timeLabel(new Date("2026-11-05T07:10:00.000Z"), now, "ar")).toEqual({ key: "yesterday", values: { time: "10:10" } });
    const date = timeLabel(new Date("2026-10-28T07:00:00.000Z"), now, "ar").values.date as string;
    expect(date).toMatch(/^28 /);
    expect(date).not.toMatch(/[٠-٩]/);
  });
});

describe("filters and groups", () => {
  const a = item({ project: TWR });
  const r = item({ project: TWR, readAt: "2026-11-05T10:00:00.000Z" });
  const m = item({ project: MRM });
  const p = pkg();
  const list: Notification[] = [a, m, r, p];

  it("reads the filter from the URL: Unread at first, then All, a Project, grouping off", () => {
    expect(notificationFilterOf({})).toEqual({ show: "unread", project: null, group: true });
    expect(notificationFilterOf({ show: "all", project: MRM.id, group: "off" })).toEqual({ show: "all", project: MRM.id, group: false });
    expect(notificationFilterOf({ show: "nonsense", project: ["x", "y"] })).toEqual({ show: "unread", project: "x", group: true });
  });

  it("writes the filter back to the URL, leaving out what is as at first", () => {
    expect(notificationQuery({ show: "unread", project: null, group: true })).toBe("");
    expect(notificationQuery({ show: "all", project: MRM.id, group: false })).toBe(`?show=all&project=${MRM.id}&group=off`);
  });

  it("keeps the unread ones, or all, of one Project or every one", () => {
    expect(filterNotifications(list, { show: "unread", project: null, group: true })).toEqual([a, m]);
    expect(filterNotifications(list, { show: "all", project: MRM.id, group: true })).toEqual([m, p]);
  });

  it("lists each Project once, in the order its newest notification comes", () => {
    expect(projectsOf(list)).toEqual([TWR, MRM]);
  });

  it("groups by Project, in that order, keeping each group's order", () => {
    expect(groupByProject(list)).toEqual([
      { project: TWR, notifications: [a, r] },
      { project: MRM, notifications: [m, p] },
    ]);
  });
});
