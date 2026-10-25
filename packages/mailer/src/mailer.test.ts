import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catcherTransport } from "./catcher.ts";
import { mailerFromEnv } from "./config.ts";
import { createMailer, notificationDigestMessage, notificationMessage, type OutgoingEmail } from "./mailer.ts";
import { sesTransport } from "./ses.ts";
import { renderEmail } from "./templates.ts";

const signInCode = { to: "engineer@rabaed.test", template: "sign-in-code", locale: "ar", values: { code: "482913", validMinutes: 10 } } as const;

describe("createMailer", () => {
  it("renders the template in the locale and hands it to the transport, from the configured address", async () => {
    const sent: OutgoingEmail[] = [];
    const mailer = createMailer({ from: "no-reply@rabaed.test", transport: async (email) => void sent.push(email) });
    await mailer.send(signInCode);
    expect(sent).toEqual([
      { from: "no-reply@rabaed.test", to: "engineer@rabaed.test", template: "sign-in-code", ...renderEmail("sign-in-code", "ar", signInCode.values) },
    ]);
  });

  it("refuses a recipient that is not one email address", async () => {
    const transport = vi.fn(async () => {});
    const mailer = createMailer({ from: "no-reply@rabaed.test", transport });
    await expect(mailer.send({ ...signInCode, to: "a@rabaed.test, b@rabaed.test" })).rejects.toThrow();
    await expect(mailer.send({ ...signInCode, to: "not an email" })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("notificationMessage", () => {
  it("emails a notification with its kind's template, in the recipient's language, linking to the item on the web", () => {
    const content = { workItemId: "0190a1b2-0000-7000-8000-000000000001", documentNumber: "TWR-MAR-01-0001", subject: "Cable trays", step: null, event: null };
    expect(notificationMessage({ to: "pm@rabaed.test", language: "ar", kind: "watched_event", content }, "https://rabaed.test")).toEqual({
      to: "pm@rabaed.test",
      template: "notification-watched-event",
      locale: "ar",
      values: { ...content, link: "https://rabaed.test/ar/work-items/0190a1b2-0000-7000-8000-000000000001" },
    });
  });
});

describe("notificationDigestMessage", () => {
  it("emails the digest in the recipient's language, each item linking to itself on the web", () => {
    const item = { workItemId: "0190a1b2-0000-7000-8000-000000000001", documentNumber: "TWR-MAR-01-0001", subject: "Cable trays", entries: [] };
    const project = { projectId: "0190a1b2-0000-7000-8000-0000000000aa", name: { en: "Tower", ar: "البرج" }, items: [item] };
    expect(notificationDigestMessage({ to: "pm@rabaed.test", language: "ar", projects: [project] }, "https://rabaed.test")).toEqual({
      to: "pm@rabaed.test",
      template: "daily-digest",
      locale: "ar",
      values: { projects: [{ name: project.name, items: [{ ...item, link: "https://rabaed.test/ar/work-items/0190a1b2-0000-7000-8000-000000000001" }] }] },
    });
  });
});

describe("sesTransport", () => {
  it("sends through SES v2 with the configuration set, UTF-8 bodies and the template as a tag", async () => {
    const commands: SendEmailCommand[] = [];
    const transport = sesTransport({ configurationSet: "rabaed-dev", client: { send: async (command) => void commands.push(command) } });
    const email: OutgoingEmail = { from: "no-reply@rabaed.test", to: "engineer@rabaed.test", template: "sign-in-code", subject: "S", text: "T", html: "<p>H</p>" };
    await transport(email);
    expect(commands.map((c) => c.input)).toEqual([
      {
        FromEmailAddress: "Rabaed <no-reply@rabaed.test>",
        Destination: { ToAddresses: ["engineer@rabaed.test"] },
        Content: {
          Simple: {
            Subject: { Data: "S", Charset: "UTF-8" },
            Body: { Text: { Data: "T", Charset: "UTF-8" }, Html: { Data: "<p>H</p>", Charset: "UTF-8" } },
          },
        },
        ConfigurationSetName: "rabaed-dev",
        EmailTags: [{ Name: "template", Value: "sign-in-code" }],
      },
    ]);
  });
});

describe("catcherTransport", () => {
  it.each(["https://mail.example.com", "http://10.0.0.5:8025", "http://mailpit.rabaed.test:8025"])("refuses %s: only a catcher on this machine", (url) => {
    expect(() => catcherTransport({ url })).toThrow(/this machine/);
  });

  it.each(["http://127.0.0.1:8025", "http://localhost:8525", "http://[::1]:8025"])("accepts %s", (url) => {
    expect(() => catcherTransport({ url })).not.toThrow();
  });
});

describe("mailerFromEnv", () => {
  it("uses SES when a configuration set is given (the cloud)", () => {
    expect(mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", MAIL_SES_CONFIGURATION_SET: "rabaed-dev" }).transport).toBe("ses");
  });

  it("uses the catcher when its URL is given (local and CI)", () => {
    expect(mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", MAIL_CATCHER_URL: "http://127.0.0.1:8025" }).transport).toBe("catcher");
  });

  it("refuses both at once, neither, or no From address", () => {
    expect(() =>
      mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", MAIL_SES_CONFIGURATION_SET: "rabaed-dev", MAIL_CATCHER_URL: "http://127.0.0.1:8025" }),
    ).toThrow();
    expect(() => mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test" })).toThrow();
    expect(() => mailerFromEnv({ MAIL_CATCHER_URL: "http://127.0.0.1:8025" })).toThrow();
  });

  it("uses SendGrid when its API key is given (the UAT on Vercel, ADR 0026)", () => {
    expect(mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", SENDGRID_API_KEY: "SG.test-key-not-real" }).transport).toBe("sendgrid");
  });

  it("takes an empty SENDGRID_API_KEY (as .env.example has it) for no key", () => {
    expect(mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", MAIL_CATCHER_URL: "http://127.0.0.1:8025", SENDGRID_API_KEY: "" }).transport).toBe("catcher");
  });

  it.each([{ MAIL_SES_CONFIGURATION_SET: "rabaed-dev" }, { MAIL_CATCHER_URL: "http://127.0.0.1:8025" }])("refuses SendGrid together with %o", (other) => {
    expect(() => mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", SENDGRID_API_KEY: "SG.test-key-not-real", ...other })).toThrow(/not two/);
  });

  describe("through a stubbed SendGrid", () => {
    afterEach(() => void vi.unstubAllGlobals());

    it("sends an Arabic invitation with its link as written and tracking off", async () => {
      const payloads: { content: { value: string }[]; tracking_settings: unknown }[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        payloads.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 202 });
      });
      const mailer = mailerFromEnv({ MAIL_FROM: "no-reply@rabaed.test", SENDGRID_API_KEY: "SG.test-key-not-real" });
      const link = "https://uat.rabaed.test/ar/accept-invitation#token=abc";
      await mailer.send({ to: "pm@rabaed.test", template: "invitation", locale: "ar", values: { companyName: "شركة البناء", link } });

      expect(payloads).toHaveLength(1);
      expect(payloads[0]!.content.map(({ value }) => value)).toEqual([
        renderEmail("invitation", "ar", { companyName: "شركة البناء", link }).text,
        expect.stringContaining(`href="${link}"`),
      ]);
      expect(payloads[0]!.tracking_settings).toEqual({
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      });
    });
  });
});
