import { describe, expect, it } from "vitest";
import { parseRunJobArgs, recordingMailer } from "./uat-run-job.ts";

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
