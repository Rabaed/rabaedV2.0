import { afterEach, describe, expect, it, vi } from "vitest";
import { adminAppOptionsFromEnv } from "./from-env.ts";

afterEach(() => vi.unstubAllEnvs());

describe("adminAppOptionsFromEnv", () => {
  it("starts without a mail sender: the mailer is built at the first email", async () => {
    vi.stubEnv("DATABASE_ADMIN_URL", "postgres://rabaed_admin:x@127.0.0.1:1/none");
    vi.stubEnv("WEB_URL", "https://web.rabaed.test");
    vi.stubEnv("MAIL_FROM", "");
    const options = adminAppOptionsFromEnv();
    expect(options.config.webUrl).toBe("https://web.rabaed.test");
    await expect(async () => options.mailer.send({ to: "a@rabaed.test", subject: "s", text: "t", html: "<p>t</p>" } as never)).rejects.toThrow();
    await options.db.destroy();
  });
});
