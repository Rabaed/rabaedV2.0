import { describe, expect, it } from "vitest";
import type { JobRun } from "../packages/db/dev-tools/index.ts";
import { printsItemText } from "./uat-guard.ts";
import { describeRun, parseRunJobArgs, recordingMailer } from "./uat-run-job.ts";

// `uat:run-job`'s pure part (RP-922): its arguments, and the mailer wrapper that records each email
// sent (recipient, subject) for the tool's output. Sending itself is tested at seam 2
// (packages/db/test/uat-run-job.test.ts).

describe("parseRunJobArgs", () => {
  const env = { COMPOSE_PROJECT_NAME: "rabaed-lane42" };

  it("reads the job, --member and --dry-run; the lane comes from the .env", () => {
    expect(parseRunJobArgs(["weekly-report", "--member", "pm@rabaed.test", "--dry-run"], env)).toEqual({
      job: "weekly-report",
      target: { kind: "lane", lane: 42 },
      memberEmail: "pm@rabaed.test",
      dryRun: true,
    });
    expect(parseRunJobArgs(["digest", "--uat"], {})).toEqual({ job: "digest", target: { kind: "uat" }, memberEmail: undefined, dryRun: false });
  });

  it("refuses an unknown or missing job, an unknown option, and an empty --member", () => {
    expect(parseRunJobArgs(["report"], env)).toEqual({ error: "give the job: digest or weekly-report" });
    expect(parseRunJobArgs([], env)).toEqual({ error: "give the job: digest or weekly-report" });
    expect(parseRunJobArgs(["digest", "--all"], env)).toEqual({ error: "unknown option --all" });
    expect(parseRunJobArgs(["digest", "--member"], env)).toEqual({ error: "--member takes a Member's email" });
  });
});

describe("recordingMailer", () => {
  it("sends through the mailer, then records the recipient and the rendered subject", async () => {
    const delivered: string[] = [];
    const { mailer, sent } = recordingMailer({ send: async (m) => void delivered.push(m.to) });
    await mailer.send({ to: "pm@rabaed.test", template: "sign-in-code", locale: "en", values: { code: "123456", validMinutes: 10 } });
    expect(delivered).toEqual(["pm@rabaed.test"]);
    expect(sent).toEqual([{ to: "pm@rabaed.test", subject: expect.any(String) }]);
    expect(sent[0]!.subject.length).toBeGreaterThan(0);
  });

  it("records nothing when the send fails", async () => {
    const { mailer, sent } = recordingMailer({ send: async () => Promise.reject(new Error("refused")) });
    await expect(mailer.send({ to: "pm@rabaed.test", template: "sign-in-code", locale: "en", values: { code: "123456", validMinutes: 10 } })).rejects.toThrow("refused");
    expect(sent).toEqual([]);
  });
});

describe("describeRun", () => {
  const row = (email: string) => ({ outboxId: "o1", memberId: "m1", email, projectId: "p1" });
  const run: JobRun = {
    job: "weekly-report",
    queued: [row("ahmed@tester.example"), row("pm@tester.example")],
    processed: [row("ahmed@tester.example")],
    takenByWorker: [row("pm@tester.example")],
    failed: [{ row: row("third@tester.example"), error: "550 rejected third@tester.example" }],
    leftOut: 3,
  };
  const sent = [{ to: "ahmed@tester.example", subject: "Weekly Step Age report: Hidden Tower" }];

  it("inside the GitHub job prints counts only: no recipient, no email subject (the log is public)", () => {
    const lines = describeRun(run, sent, { dryRun: false, member: true, itemText: false });
    expect(lines).toEqual([
      "Added 2 outbox row(s)",
      "3 row(s) for other Members were not queued",
      "1 row(s) already processed by worker",
      "a row: not sent (the send failed); left queued for the worker's retries",
      "Sent 1 email(s)",
    ]);
    expect(lines.join("\n")).not.toMatch(/@|Hidden Tower/);
  });

  it("on a lane names each recipient and email subject", () => {
    const lines = describeRun(run, sent, { dryRun: false, member: false, itemText: true });
    expect(lines[0]).toBe("Added 2 outbox row(s): ahmed@tester.example (Project p1), pm@tester.example (Project p1)");
    expect(lines.at(-1)).toBe('Sent 1 email(s): ahmed@tester.example "Weekly Step Age report: Hidden Tower"');
  });

  it("prints item text everywhere but inside GitHub Actions", () => {
    expect(printsItemText({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(printsItemText({})).toBe(true);
    expect(printsItemText({ GITHUB_ACTIONS: "false" })).toBe(true);
  });
});
