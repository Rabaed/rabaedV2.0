import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";

// The demo's shared password comes from the running demo's git-ignored .env.demo
// (DEMO_ENV_FILE points at it); it is never written into a test or a report.
function demoPassword(): string {
  const file = process.env.DEMO_ENV_FILE ?? resolve(process.cwd(), "../../.env.demo");
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DEMO_PASSWORD="));
  if (!line) throw new Error(`DEMO_PASSWORD not found in ${file}`);
  return line.slice("DEMO_PASSWORD=".length).trim();
}

export const people = {
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
} as const;

/** A fresh browser context per person, as a private window per person in the walkthrough. */
export async function signedIn(browser: Browser, email: string, locale: "en" | "ar" = "en"): Promise<Page> {
  const context = await browser.newContext({
    recordVideo: { dir: "../e2e-results/videos", size: { width: 1366, height: 820 } },
    viewport: { width: 1366, height: 820 },
  });
  const page = await context.newPage();
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(locale === "en" ? "Email" : "البريد الإلكتروني").fill(email);
  await page.getByLabel(locale === "en" ? "Password" : "كلمة المرور").fill(demoPassword());
  await page.getByRole("button", { name: locale === "en" ? "Sign in" : "تسجيل الدخول" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/sign-in"));
  return page;
}
